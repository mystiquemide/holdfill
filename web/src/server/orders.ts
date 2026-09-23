import "server-only";
import { Keypair, PublicKey } from "@solana/web3.js";
import { EventParser } from "@anchor-lang/core";
import { loadProgram, orders } from "../../../keeper/program";
import { cached } from "./cache";
import { DEVNET, DEVNET_USDC, devnet } from "./env";

export type OrderEvent = {
  signature: string;
  time: string;
  kind: "created" | "filled" | "cancelled" | "rejected" | "armed" | "activated";
  sizeRaw?: string;
  limitBps?: number;
  amountInRaw?: string;
  amountOutRaw?: string;
  requiredRaw?: string;
  gapPct?: number;
  /** Price orders: least output per whole token. USDC fills: output per whole token received. */
  pricePerToken?: number;
  /** Fills that paid out in something other than SPCXx or USDC (an activated armed order's successor). */
  outAmount?: number;
  error?: string;
};

export type OrderHistory = { network: "devnet"; owner: string; order: string; asOf: string; events: OrderEvent[] };

export function orderAddress(owner: PublicKey, mint: PublicKey = DEVNET.spacex) {
  return PublicKey.findProgramAddressSync([Buffer.from("order"), owner.toBuffer(), mint.toBuffer()], DEVNET.programId)[0];
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));

async function loadHistory(owner: PublicKey, mint: PublicKey): Promise<OrderHistory> {
  const conn = devnet();
  const program = loadProgram(conn, Keypair.generate());
  const parser = new EventParser(program.programId, program.coder);
  const order = orderAddress(owner, mint);
  const spacex = mint.equals(DEVNET.spacex);
  // Non-SPACEX fills pay USDC unless the current order was activated into a successor token.
  const current = spacex ? null : await orders(program).fetchNullable(order);
  const successor = current && !current.outputMint.equals(DEVNET_USDC) && !("armed" in current.status) ? current.outputMint : null;
  const successorDecimals = successor ? ((await conn.getAccountInfo(successor, "confirmed"))?.data[44] ?? 6) : 6;
  const sigs = await conn.getSignaturesForAddress(order, { limit: 20 }, "confirmed");
  // One request per transaction, four at a time: the Helius free tier rejects batched JSON-RPC.
  const txs: Awaited<ReturnType<typeof conn.getTransaction>>[] = [];
  for (let i = 0; i < sigs.length; i += 4) {
    txs.push(...(await Promise.all(sigs.slice(i, i + 4).map((s) =>
      conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })))));
  }

  const events: OrderEvent[] = [];
  sigs.forEach((s, i) => {
    const tx = txs[i];
    const logs = tx?.meta?.logMessages ?? [];
    const time = new Date((s.blockTime ?? 0) * 1000).toISOString();
    if (s.err) {
      const code = logs.find((l) => l.includes("Error Code:"))?.replace(/.*Error Code: (\w+).*/, "$1") ?? "TransactionFailed";
      events.push({ signature: s.signature, time, kind: "rejected", error: code });
      return;
    }
    // Newest first overall, so a transaction's own events are reversed too (cancel then create reads create on top).
    for (const e of [...parser.parseLogs(logs)].reverse()) {
      const d = e.data as Record<string, unknown>;
      if (e.name === "orderCreated" || e.name === "OrderCreated") {
        events.push({ signature: s.signature, time, kind: "created", sizeRaw: str(d.size), limitBps: Number(d.limitBps) });
      } else if (e.name === "priceOrderCreated" || e.name === "PriceOrderCreated") {
        events.push({ signature: s.signature, time, kind: "created", sizeRaw: str(d.size), pricePerToken: Number(str(d.minOutPerToken)) / 1e6 });
      } else if (e.name === "orderArmed" || e.name === "OrderArmed") {
        events.push({ signature: s.signature, time, kind: "armed", sizeRaw: str(d.size), limitBps: Number(d.limitBps) });
      } else if (e.name === "orderActivated" || e.name === "OrderActivated") {
        events.push({ signature: s.signature, time, kind: "activated" });
      } else if (e.name === "orderFilled" || e.name === "OrderFilled") {
        const amountIn = Number(str(d.amountIn)), amountOut = Number(str(d.amountOut));
        // SPACEX: 1 raw token (1e9 base units) converts into 5 SPCXx (5e8 base units).
        // Other markets fill into USDC (6 decimals): report the price per whole token instead.
        const gapPct = spacex && amountIn > 0 ? (1 - amountOut / (amountIn / 2)) * 100 : undefined;
        const pricePerToken = !spacex && !successor && amountIn > 0 ? amountOut / 1e6 / (amountIn / 1e9) : undefined;
        const outAmount = successor ? amountOut / 10 ** successorDecimals : undefined;
        events.push({ signature: s.signature, time, kind: "filled", amountInRaw: str(d.amountIn), amountOutRaw: str(d.amountOut), requiredRaw: str(d.required), gapPct, pricePerToken, outAmount });
      } else if (e.name === "orderCancelled" || e.name === "OrderCancelled") {
        events.push({ signature: s.signature, time, kind: "cancelled", amountInRaw: str(d.filled), amountOutRaw: str(d.received) });
      }
    }
  });
  return { network: "devnet", owner: owner.toBase58(), order: order.toBase58(), asOf: new Date().toISOString(), events };
}

export const getOrderHistory = (owner: PublicKey, mint: PublicKey = DEVNET.spacex) =>
  cached(`orders:${mint.toBase58()}:${owner.toBase58()}`, 5_000, () => loadHistory(owner, mint));
