// Creates the devnet market Holdfill executes against:
//   1. Replica SPACEX and SPCXx mints with SpaceX PreStocks' on-chain configuration.
//   2. A Meteora DLMM pair at the live mainnet price.
//   3. Liquidity shaped like the mainnet pool: SPCXx below the price, SPACEX above it.
// Each step records its result in config/devnet.json and is skipped on re-run.
import { Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import { BADGE_GATED, type MintSpec, createReplicaMint, mintInventory } from "./lib/replica";
import BN from "bn.js";
import DLMM, { StrategyType, deriveLbPairWithPresetParamWithIndexKey } from "@meteora-ag/dlmm";
import { DLMM_PROGRAM_ID, MAINNET, devnet, issuerKeypair, faucetKeypair, mainnet, readConfig, writeConfig } from "./lib/env";

const BIN_STEP = 10;               // only bin step with a preset on devnet (checked 23 Sep 2026)
const BINS_PER_POSITION = 69;
const RANGE_BELOW = 0.8;           // SPCXx liquidity down to 80% of today's price
const RANGE_ABOVE = 1.15;          // SPACEX liquidity up to 115% of today's price
const SEED_SPCXX = 600n * 10n ** 8n;   // 600 SPCXx below the price
const SEED_SPACEX = 150n * 10n ** 9n;  // 150 raw SPACEX above the price
const INVENTORY_SPACEX = 1_000n * 10n ** 9n;
const INVENTORY_SPCXX = 5_000n * 10n ** 8n;

const SPECS: Record<"spacex" | "spcxx", MintSpec> = {
  spacex: {
    label: "replica SPACEX", decimals: 9, multiplier: 5, transferFeeBps: 100,
    name: "SpaceX PreStocks (devnet replica)", symbol: "SPACEX",
    uri: "https://prestocks.com/metadata/spacex.json",
  },
  spcxx: {
    label: "replica SPCXx", decimals: 8, multiplier: 1, transferFeeBps: 0,
    name: "SpaceX xStock (devnet replica)", symbol: "SPCXx",
    uri: "https://xstocks-metadata.backed.fi/tokens/Solana/SPCXx/metadata.json",
  },
};

async function mainnetPricePerLamport(): Promise<number> {
  const pool = await DLMM.create(mainnet(), MAINNET.pool);
  const active = await pool.getActiveBin();
  return Number(active.price); // SPCXx base units per SPACEX base unit
}

async function main() {
  const conn = devnet();
  const issuer = issuerKeypair();
  const cfg = readConfig();
  cfg.issuer = issuer.publicKey.toBase58();
  cfg.replicaExtensions = BADGE_GATED
    ? "TransferFee(SPACEX 100 bps), ScaledUiAmount, PermanentDelegate, Pausable, Metadata"
    : "TransferFee(SPACEX 100 bps), MetadataPointer, TokenMetadata. ScaledUiAmount, PermanentDelegate, Pausable, and freeze authority omitted: DLMM requires an admin token badge for them. The app applies the issuer-stated 5x split.";
  console.log("issuer", cfg.issuer, "balance", (await conn.getBalance(issuer.publicKey)) / 1e9, "SOL");

  if (!cfg.replicaSpacex) { cfg.replicaSpacex = (await createReplicaMint(conn, issuer, SPECS.spacex)).toBase58(); writeConfig(cfg); }
  if (!cfg.replicaSpcxx) { cfg.replicaSpcxx = (await createReplicaMint(conn, issuer, SPECS.spcxx)).toBase58(); writeConfig(cfg); }
  const spacex = new PublicKey(cfg.replicaSpacex);
  const spcxx = new PublicKey(cfg.replicaSpcxx);

  await mintInventory(conn, issuer, spacex, INVENTORY_SPACEX, faucetKeypair());
  await mintInventory(conn, issuer, spcxx, INVENTORY_SPCXX);
  console.log("inventory minted");

  if (!cfg.pool) {
    const presets = await DLMM.getAllPresetParameters(conn);
    const preset = presets.presetParameter2.find((p) => p.account.binStep === BIN_STEP);
    if (!preset) throw new Error(`no PresetParameter2 with bin step ${BIN_STEP} on devnet`);
    const price = await mainnetPricePerLamport();
    const activeId = DLMM.getBinIdFromPrice(price, BIN_STEP, true);
    console.log("mainnet price per lamport", price, "-> active id", activeId, "preset", preset.publicKey.toBase58());
    const tx = await DLMM.createLbPair2(conn, issuer.publicKey, spacex, spcxx, preset.publicKey, new BN(activeId), { cluster: "devnet" });
    const sig = await sendAndConfirmTransaction(conn, tx, [issuer], { commitment: "confirmed" });
    const [pairKey] = deriveLbPairWithPresetParamWithIndexKey(preset.publicKey, spacex, spcxx, DLMM_PROGRAM_ID);
    const pairInfo = await conn.getAccountInfo(pairKey, "confirmed");
    if (!pairInfo?.owner.equals(DLMM_PROGRAM_ID)) throw new Error(`pair ${pairKey.toBase58()} not found after creation`);
    cfg.pool = pairKey.toBase58();
    cfg.presetParameter = preset.publicKey.toBase58();
    cfg.binStep = BIN_STEP;
    cfg.initialActiveId = activeId;
    cfg.poolPath = "createLbPair2";
    writeConfig(cfg);
    console.log("created pool", cfg.pool, "sig", sig);
  }

  if (!cfg.positions?.length) {
    const pool = await DLMM.create(conn, new PublicKey(cfg.pool), { cluster: "devnet" });
    const active = pool.lbPair.activeId;
    const binsBelow = Math.ceil(Math.log(1 / RANGE_BELOW) / Math.log(1 + BIN_STEP / 10_000));
    const binsAbove = Math.ceil(Math.log(RANGE_ABOVE) / Math.log(1 + BIN_STEP / 10_000));
    const ranges: { min: number; max: number; side: "y" | "x" }[] = [];
    for (let lo = active - binsBelow; lo <= active - 1; lo += BINS_PER_POSITION)
      ranges.push({ min: lo, max: Math.min(lo + BINS_PER_POSITION - 1, active - 1), side: "y" });
    for (let lo = active; lo <= active + binsAbove; lo += BINS_PER_POSITION)
      ranges.push({ min: lo, max: Math.min(lo + BINS_PER_POSITION - 1, active + binsAbove), side: "x" });

    const yRanges = ranges.filter((r) => r.side === "y"), xRanges = ranges.filter((r) => r.side === "x");
    cfg.positions = [];
    for (const r of ranges) {
      const bins = r.max - r.min + 1;
      const pool2 = await DLMM.create(conn, new PublicKey(cfg.pool), { cluster: "devnet" });
      const totalY = r.side === "y" ? (SEED_SPCXX * BigInt(bins)) / BigInt(yRanges.reduce((a, q) => a + q.max - q.min + 1, 0)) : 0n;
      const totalX = r.side === "x" ? (SEED_SPACEX * BigInt(bins)) / BigInt(xRanges.reduce((a, q) => a + q.max - q.min + 1, 0)) : 0n;
      const position = Keypair.generate();
      const tx = await pool2.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: position.publicKey,
        totalXAmount: new BN(totalX.toString()),
        totalYAmount: new BN(totalY.toString()),
        strategy: { minBinId: r.min, maxBinId: r.max, strategyType: StrategyType.Spot, ...(r.side === "x" ? { singleSidedX: true } : {}) },
        user: issuer.publicKey,
        slippage: 1,
      });
      const sig = await sendAndConfirmTransaction(conn, tx, [issuer, position], { commitment: "confirmed" });
      cfg.positions.push(position.publicKey.toBase58());
      writeConfig(cfg);
      console.log(`position ${r.side} bins ${r.min}..${r.max} x=${totalX} y=${totalY} sig ${sig}`);
    }
  }

  console.log("done. balance", (await conn.getBalance(issuer.publicKey)) / 1e9, "SOL");
}

main().catch((e) => {
  console.error("SETUP FAILED:", e?.message ?? e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
