// One keeper pass: scan active orders, decide per order whether the pool pays at least the holder's
// minimum, and fill the largest amount that does. Anyone can run this; the program enforces terms.
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAccount,
  getAssociatedTokenAddressSync, getEpochFee, getMint, getPausableConfig, getTransferFeeConfig,
} from "@solana/spl-token";
import { BN, Program } from "@anchor-lang/core";
import DLMM from "@meteora-ag/dlmm";
import { buildExecuteIx } from "./execute-ix";
import { orderKind, orders, type OrderData } from "./program";
import { haircutBps, requiredOutput } from "./math";

export type Attempt = {
  order: string;
  owner: string;
  action: "filled" | "waiting" | "skipped" | "failed" | "activated";
  reason: string;
  remaining: string;
  haircutBps: number;
  amountIn?: string;
  quotedOut?: string;
  required?: string;
  signature?: string;
};

type OrderRecord = { publicKey: PublicKey; account: OrderData };

const SEARCH_STEPS = 24;

function quoteOut(dlmm: DLMM, bins: Awaited<ReturnType<DLMM["getBinArrayForSwap"]>>, amount: bigint): bigint {
  try {
    return BigInt(dlmm.swapQuote(new BN(amount.toString()), true, new BN(0), bins).outAmount.toString());
  } catch {
    return 0n; // amount beyond available liquidity
  }
}

/**
 * Largest amount in [minChunk, remaining] whose quote meets the holder's minimum. Price impact grows
 * with size, so "meets the minimum" is monotone in amount and binary search applies.
 */
export function bestFill(
  quote: (amount: bigint) => bigint, required: (amount: bigint) => bigint, remaining: bigint, minChunk: bigint,
): { amount: bigint; out: bigint } | null {
  const ok = (a: bigint) => quote(a) >= required(a);
  if (ok(remaining)) return { amount: remaining, out: quote(remaining) };
  if (minChunk > remaining || !ok(minChunk)) return null;
  let lo = minChunk, hi = remaining;
  for (let i = 0; i < SEARCH_STEPS && hi - lo > 1n; i++) {
    const mid = (lo + hi) / 2n;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return { amount: lo, out: quote(lo) };
}

export async function tick(params: {
  connection: Connection;
  program: Program;
  keeper: Keypair;
  cluster: "devnet" | "mainnet-beta";
  onlyOrder?: PublicKey;
  log?: (a: Attempt) => void;
}): Promise<Attempt[]> {
  const { connection, program, keeper, cluster } = params;
  const log = params.log ?? (() => {});
  const attempts: Attempt[] = [];
  const push = (a: Attempt) => { attempts.push(a); log(a); };

  // One order: fetch it directly. All orders: one program-account scan.
  const all: OrderRecord[] = params.onlyOrder
    ? await orders(program).fetchNullable(params.onlyOrder).then((acc) => (acc ? [{ publicKey: params.onlyOrder!, account: acc }] : []))
    : await orders(program).all();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const { epoch } = await connection.getEpochInfo("confirmed");
  const pools = new Map<string, DLMM>();
  const tokenPrograms = new Map<string, PublicKey>();
  const tokenProgramOf = async (mint: PublicKey) => {
    const hit = tokenPrograms.get(mint.toBase58());
    if (hit) return hit;
    const info = await connection.getAccountInfo(mint, "confirmed");
    if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
    tokenPrograms.set(mint.toBase58(), info.owner);
    return info.owner;
  };

  for (const { publicKey, account: o } of all) {
    const remaining = BigInt(o.size.toString()) - BigInt(o.filled.toString());
    const base = { order: publicKey.toBase58(), owner: o.owner.toBase58(), remaining: remaining.toString() };
    const haircut = haircutBps(now, BigInt(o.fallbackTs.toString()), BigInt(o.limitBps), BigInt(o.fallbackFloorBps));
    const skip = (reason: string) => push({ ...base, action: "skipped", reason, haircutBps: Number(haircut) });

    const kind = orderKind(o);

    // Armed: copy the issuer's terms in once the event exists. Anyone may send this.
    if (kind === "armed") {
      const event = PublicKey.findProgramAddressSync([Buffer.from("event"), o.inputMint.toBuffer()], program.programId)[0];
      if (!(await connection.getAccountInfo(event, "confirmed"))) continue;
      try {
        const ix = await program.methods.activate().accountsStrict({ order: publicKey, event }).instruction();
        const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [keeper], { commitment: "confirmed" });
        push({ ...base, action: "activated", haircutBps: o.limitBps, signature, reason: "issuer named a successor; terms copied in" });
      } catch (e: any) {
        push({ ...base, action: "failed", haircutBps: o.limitBps, reason: `activate: ${String(e?.message ?? e).split("\n")[0].slice(0, 120)}` });
      }
      continue;
    }

    if (!("active" in o.status) || remaining <= 0n) continue;
    if (now >= BigInt(o.expiryTs.toString())) { skip(kind === "price" ? "order expired" : "issuer deadline passed"); continue; }

    // Issuer state must match what the holder signed.
    const mint = await getMint(connection, o.inputMint, "confirmed", TOKEN_2022_PROGRAM_ID);
    if (getPausableConfig(mint)?.paused) { skip("issuer paused the token"); continue; }
    const feeConfig = getTransferFeeConfig(mint);
    const fee = feeConfig ? Number(getEpochFee(feeConfig, BigInt(epoch)).transferFeeBasisPoints) : 0;
    if (fee !== o.feeBps) { skip(`issuer changed the transfer fee from ${o.feeBps} to ${fee} bps`); continue; }

    // Holder accounts: approval still in place, and an account to receive the output. An activated
    // armed order pays out in a successor token the holder may never have held, so the keeper
    // creates that account in the fill transaction (owned by the holder; the keeper pays the rent).
    const inAta = getAssociatedTokenAddressSync(o.inputMint, o.owner, false, TOKEN_2022_PROGRAM_ID);
    const outProgram = await tokenProgramOf(o.outputMint);
    const outAta = getAssociatedTokenAddressSync(o.outputMint, o.owner, false, outProgram);
    const inAcct = await getAccount(connection, inAta, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null);
    if (!inAcct?.delegate?.equals(publicKey)) { skip("holder removed the approval"); continue; }
    const createOut = (await connection.getAccountInfo(outAta, "confirmed"))
      ? null
      : createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, outAta, o.owner, o.outputMint, outProgram);
    const fillable = [remaining, inAcct.delegatedAmount, inAcct.amount].reduce((a, b) => (a < b ? a : b));

    let dlmm = pools.get(o.pool.toBase58());
    if (!dlmm) { dlmm = await DLMM.create(connection, o.pool, { cluster: cluster as never }); pools.set(o.pool.toBase58(), dlmm); }
    await dlmm.refetchStates();
    const bins = await dlmm.getBinArrayForSwap(true, 8);
    const required = (a: bigint) => requiredOutput(a, BigInt(o.ratioNum.toString()), BigInt(o.ratioDen.toString()), haircut);
    const minChunk = (() => { const c = BigInt(o.size.toString()) / 100n; return c > 1_000_000n ? c : 1_000_000n; })();
    const best = bestFill((a) => quoteOut(dlmm!, bins, a), required, fillable, minChunk);

    if (!best) {
      const probe = fillable < minChunk ? fillable : minChunk;
      const q = quoteOut(dlmm, bins, probe);
      const req = required(probe);
      const entitlement = requiredOutput(probe, BigInt(o.ratioNum.toString()), BigInt(o.ratioDen.toString()), 0n);
      const gap = entitlement > 0n ? 1 - Number(q) / Number(entitlement) : 0;
      push({ ...base, action: "waiting", haircutBps: Number(haircut), amountIn: probe.toString(), quotedOut: q.toString(), required: req.toString(),
        reason: kind === "price"
          ? `pool pays ${Math.abs(gap * 100).toFixed(1)}% ${gap > 0 ? "below" : "above"} the holder's price`
          : `pool pays ${(gap * 100).toFixed(1)}% under entitlement, limit is ${(Number(haircut) / 100).toFixed(1)}%` });
      continue;
    }

    try {
      const { ix } = await buildExecuteIx({
        program, connection, orderPda: publicKey, order: o, amountIn: new BN(best.amount.toString()),
        keeper: keeper.publicKey, keeperMinOut: new BN(required(best.amount).toString()), cluster, dlmm,
      });
      const tx = createOut ? new Transaction().add(createOut, ix) : new Transaction().add(ix);
      const signature = await sendAndConfirmTransaction(connection, tx, [keeper], { commitment: "confirmed" });
      push({ ...base, action: "filled", haircutBps: Number(haircut), amountIn: best.amount.toString(), quotedOut: best.out.toString(),
        required: required(best.amount).toString(), signature,
        reason: best.amount === remaining ? "filled the remaining size" : "partial fill sized to available liquidity" });
    } catch (e: any) {
      const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
      const code = logs.find((l) => l.includes("Error Code:"))?.replace(/.*Error Code: (\w+).*/, "$1") ?? String(e?.message ?? e).split("\n")[0].slice(0, 120);
      push({ ...base, action: "failed", haircutBps: Number(haircut), amountIn: best.amount.toString(), quotedOut: best.out.toString(), required: required(best.amount).toString(), reason: code });
    }
  }
  return attempts;
}
