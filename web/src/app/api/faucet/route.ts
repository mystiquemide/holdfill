import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { grant } from "@/server/faucet";

export const maxDuration = 60;

/** POST { owner } sends 1 replica SPACEX (and a little devnet SOL if the wallet is empty). Devnet only. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { owner?: string };
  let owner: PublicKey;
  try {
    owner = new PublicKey(body.owner ?? "");
  } catch {
    return Response.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  const result = await grant(owner);
  if (!result.ok) return Response.json({ error: result.error, retryAt: result.retryAt }, { status: result.status });
  return Response.json(result);
}
