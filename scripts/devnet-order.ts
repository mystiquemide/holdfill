// Cancels a holder's current devnet order (if any) and creates a new one.
// Usage: tsx scripts/devnet-order.ts <holder keypair path> <size raw tokens> <limit percent>
import {
  LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, createApproveCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction,
  createRevokeInstruction, getAccount, getAssociatedTokenAddressSync, mintTo,
} from "@solana/spl-token";
import { BN } from "@anchor-lang/core";
import { loadProgram } from "../keeper/program";
import { devnet, issuerKeypair, faucetKeypair, loadKeypair, readConfig } from "./lib/env";

async function main() {
  const [holderPath, sizeArg, limitArg] = process.argv.slice(2);
  if (!holderPath || !sizeArg || !limitArg) throw new Error("usage: devnet-order.ts <holder keypair> <size raw> <limit %>");
  const conn = devnet();
  const cfg = readConfig();
  const issuer = issuerKeypair();
  const holder = loadKeypair("__", holderPath);
  const program = loadProgram(conn, holder);
  const SPACEX = new PublicKey(cfg.replicaSpacex!), SPCXX = new PublicKey(cfg.replicaSpcxx!);
  const size = BigInt(Math.round(Number(sizeArg) * 1e9));
  const limitBps = Math.round(Number(limitArg) * 100);
  const ata = (m: PublicKey) => getAssociatedTokenAddressSync(m, holder.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const order = PublicKey.findProgramAddressSync([Buffer.from("order"), holder.publicKey.toBuffer(), SPACEX.toBuffer()], program.programId)[0];
  const event = PublicKey.findProgramAddressSync([Buffer.from("event"), SPACEX.toBuffer()], program.programId)[0];

  if ((await conn.getBalance(holder.publicKey)) < 0.02 * LAMPORTS_PER_SOL) {
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: holder.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })), [issuer]);
  }
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(holder.publicKey, ata(SPACEX), holder.publicKey, SPACEX, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(holder.publicKey, ata(SPCXX), holder.publicKey, SPCXX, TOKEN_2022_PROGRAM_ID),
  ), [holder]);
  const bal = (await getAccount(conn, ata(SPACEX), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  if (bal < size) await mintTo(conn, issuer, SPACEX, ata(SPACEX), faucetKeypair(), size - bal, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);

  const tx = new Transaction();
  if (await conn.getAccountInfo(order)) {
    tx.add(await program.methods.cancelOrder().accountsStrict({ owner: holder.publicKey, order }).instruction());
    tx.add(createRevokeInstruction(ata(SPACEX), holder.publicKey, [], TOKEN_2022_PROGRAM_ID));
  }
  tx.add(await program.methods
    .createOrder({ size: new BN(size.toString()), limitBps, fallbackTs: new BN(Math.floor(Date.parse("2027-03-01T00:00:00Z") / 1000)), fallbackFloorBps: 5000 })
    .accountsStrict({ owner: holder.publicKey, event, inputMint: SPACEX, ownerTokenIn: ata(SPACEX), order, systemProgram: SystemProgram.programId })
    .instruction());
  tx.add(createApproveCheckedInstruction(ata(SPACEX), SPACEX, order, holder.publicKey, size, 9, [], TOKEN_2022_PROGRAM_ID));
  const sig = await sendAndConfirmTransaction(conn, tx, [holder], { commitment: "confirmed" });
  console.log(JSON.stringify({ order: order.toBase58(), owner: holder.publicKey.toBase58(), sizeRaw: size.toString(), limitBps, signature: sig }));
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e, (e?.logs ?? []).slice(-3).join(" | ")); process.exit(1); });
