// T5 check on devnet: a tick fills a reachable order and leaves an unreachable one waiting, and the
// keeper wallet ends holding no token accounts.
import fs from "node:fs";
import path from "node:path";
import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, createApproveCheckedInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN } from "@anchor-lang/core";
import { loadProgram } from "../keeper/program";
import { tick } from "../keeper/tick";
import { ROOT, devnet, loadKeypair, readConfig } from "../scripts/lib/env";

async function main() {
  const conn = devnet();
  const cfg = readConfig();
  const SPACEX = new PublicKey(cfg.replicaSpacex!);
  const holder = loadKeypair("__", "/root/.config/holdfill/holder.json");
  const holder2 = loadKeypair("__", "/root/.config/holdfill/holder2.json");
  const keeper = loadKeypair("__", "/root/.config/holdfill/keeper.json");
  const program = loadProgram(conn, keeper);
  const eventPda = PublicKey.findProgramAddressSync([Buffer.from("event"), SPACEX.toBuffer()], program.programId)[0];
  const pda = (o: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("order"), o.toBuffer(), SPACEX.toBuffer()], program.programId)[0];
  const ata = getAssociatedTokenAddressSync(SPACEX, holder.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // Reachable order: 0.4 raw SPACEX at a 35% limit.
  const reachable = pda(holder.publicKey);
  if (!(await conn.getAccountInfo(reachable))) {
    const ix = await program.methods
      .createOrder({ size: new BN(400_000_000), limitBps: 3500, fallbackTs: new BN(Math.floor(Date.parse("2027-03-01T00:00:00Z") / 1000)), fallbackFloorBps: 5000 })
      .accountsStrict({ owner: holder.publicKey, event: eventPda, inputMint: SPACEX, ownerTokenIn: ata, order: reachable, systemProgram: SystemProgram.programId })
      .instruction();
    await sendAndConfirmTransaction(conn, new Transaction().add(ix, createApproveCheckedInstruction(ata, SPACEX, reachable, holder.publicKey, 400_000_000n, 9, [], TOKEN_2022_PROGRAM_ID)), [holder], { commitment: "confirmed" });
    console.log("created reachable order", reachable.toBase58());
  }
  const unreachable = pda(holder2.publicKey);

  const attempts = [
    ...(await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: reachable })),
    ...(await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: unreachable })),
  ];
  for (const a of attempts) console.log(`${a.action.toUpperCase().padEnd(8)} ${a.order.slice(0, 8)}: ${a.reason}${a.amountIn ? ` | in ${a.amountIn} out ${a.quotedOut} min ${a.required}` : ""}${a.signature ? ` | ${a.signature}` : ""}`);

  const keeperTokens = await conn.getTokenAccountsByOwner(keeper.publicKey, { programId: TOKEN_2022_PROGRAM_ID });
  const filled = attempts.find((a) => a.order === reachable.toBase58())?.action === "filled";
  const waiting = attempts.find((a) => a.order === unreachable.toBase58())?.action === "waiting";
  const clean = keeperTokens.value.length === 0;
  console.log(`${filled ? "PASS" : "FAIL"}  reachable order filled`);
  console.log(`${waiting ? "PASS" : "FAIL"}  10% order left waiting`);
  console.log(`${clean ? "PASS" : "FAIL"}  keeper holds no token accounts`);
  fs.writeFileSync(path.join(ROOT, "data/keeper-devnet.json"), JSON.stringify({ ranAt: new Date().toISOString(), network: "devnet", attempts, keeperTokenAccounts: keeperTokens.value.length }, null, 2) + "\n");
  process.exit(filled && waiting && clean ? 0 : 1);
}
main().catch((e) => { console.error("KEEPER TEST FAILED:", e?.message ?? e); process.exit(2); });
