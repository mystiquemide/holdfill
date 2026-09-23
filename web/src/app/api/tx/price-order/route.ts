import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { TxInputError } from "@/server/tx";
import { buildPriceOrder } from "@/server/usdc-markets";
import { rateLimit } from "@/server/rate-limit";

/** POST { owner, market, sizeRaw, usdPerToken, expiryDays } returns an unsigned devnet price order for the holder to sign. */
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
    return Response.json({ error: "The owner and sizeRaw fields are required." }, { status: 400 });
  }
  try {
    const built = await buildPriceOrder({ owner, symbol: String(b.market ?? ""), sizeRaw, usdPerToken: Number(b.usdPerToken), expiryDays: Number(b.expiryDays) });
    return Response.json({ network: "devnet", ...built });
  } catch (e) {
    if (e instanceof TxInputError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: "Couldn't build the price order.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
