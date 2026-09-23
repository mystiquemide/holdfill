// Records the devnet proof transactions for holdfill_orders:
//   registerEvent, orderCreated, filled, rejectedBelowMinimum, revoked, refusedAfterRevoke.
// Rejections are sent with preflight skipped so they land on chain as failed transactions
// anyone can open on Solana Explorer.
import fs from "node:fs";
import path from "node:path";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, createApproveCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction,
  createRevokeInstruction, getAccount, getAssociatedTokenAddressSync, mintTo,
} from "@solana/spl-token";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { buildExecuteIx, OrderAccount } from "../keeper/execute-ix";
import { ROOT, devnet, issuerKeypair, loadKeypair, readConfig, writeConfig } from "./lib/env";

const EXPIRY = Math.floor(Date.parse("2027-03-12T23:59:00Z") / 1000);
const FALLBACK = Math.floor(Date.parse("2027-03-01T00:00:00Z") / 1000);
const KEYS = "/root/.config/holdfill";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function keypairFile(name: string): Keypair {
  const file = path.join(KEYS, `${name}.json`);
  if (!fs.existsSync(file)) {
    const kp = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  }
  return loadKeypair("__unused__", file);
}

async function main() {
  const conn: Connection = devnet();
  const cfg = readConfig();
  const issuer = issuerKeypair();
  const holder = keypairFile("holder");
  const holder2 = keypairFile("holder2");
  const keeper = keypairFile("keeper");
  const SPACEX = new PublicKey(cfg.replicaSpacex!), SPCXX = new PublicKey(cfg.replicaSpcxx!), POOL = new PublicKey(cfg.pool!);
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "idl/holdfill_orders.json"), "utf8"));
  const program = new Program(idl, new AnchorProvider(conn, new Wallet(issuer), { commitment: "confirmed" }));
  const ata = (o: PublicKey, m: PublicKey) => getAssociatedTokenAddressSync(m, o, false, TOKEN_2022_PROGRAM_ID);
  const orderPda = (o: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("order"), o.toBuffer(), SPACEX.toBuffer()], program.programId)[0];
  const eventPda = PublicKey.findProgramAddressSync([Buffer.from("event"), SPACEX.toBuffer()], program.programId)[0];
  const proof: Record<string, { signature: string; explorer: string; result: string; detail?: string }> = {};
  const record = (name: string, signature: string, result: string, detail?: string) => {
    proof[name] = { signature, explorer: explorer(signature), result, ...(detail ? { detail } : {}) };
    console.log(`${name}: ${result}${detail ? ` (${detail})` : ""}\n  ${explorer(signature)}`);
  };

  // Fund participants from the issuer (devnet SOL only).
  for (const [kp, sol] of [[holder, 0.15], [holder2, 0.1], [keeper, 0.05]] as const) {
    if ((await conn.getBalance(kp.publicKey)) < sol * LAMPORTS_PER_SOL / 2) {
      await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: kp.publicKey, lamports: sol * LAMPORTS_PER_SOL })), [issuer]);
      await sleep(400);
    }
  }

  if (!(await conn.getAccountInfo(eventPda))) {
    const sig = await program.methods
      .registerEvent({ outputMint: SPCXX, pool: POOL, ratioNum: new BN(1), ratioDen: new BN(2), expiryTs: new BN(EXPIRY) })
      .accountsStrict({ admin: issuer.publicKey, inputMint: SPACEX, event: eventPda, systemProgram: SystemProgram.programId })
      .rpc();
    record("registerEvent", sig, "confirmed", "SPACEX replica to SPCXx replica, 5 shares per token, deadline 2027-03-12T23:59Z");
  }

  async function prepareHolder(h: Keypair) {
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(h.publicKey, ata(h.publicKey, SPACEX), h.publicKey, SPACEX, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountIdempotentInstruction(h.publicKey, ata(h.publicKey, SPCXX), h.publicKey, SPCXX, TOKEN_2022_PROGRAM_ID),
    ), [h]);
    const bal = (await getAccount(conn, ata(h.publicKey, SPACEX), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    if (bal < 1_000_000_000n) await mintTo(conn, issuer, SPACEX, ata(h.publicKey, SPACEX), issuer, 1_000_000_000n - bal, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  }

  async function createOrderTx(h: Keypair, size: BN, limitBps: number): Promise<string> {
    const pda = orderPda(h.publicKey);
    const ix = await program.methods
      .createOrder({ size, limitBps, fallbackTs: new BN(FALLBACK), fallbackFloorBps: 5000 })
      .accountsStrict({ owner: h.publicKey, event: eventPda, inputMint: SPACEX, ownerTokenIn: ata(h.publicKey, SPACEX), order: pda, systemProgram: SystemProgram.programId })
      .instruction();
    const approve = createApproveCheckedInstruction(ata(h.publicKey, SPACEX), SPACEX, pda, h.publicKey, BigInt(size.toString()), 9, [], TOKEN_2022_PROGRAM_ID);
    return sendAndConfirmTransaction(conn, new Transaction().add(ix, approve), [h], { commitment: "confirmed" });
  }

  async function executeIx(pda: PublicKey, order: OrderAccount, amount: BN): Promise<TransactionInstruction> {
    return (await buildExecuteIx({ program, connection: conn, orderPda: pda, order, amountIn: amount, keeper: keeper.publicKey, cluster: "devnet" })).ix;
  }

  /** Sends without preflight so a rejected fill lands on chain; returns signature and error code. */
  async function sendLanding(ix: TransactionInstruction): Promise<{ sig: string; err: string | null }> {
    const tx = new Transaction().add(ix);
    tx.feePayer = keeper.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(keeper);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig, "confirmed");
    const got = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = got?.meta?.logMessages ?? [];
    const code = logs.find((l) => l.includes("Error Code:"))?.replace(/.*Error Code: (\w+).*/, "$1")
      ?? (got?.meta?.err ? JSON.stringify(got.meta.err) : null);
    return { sig, err: code };
  }

  // 1. Holder creates an order at a reachable limit and the keeper fills part of it.
  await prepareHolder(holder);
  const pdaA = orderPda(holder.publicKey);
  if (await conn.getAccountInfo(pdaA)) throw new Error("holder already has an order; cancel it before re-running");
  record("orderCreated", await createOrderTx(holder, new BN(500_000_000), 3500), "confirmed", "0.5 raw SPACEX (2.5 shares), max haircut 35%, fallback 2027-03-01 at 50%, approval to order PDA");
  await sleep(800);

  const orderA = (await (program.account as any).order.fetch(pdaA)) as OrderAccount;
  const outBefore = (await getAccount(conn, ata(holder.publicKey, SPCXX), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const fillSig = await sendAndConfirmTransaction(conn, new Transaction().add(await executeIx(pdaA, orderA, new BN(100_000_000))), [keeper], { commitment: "confirmed" });
  const received = (await getAccount(conn, ata(holder.publicKey, SPCXX), "confirmed", TOKEN_2022_PROGRAM_ID)).amount - outBefore;
  const gap = 1 - Number(received) / 1e8 / 0.5;
  record("filled", fillSig, "confirmed", `keeper filled 0.1 raw SPACEX, holder received ${Number(received) / 1e8} SPCXx, ${(gap * 100).toFixed(1)}% gap incl. fees, minimum was 0.325`);
  await sleep(800);

  // 2. Second holder asks for a 10% limit; the pool pays about 29% under, so the program refuses.
  await prepareHolder(holder2);
  const pdaB = orderPda(holder2.publicKey);
  if (!(await conn.getAccountInfo(pdaB))) await createOrderTx(holder2, new BN(500_000_000), 1000);
  const orderB = (await (program.account as any).order.fetch(pdaB)) as OrderAccount;
  const rejected = await sendLanding(await executeIx(pdaB, orderB, new BN(100_000_000)));
  record("rejectedBelowMinimum", rejected.sig, `failed on chain: ${rejected.err}`, "10% limit needs at least 0.45 SPCXx for 0.1 raw; the pool pays about 0.354");
  await sleep(800);

  // 3. Holder revokes and cancels; a keeper fill built beforehand is refused.
  const staleIx = await executeIx(pdaA, orderA, new BN(100_000_000));
  const cancelIx = await program.methods.cancelOrder().accountsStrict({ owner: holder.publicKey, order: pdaA }).instruction();
  const revokeSig = await sendAndConfirmTransaction(conn, new Transaction().add(cancelIx, createRevokeInstruction(ata(holder.publicKey, SPACEX), holder.publicKey, [], TOKEN_2022_PROGRAM_ID)), [holder], { commitment: "confirmed" });
  record("revoked", revokeSig, "confirmed", "order closed and token approval revoked in one transaction");
  await sleep(800);
  const refused = await sendLanding(staleIx);
  record("refusedAfterRevoke", refused.sig, `failed on chain: ${refused.err}`, "keeper fill sent after the holder revoked");

  cfg.programId = program.programId.toBase58();
  cfg.lifecycleEvent = eventPda.toBase58();
  cfg.proofTransactions = { ...(cfg.proofTransactions ?? {}), ...Object.fromEntries(Object.entries(proof).map(([k, v]) => [k, v.signature])) };
  writeConfig(cfg);
  fs.writeFileSync(path.join(ROOT, "data/proof-devnet.json"), JSON.stringify({
    ranAt: new Date().toISOString(), network: "devnet", programId: program.programId.toBase58(),
    lifecycleEvent: eventPda.toBase58(), pool: POOL.toBase58(), transactions: proof,
  }, null, 2) + "\n");
  const ok = proof.filled?.result === "confirmed" && proof.rejectedBelowMinimum?.result.startsWith("failed") && proof.refusedAfterRevoke?.result.startsWith("failed");
  console.log(ok ? "\nPASS  devnet proof recorded" : "\nFAIL  unexpected outcome");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("PROOF FAILED:", e?.message ?? e, (e?.logs ?? []).slice(-5).join("\n")); process.exit(2); });
