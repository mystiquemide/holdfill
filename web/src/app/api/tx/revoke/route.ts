import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { buildRevoke } from "@/server/tx";
import { usdcMarket } from "@/server/usdc-markets";

/** POST { owner, market? } returns an unsigned devnet transaction that closes the order and removes the approval. */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as { owner?: string; market?: string };
  let owner: PublicKey;
  try {
    owner = new PublicKey(b.owner ?? "");
  } catch {
    return Response.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  let mint;
  if (b.market && b.market.toUpperCase() !== "SPACEX") {
    try { mint = usdcMarket(b.market).mint; } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  }
  try {
    return Response.json({ network: "devnet", ...(await buildRevoke(owner, mint)) });
  } catch (e) {
    return Response.json({ error: "Couldn't build the revoke transaction.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
