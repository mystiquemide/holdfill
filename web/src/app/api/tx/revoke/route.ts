import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { buildRevoke } from "@/server/tx";

/** POST { owner } returns an unsigned devnet transaction that closes the order and removes the approval. */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as { owner?: string };
  let owner: PublicKey;
  try {
    owner = new PublicKey(b.owner ?? "");
  } catch {
    return Response.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  try {
    return Response.json({ network: "devnet", ...(await buildRevoke(owner)) });
  } catch (e) {
    return Response.json({ error: "Couldn't build the revoke transaction.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
