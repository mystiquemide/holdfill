import type { NextRequest } from "next/server";
import { relay } from "@/server/tx";
import { rateLimit } from "@/server/rate-limit";

export const maxDuration = 60;

/** POST { tx } relays a holder-signed Holdfill transaction to devnet and waits for confirmation. */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "send", 30);
  if (limited) return limited;
  const b = (await request.json().catch(() => ({}))) as { tx?: string };
  if (!b.tx) return Response.json({ error: "tx is required" }, { status: 400 });
  const result = await relay(b.tx);
  if (!result.ok) return Response.json({ error: result.error, code: result.code }, { status: result.status });
  return Response.json({ network: "devnet", ...result });
}
