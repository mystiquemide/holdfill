import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { getOrderHistory } from "@/server/orders";
import { usdcMarket } from "@/server/usdc-markets";

export async function GET(request: NextRequest) {
  let owner: PublicKey;
  try {
    owner = new PublicKey(request.nextUrl.searchParams.get("owner") ?? "");
  } catch {
    return Response.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  const market = request.nextUrl.searchParams.get("market");
  let mint;
  if (market && market.toUpperCase() !== "SPACEX") {
    try { mint = usdcMarket(market).mint; } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  }
  try {
    return Response.json(await getOrderHistory(owner, mint), { headers: { "Cache-Control": "private, max-age=5" } });
  } catch (e) {
    return Response.json({ error: "order history unavailable", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
