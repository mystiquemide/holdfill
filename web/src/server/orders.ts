import "server-only";
import { Keypair, PublicKey } from "@solana/web3.js";
import { EventParser } from "@anchor-lang/core";
import { loadProgram } from "../../../keeper/program";
import { cached } from "./cache";
import { DEVNET, devnet } from "./env";

export type OrderEvent = {
  signature: string;
  time: string;
  kind: "created" | "filled" | "cancelled" | "rejected";
  sizeRaw?: string;
  limitBps?: number;
  amountInRaw?: string;
  amountOutRaw?: string;
  requiredRaw?: string;
  gapPct?: number;
  error?: string;
};

export type OrderHistory = { network: "devnet"; owner: string; order: string; asOf: string; events: OrderEvent[] };

export function orderAddress(owner: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("order"), owner.toBuffer(), DEVNET.spacex.toBuffer()], DEVNET.programId)[0];
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));

async function loadHistory(owner: PublicKey): Promise<OrderHistory> {
  const conn = devnet();
  const program = loadProgram(conn, Keypair.generate());
  const parser = new EventParser(program.programId, program.coder);
  const order = orderAddress(owner);
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
      } else if (e.name === "orderFilled" || e.name === "OrderFilled") {
        const amountIn = Number(str(d.amountIn)), amountOut = Number(str(d.amountOut));
        // Entitlement: 1 raw token (1e9 base units) converts into 5 SPCXx (5e8 base units).
        const gapPct = amountIn > 0 ? (1 - amountOut / (amountIn / 2)) * 100 : undefined;
        events.push({ signature: s.signature, time, kind: "filled", amountInRaw: str(d.amountIn), amountOutRaw: str(d.amountOut), requiredRaw: str(d.required), gapPct });
      } else if (e.name === "orderCancelled" || e.name === "OrderCancelled") {
        events.push({ signature: s.signature, time, kind: "cancelled", amountInRaw: str(d.filled), amountOutRaw: str(d.received) });
      }
    }
  });
  return { network: "devnet", owner: owner.toBase58(), order: order.toBase58(), asOf: new Date().toISOString(), events };
}

export const getOrderHistory = (owner: PublicKey) => cached(`orders:${owner.toBase58()}`, 5_000, () => loadHistory(owner));
