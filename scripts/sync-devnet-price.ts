// Moves the devnet pool so a seller receives what they would receive on mainnet right now.
// Matching is on the executable quote for 0.1 raw SPACEX (pool fee, 1% transfer fee, and slippage
// included), not on mid price: every devnet preset charges a 10% pool fee while the mainnet
// SPACEX pool charges 5%, so equal mid prices would overstate the devnet gap by about 5 points.
// Trades issuer inventory on devnet only. Never touches mainnet.
import { PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import DLMM from "@meteora-ag/dlmm";
import { MAINNET, devnet, issuerKeypair, mainnet, readConfig, writeConfig } from "./lib/env";

const PROBE_IN = new BN(100_000_000); // 0.1 raw SPACEX
const TOLERANCE = 0.005;              // 0.5%
const MAX_STEPS = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Free-tier RPC rate limits can expire a blockhash mid-send. Rebuild and resend.
async function withRetry(fn: () => Promise<void>, attempts = 3) {
  for (let i = 1; ; i++) {
    try { await fn(); await sleep(400); return; }
    catch (e: any) {
      if (i >= attempts) throw e;
      console.log(`  send failed (${String(e?.message ?? e).split("\n")[0].slice(0, 80)}), retrying`);
      await sleep(1500 * i);
    }
  }
}

async function quoteOut(pool: DLMM): Promise<number> {
  await pool.refetchStates();
  const bins = await pool.getBinArrayForSwap(true, 6);
  return Number(pool.swapQuote(PROBE_IN, true, new BN(100), bins).outAmount.toString());
}

async function main() {
  const cfg = readConfig();
  const issuer = issuerKeypair();
  const conn = devnet();
  const dev = await DLMM.create(conn, new PublicKey(cfg.pool!), { cluster: "devnet" });
  const main = await DLMM.create(mainnet(), MAINNET.pool);
  const spacex = new PublicKey(cfg.replicaSpacex!), spcxx = new PublicKey(cfg.replicaSpcxx!);

  const target = await quoteOut(main);
  let current = await quoteOut(dev);
  console.log(`target (mainnet) ${target / 1e8} SPCXx per 0.1 raw, devnet ${current / 1e8}`);

  let step = 0;
  let chunkSpacex = 2_000_000_000n; // 2 raw SPACEX per sell step, adapted below
  let chunkSpcxx = 500_000_000n;    // 5 SPCXx per buy step, adapted below
  while (Math.abs(current - target) / target > TOLERANCE && step < MAX_STEPS) {
    step++;
    const devnetPaysTooLittle = current < target; // raise the SPACEX price: buy SPACEX with SPCXx
    const swapForY = !devnetPaysTooLittle;
    const inAmount = new BN((swapForY ? chunkSpacex : chunkSpcxx).toString());
    await withRetry(async () => {
      await dev.refetchStates();
      const bins = await dev.getBinArrayForSwap(swapForY, 12);
      const q = dev.swapQuote(inAmount, swapForY, new BN(500), bins);
      const tx = await dev.swap({
        inToken: swapForY ? spacex : spcxx, outToken: swapForY ? spcxx : spacex,
        inAmount, minOutAmount: q.minOutAmount, lbPair: dev.pubkey, user: issuer.publicKey, binArraysPubkey: q.binArraysPubkey,
      });
      await sendAndConfirmTransaction(conn, tx, [issuer], { commitment: "confirmed" });
    });
    const next = await quoteOut(dev);
    const overshot = (current < target) !== (next < target);
    if (overshot) { chunkSpacex /= 2n; chunkSpcxx /= 2n; }
    else if (step > 1) { chunkSpacex *= 2n; chunkSpcxx *= 2n; } // not there yet: move faster
    console.log(`step ${step}: ${swapForY ? "sold SPACEX" : "bought SPACEX"}, devnet now ${next / 1e8}${overshot ? " (overshot, halving step)" : ""}`);
    current = next;
  }

  const diffPct = ((current - target) / target) * 100;
  const devMid = Number((await dev.getActiveBin()).price), mainMid = Number((await main.getActiveBin()).price);
  cfg.lastSync = { at: new Date().toISOString(), mainnetPrice: target / 1e8, devnetPrice: current / 1e8, diffPct: Number(diffPct.toFixed(3)) };
  cfg.syncBasis = "executable quote for 0.1 raw SPACEX incl. fees";
  writeConfig(cfg);
  console.log(`done in ${step} steps. executable diff ${diffPct.toFixed(2)}%. mid prices: devnet ${devMid.toFixed(5)}, mainnet ${mainMid.toFixed(5)}`);
  process.exit(Math.abs(diffPct) <= TOLERANCE * 100 ? 0 : 1);
}
main().catch((e) => { console.error("SYNC FAILED:", e?.message ?? e, e?.logs ?? ""); process.exit(2); });
