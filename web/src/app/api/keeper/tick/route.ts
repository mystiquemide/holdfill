import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import { loadProgram } from "../../../../../../keeper/program";
import { tick } from "../../../../../../keeper/tick";
import { devnet, keypairFromEnv } from "@/server/env";
import { rateLimit } from "@/server/rate-limit";

// A fill waits for a devnet confirmation, so allow more than the default duration.
export const maxDuration = 60;

const lastCheck = new Map<string, number>();
const MIN_INTERVAL_MS = 5_000;

/**
 * POST { order } runs one keeper pass for that order ("Check now"). Anyone may call it: the program
 * enforces the holder's terms, so the worst a caller can do is trigger a fill the holder already
 * agreed to. A scheduled full pass needs the KEEPER_TICK_SECRET header.
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "tick", 20);
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as { order?: string };
  const secret = process.env.KEEPER_TICK_SECRET;
  const fullPass = !!secret && request.headers.get("x-keeper-secret") === secret;

  let order: PublicKey | undefined;
  if (!fullPass) {
    try {
      order = new PublicKey(body.order ?? "");
    } catch {
      return Response.json({ error: "The order must be a Holdfill order address." }, { status: 400 });
    }
    const key = order.toBase58();
    const last = lastCheck.get(key) ?? 0;
    const wait = MIN_INTERVAL_MS - (Date.now() - last);
    if (wait > 0) return Response.json({ error: "This order was checked moments ago.", retryAfterMs: wait }, { status: 429 });
    lastCheck.set(key, Date.now());
  }

  try {
    const keeper = keypairFromEnv("KEEPER_KEYPAIR");
    const connection = devnet();
    const program = loadProgram(connection, keeper);
    const attempts = await tick({ connection, program, keeper, cluster: "devnet", onlyOrder: order });
    if (order && attempts.length === 0) {
      return Response.json({ network: "devnet", checkedAt: new Date().toISOString(), attempts, note: "no active order at this address" });
    }
    return Response.json({ network: "devnet", checkedAt: new Date().toISOString(), attempts });
  } catch (e) {
    return Response.json({ error: "The keeper check failed. Try again in a moment.", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
