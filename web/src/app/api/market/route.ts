import { getMarket } from "@/server/market";

export async function GET() {
  try {
    const market = await getMarket();
    return Response.json(market, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch (e) {
    return Response.json({ error: "Couldn't read market data. Try again in a moment.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
