// Verifies the devnet market: replica mint configuration, pool price vs mainnet, and a real swap
// of 0.1 replica SPACEX that must pay the 1% transfer fee into the pool reserve.
import { PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync, getExtensionTypes, getMint,
  getTransferFeeAmount, getTransferFeeConfig, ExtensionType,
} from "@solana/spl-token";
import BN from "bn.js";
import DLMM from "@meteora-ag/dlmm";
import { MAINNET, devnet, issuerKeypair, mainnet, readConfig, writeConfig } from "./lib/env";

async function main() {
  const conn = devnet();
  const issuer = issuerKeypair();
  const cfg = readConfig();
  const spacex = new PublicKey(cfg.replicaSpacex!), spcxx = new PublicKey(cfg.replicaSpcxx!);

  for (const [label, mintKey] of [["replica SPACEX", spacex], ["replica SPCXx", spcxx]] as const) {
    const m = await getMint(conn, mintKey, "confirmed", TOKEN_2022_PROGRAM_ID);
    const exts = getExtensionTypes(m.tlvData).map((e) => ExtensionType[e]);
    const fee = getTransferFeeConfig(m);
    console.log(`${label}: decimals ${m.decimals}, freeze ${m.freezeAuthority?.toBase58() ?? "none"}, extensions [${exts.join(", ")}]${fee ? `, fee ${fee.newerTransferFee.transferFeeBasisPoints} bps` : ""}`);
  }

  const pool = await DLMM.create(conn, new PublicKey(cfg.pool!), { cluster: "devnet" });
  const main = await DLMM.create(mainnet(), MAINNET.pool);
  const [dev, mn] = [Number((await pool.getActiveBin()).price), Number((await main.getActiveBin()).price)];
  console.log(`active price per lamport: devnet ${dev.toFixed(6)} vs mainnet ${mn.toFixed(6)} (${(((dev - mn) / mn) * 100).toFixed(2)}%)`);

  const amountIn = new BN(100_000_000); // 0.1 raw SPACEX = 0.5 shares
  const bins = await pool.getBinArrayForSwap(true, 4);
  const quote = pool.swapQuote(amountIn, true, new BN(100), bins);
  const reserveBefore = getTransferFeeAmount(await getAccount(conn, pool.lbPair.reserveX, "confirmed", TOKEN_2022_PROGRAM_ID))?.withheldAmount ?? 0n;
  const outAta = getAssociatedTokenAddressSync(spcxx, issuer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const outBefore = (await getAccount(conn, outAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const tx = await pool.swap({
    inToken: spacex, outToken: spcxx, inAmount: amountIn, minOutAmount: quote.minOutAmount,
    lbPair: pool.pubkey, user: issuer.publicKey, binArraysPubkey: quote.binArraysPubkey,
  });
  const sig = await sendAndConfirmTransaction(conn, tx, [issuer], { commitment: "confirmed" });
  const reserveAfter = getTransferFeeAmount(await getAccount(conn, pool.lbPair.reserveX, "confirmed", TOKEN_2022_PROGRAM_ID))?.withheldAmount ?? 0n;
  const received = (await getAccount(conn, outAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount - outBefore;
  const feeWithheld = reserveAfter - reserveBefore;
  const perShare = Number(received) / 1e8 / 0.5;
  console.log(`swap ${sig}`);
  console.log(`  in 0.1 raw SPACEX, out ${Number(received) / 1e8} SPCXx (quote ${Number(quote.outAmount) / 1e8})`);
  console.log(`  transfer fee withheld on pool reserve: ${feeWithheld} base units (${(Number(feeWithheld) / 1e9).toFixed(6)} SPACEX, expected 0.001)`);
  console.log(`  realized ${perShare.toFixed(4)} SPCXx per share, gap ${(100 * (1 - perShare)).toFixed(1)}% incl. fee`);
  const pass = feeWithheld === 1_000_000n && received >= BigInt(quote.minOutAmount.toString());
  console.log(pass ? "PASS  devnet swap pays the 1% transfer fee" : "FAIL  fee or output mismatch");
  cfg.proofTransactions = { ...(cfg.proofTransactions ?? {}), poolFeeCheck: sig };
  writeConfig(cfg);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error("CHECK FAILED:", e?.message ?? e, e?.logs ?? ""); process.exit(2); });
