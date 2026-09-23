import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { grant } from "@/server/faucet";
import { TxInputError } from "@/server/tx";
import { usdcMarket } from "@/server/usdc-markets";
import { rateLimit } from "@/server/rate-limit";

export const maxDuration = 60;

/** POST { owner, market? } sends 1 replica token, SPACEX by default (and a little devnet SOL if the wallet is empty). Devnet only. */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "faucet", 6);
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as { owner?: string; market?: string };
  let owner: PublicKey;
  try {
    owner = new PublicKey(body.owner ?? "");
  } catch {
    return Response.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  let market;
  try {
    market = body.market && body.market.toUpperCase() !== "SPACEX" ? usdcMarket(body.market) : undefined;
  } catch (e) {
    if (e instanceof TxInputError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const result = await grant(owner, market);
  if (!result.ok) return Response.json({ error: result.error, retryAt: result.retryAt }, { status: result.status });
  return Response.json(result);
}
