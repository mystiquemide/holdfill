import "server-only";
import {
  ComputeBudgetProgram, Keypair, PublicKey, SendTransactionError, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createApproveCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction, createRevokeInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN } from "@anchor-lang/core";
import { loadProgram, orders } from "../../../keeper/program";
import { DEVNET, SPACEX_TERMS, devnet } from "./env";
import { orderAddress } from "./orders";

export const FLOORS_BPS = [4000, 5000, 6000, 7000] as const;
const MAX_LIMIT_BPS = 6000;

export class TxInputError extends Error {}

const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);

async function unsigned(owner: PublicKey, ixs: TransactionInstruction[]) {
  const { blockhash, lastValidBlockHeight } = await devnet().getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(...ixs);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/** Create order plus capped approval to the order PDA, in one transaction the holder signs. */
export async function buildCreateOrder(p: { owner: PublicKey; sizeRaw: bigint; limitBps: number; fallbackTs: number; floorBps: number }) {
  const now = Math.floor(Date.now() / 1000);
  const deadline = Math.floor(Date.parse(SPACEX_TERMS.deadline) / 1000);
  if (p.sizeRaw <= 0n) throw new TxInputError("Enter an amount above zero.");
  if (!Number.isInteger(p.limitBps) || p.limitBps < 0 || p.limitBps > MAX_LIMIT_BPS) throw new TxInputError("The largest gap you can accept is 60%.");
  if (!FLOORS_BPS.includes(p.floorBps as (typeof FLOORS_BPS)[number])) throw new TxInputError("Pick a fallback floor of 40, 50, 60, or 70%.");
  if (!(p.fallbackTs > now && p.fallbackTs < deadline)) throw new TxInputError("The fallback date must be after today and before 12 Mar 2027.");

  const conn = devnet();
  const program = loadProgram(conn, Keypair.generate());
  const order = orderAddress(p.owner);
  const inAta = ata(p.owner, DEVNET.spacex);
  const [existing, balance] = await Promise.all([
    orders(program).fetchNullable(order),
    conn.getTokenAccountBalance(inAta, "confirmed").then((b) => BigInt(b.value.amount), () => 0n),
  ]);
  if (existing) throw new TxInputError("You already have an order. Revoke it before setting a new one.");
  if (p.sizeRaw > balance) throw new TxInputError("That is more replica SPACEX than you hold.");

  const create = await program.methods
    .createOrder({ size: new BN(p.sizeRaw.toString()), limitBps: p.limitBps, fallbackTs: new BN(p.fallbackTs), fallbackFloorBps: p.floorBps })
    .accountsStrict({
      owner: p.owner, event: DEVNET.lifecycleEvent, inputMint: DEVNET.spacex, ownerTokenIn: inAta, order,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const tx = await unsigned(p.owner, [
    createAssociatedTokenAccountIdempotentInstruction(p.owner, ata(p.owner, DEVNET.spcxx), p.owner, DEVNET.spcxx, TOKEN_2022_PROGRAM_ID),
    create,
    createApproveCheckedInstruction(inAta, DEVNET.spacex, order, p.owner, p.sizeRaw, 9, [], TOKEN_2022_PROGRAM_ID),
  ]);
  return { tx, order: order.toBase58() };
}

/** Close the order (if any) and remove the approval, in one transaction. */
export async function buildRevoke(owner: PublicKey) {
  const conn = devnet();
  const program = loadProgram(conn, Keypair.generate());
  const order = orderAddress(owner);
  const ixs: TransactionInstruction[] = [];
  if (await orders(program).fetchNullable(order)) {
    ixs.push(await program.methods.cancelOrder().accountsStrict({ owner, order }).instruction());
  }
  ixs.push(createRevokeInstruction(ata(owner, DEVNET.spacex), owner, [], TOKEN_2022_PROGRAM_ID));
  return { tx: await unsigned(owner, ixs), order: order.toBase58() };
}

const ALLOWED_PROGRAMS = new Set([
  DEVNET.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  ComputeBudgetProgram.programId.toBase58(), SystemProgram.programId.toBase58(),
]);

export type SendResult = { ok: true; signature: string; explorer: string } | { ok: false; status: number; error: string; code?: string };

/** Relays a holder-signed Holdfill transaction to devnet. Only Holdfill, token, and ATA instructions pass. */
export async function relay(base64: string): Promise<SendResult> {
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(base64, "base64"));
  } catch {
    return { ok: false, status: 400, error: "That is not a Solana transaction." };
  }
  if (tx.instructions.length === 0 || tx.instructions.some((ix) => !ALLOWED_PROGRAMS.has(ix.programId.toBase58()))) {
    return { ok: false, status: 400, error: "Only Holdfill order transactions can be sent here." };
  }
  if (!tx.verifySignatures(true)) return { ok: false, status: 400, error: "The transaction is not signed." };

  const conn = devnet();
  try {
    const signature = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
    const res = await conn.confirmTransaction(
      { signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight ?? (await conn.getBlockHeight()) + 150 },
      "confirmed",
    ).catch((e) => ({ value: { err: e } }));
    if (res.value.err) return { ok: false, status: 502, error: "The transaction failed on devnet.", code: JSON.stringify(res.value.err).slice(0, 120) };
    return { ok: true, signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` };
  } catch (e) {
    const logs = e instanceof SendTransactionError ? (e.logs ?? []) : [];
    const code = logs.find((l) => l.includes("Error Code:"))?.replace(/.*Error Code: (\w+).*/, "$1")
      ?? (String((e as Error).message).includes("Blockhash not found") ? "BlockhashExpired" : undefined);
    return { ok: false, status: 400, error: "Devnet rejected the transaction.", code };
  }
}
