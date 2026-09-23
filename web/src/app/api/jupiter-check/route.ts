import { getJupiterCheck } from "@/server/jupiter-check";

export async function GET() {
  try {
    return Response.json(await getJupiterCheck(), { headers: { "Cache-Control": "public, s-maxage=60" } });
  } catch (e) {
    return Response.json({ error: "Jupiter check unavailable", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
