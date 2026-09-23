import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { getPosition } from "@/server/position";
import { getMarketPosition, usdcMarket } from "@/server/usdc-markets";
import { rateLimit } from "@/server/rate-limit";

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "position", 60);
  if (limited) return limited;
  const raw = request.nextUrl.searchParams.get("owner") ?? "";
  let owner: PublicKey;
  try {
    owner = new PublicKey(raw);
  } catch {
    return Response.json({ error: "The owner must be a Solana address." }, { status: 400 });
  }
  const market = request.nextUrl.searchParams.get("market");
  if (market && market.toUpperCase() !== "SPACEX") {
    let m;
    try { m = usdcMarket(market); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    try {
      return Response.json(await getMarketPosition(owner, m), { headers: { "Cache-Control": "private, max-age=5" } });
    } catch (e) {
      return Response.json({ error: "Couldn't read this position. Try again in a moment.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
    }
  }
  try {
    return Response.json(await getPosition(owner), { headers: { "Cache-Control": "private, max-age=5" } });
  } catch (e) {
    return Response.json({ error: "Couldn't read this position. Try again in a moment.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
