// Prints solana-test-validator arguments that clone the devnet market (Meteora DLMM program,
// replica mints, pool, reserves, oracle, bin arrays) and load the locally built holdfill_orders.
import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import DLMM, { binIdToBinArrayIndex, deriveBinArray, deriveBinArrayBitmapExtension } from "@meteora-ag/dlmm";
import { DLMM_PROGRAM_ID, ROOT, devnet, readConfig } from "./lib/env";

async function main() {
  const cfg = readConfig();
  const conn = devnet();
  const pool = await DLMM.create(conn, new PublicKey(cfg.pool!), { cluster: "devnet" });
  // Every bin array across the seeded liquidity range (-20% to +15% around the initial price), with
  // a margin. Missing arrays are skipped by --maybe-clone.
  const lo = binIdToBinArrayIndex(new BN(pool.lbPair.activeId - 400)).toNumber();
  const hi = binIdToBinArrayIndex(new BN(pool.lbPair.activeId + 300)).toNumber();
  const bins = [];
  for (let i = lo; i <= hi; i++) bins.push({ publicKey: deriveBinArray(pool.pubkey, new BN(i), DLMM_PROGRAM_ID)[0] });
  const [bitmap] = deriveBinArrayBitmapExtension(pool.pubkey, DLMM_PROGRAM_ID);
  const accounts = new Set<string>([
    cfg.replicaSpacex!, cfg.replicaSpcxx!, cfg.pool!,
    pool.lbPair.reserveX.toBase58(), pool.lbPair.reserveY.toBase58(), pool.lbPair.oracle.toBase58(),
    bitmap.toBase58(), ...bins.map((b) => b.publicKey.toBase58()),
  ]);
  const programId = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/holdfill_orders.json"), "utf8")).address;
  const args = [
    "--reset", "--quiet", "--ledger", path.join(ROOT, "test-ledger"),
    "--url", `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    "--clone-upgradeable-program", DLMM_PROGRAM_ID.toBase58(),
    "--bpf-program", programId, path.join(ROOT, "target/deploy/holdfill_orders.so"),
    ...[...accounts].flatMap((a) => ["--maybe-clone", a]),
  ];
  process.stdout.write(args.join(" ") + "\n");
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
