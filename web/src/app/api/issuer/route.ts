import { getIssuerView } from "@/server/issuer";

export async function GET() {
  try {
    return Response.json(await getIssuerView(), { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (e) {
    return Response.json({ error: "Couldn't read the issuer view. Try again in a moment.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
