import { getMarkets } from "@/server/markets";

export async function GET() {
  try {
    return Response.json(await getMarkets(), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (e) {
    return Response.json({ error: "markets data unavailable", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
