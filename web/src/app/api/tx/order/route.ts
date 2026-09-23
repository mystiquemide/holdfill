import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { TxInputError, buildCreateOrder } from "@/server/tx";
import { rateLimit } from "@/server/rate-limit";

/** POST { owner, sizeRaw, limitBps, fallbackTs, floorBps } returns an unsigned devnet transaction for the holder to sign. */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "tx", 30);
  if (limited) return limited;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let owner: PublicKey;
  let sizeRaw: bigint;
  try {
    owner = new PublicKey(String(b.owner ?? ""));
    sizeRaw = BigInt(String(b.sizeRaw ?? ""));
  } catch {
    return Response.json({ error: "owner and sizeRaw are required" }, { status: 400 });
  }
  try {
    const built = await buildCreateOrder({ owner, sizeRaw, limitBps: Number(b.limitBps), fallbackTs: Number(b.fallbackTs), floorBps: Number(b.floorBps) });
    return Response.json({ network: "devnet", ...built });
  } catch (e) {
    if (e instanceof TxInputError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: "Couldn't build the order transaction.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
