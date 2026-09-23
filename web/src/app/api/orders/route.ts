import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { getOrderHistory } from "@/server/orders";

export async function GET(request: NextRequest) {
  let owner: PublicKey;
  try {
    owner = new PublicKey(request.nextUrl.searchParams.get("owner") ?? "");
  } catch {
    return Response.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  try {
    return Response.json(await getOrderHistory(owner), { headers: { "Cache-Control": "private, max-age=5" } });
  } catch (e) {
    return Response.json({ error: "order history unavailable", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
