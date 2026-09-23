import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { getOrderHistory } from "@/server/orders";
import { usdcMarket } from "@/server/usdc-markets";
import { rateLimit } from "@/server/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "orders", 60);
  if (limited) return limited;
  let owner: PublicKey;
  try {
    owner = new PublicKey(request.nextUrl.searchParams.get("owner") ?? "");
  } catch {
    return Response.json({ error: "The owner must be a Solana address." }, { status: 400 });
  }
  const market = request.nextUrl.searchParams.get("market");
  let mint;
  if (market && market.toUpperCase() !== "SPACEX") {
    try { mint = usdcMarket(market).mint; } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  }
  try {
    return Response.json(await getOrderHistory(owner, mint), { headers: { "Cache-Control": "private, max-age=5" } });
  } catch (e) {
    return Response.json({ error: "Couldn't read order history. Try again in a moment.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
