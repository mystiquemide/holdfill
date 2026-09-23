import { getHistory } from "@/server/history";

export async function GET() {
  return Response.json(await getHistory(), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" } });
}
