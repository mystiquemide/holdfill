import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { getPosition } from "@/server/position";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("owner") ?? "";
  let owner: PublicKey;
  try {
    owner = new PublicKey(raw);
  } catch {
    return Response.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  try {
    return Response.json(await getPosition(owner), { headers: { "Cache-Control": "private, max-age=5" } });
  } catch (e) {
    return Response.json({ error: "position unavailable", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
