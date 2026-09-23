// Creates devnet markets for PreStocks without an issuer event, where holders sell into USDC:
//   1. A replica USDC mint (classic SPL Token, 6 decimals), shared by every market.
//   2. Per symbol: a replica PreStocks mint (Token-2022, 9 decimals, 1% transfer fee).
//   3. Per symbol: a Meteora DLMM pair (PreStocks as token X, USDC as token Y) at the live
//      mainnet price, with liquidity 5% either side: USDC below the price, tokens above it.
// Usage: tsx scripts/setup-markets.ts ANTHROPIC [OPENAI ...]. Each step is recorded in
// config/devnet.json and skipped on re-run.
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import DLMM from "@meteora-ag/dlmm";
import { devnet, issuerKeypair, mainnet, readConfig, writeConfig } from "./lib/env";
import { createPair, seedLiquidity } from "./lib/pool";
import { createReplicaMint, mintInventory } from "./lib/replica";

/** Mainnet PreStocks mints and their main USDC DLMM pair (PreStocks is token X in each, checked 23 Sep 2026). */
const MAINNET_MARKETS: Record<string, { name: string; mint: string; usdcPool: string }> = {
  ANTHROPIC: { name: "Anthropic", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", usdcPool: "9thgWVMJUKiiotrVmzhEy1MWPyvkNsUSwKbp8ZFsuhA2" },
  OPENAI: { name: "OpenAI", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", usdcPool: "4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH" },
};

const RANGE = 0.05;
const USDC_INVENTORY = 200_000n * 10n ** 6n;
const TOKEN_INVENTORY = 1_000n * 10n ** 9n;
const SEED_USDC = 50_000n * 10n ** 6n;
const SEED_TOKENS = 50n * 10n ** 9n;

export type MarketConfig = {
  name: string; mint: string; pool?: string; mainnetMint: string; mainnetPool: string;
  initialActiveId?: number; positions?: string[];
};

async function main() {
  const symbols = process.argv.slice(2).map((s) => s.toUpperCase());
  if (!symbols.length || symbols.some((s) => !MAINNET_MARKETS[s])) {
    throw new Error(`usage: setup-markets.ts ${Object.keys(MAINNET_MARKETS).join("|")} ...`);
  }
  const conn = devnet();
  const issuer = issuerKeypair();
  const cfg = readConfig();
  const markets = (cfg.markets ?? {}) as Record<string, MarketConfig>;
  cfg.markets = markets;
  console.log("issuer balance", (await conn.getBalance(issuer.publicKey)) / 1e9, "SOL");

  if (!cfg.replicaUsdc) {
    const usdc = await createMint(conn, issuer, issuer.publicKey, null, 6, Keypair.generate(), { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
    cfg.replicaUsdc = usdc.toBase58();
    writeConfig(cfg);
    console.log("created replica USDC", cfg.replicaUsdc);
  }
  const usdc = new PublicKey(cfg.replicaUsdc as string);
  const usdcAta = await getOrCreateAssociatedTokenAccount(conn, issuer, usdc, issuer.publicKey, false, "confirmed", undefined, TOKEN_PROGRAM_ID);
  if (usdcAta.amount < USDC_INVENTORY) {
    await mintTo(conn, issuer, usdc, usdcAta.address, issuer, USDC_INVENTORY - usdcAta.amount, [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
  }

  for (const symbol of symbols) {
    const main = MAINNET_MARKETS[symbol];
    const m: MarketConfig = markets[symbol] ?? { name: main.name, mint: "", mainnetMint: main.mint, mainnetPool: main.usdcPool };
    markets[symbol] = m;

    if (!m.mint) {
      m.mint = (await createReplicaMint(conn, issuer, {
        label: `replica ${symbol}`, decimals: 9, multiplier: 1, transferFeeBps: 100,
        name: `${main.name} PreStocks (devnet replica)`, symbol, uri: `https://www.prestocks.com/${symbol.toLowerCase()}`,
      })).toBase58();
      writeConfig(cfg);
    }
    const mint = new PublicKey(m.mint);
    await mintInventory(conn, issuer, mint, TOKEN_INVENTORY);

    if (!m.pool) {
      const live = await DLMM.create(mainnet(), new PublicKey(main.usdcPool));
      const price = Number((await live.getActiveBin()).price); // USDC base units per token base unit
      const { pair, activeId } = await createPair(conn, issuer, mint, usdc, price);
      m.pool = pair.toBase58();
      m.initialActiveId = activeId;
      writeConfig(cfg);
      console.log(`${symbol}: pool ${m.pool} at mainnet price ${(price * 1e3).toFixed(2)} USDC per token, active id ${activeId}`);
    }
    if (!m.positions?.length) {
      m.positions = await seedLiquidity(conn, issuer, new PublicKey(m.pool), RANGE, SEED_TOKENS, SEED_USDC);
      writeConfig(cfg);
      console.log(`${symbol}: liquidity seeded ${RANGE * 100}% either side`);
    }
  }
  console.log("done. balance", (await conn.getBalance(issuer.publicKey)) / 1e9, "SOL");
}

main().catch((e) => {
  console.error("SETUP FAILED:", e?.message ?? e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
