import "server-only";

// Per-client request budget for routes that call Solana RPC, so one script can't spend the shared
// RPC quota the keeper also depends on. In memory, per instance; a restart resets it.
const windows = new Map<string, number[]>();
const WINDOW_MS = 60_000;

function clientId(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

/** Returns a 429 response when this client used `perMinute` requests on `bucket` in the last minute. */
export function rateLimit(request: Request, bucket: string, perMinute: number): Response | null {
  const now = Date.now();
  const key = `${bucket}:${clientId(request)}`;
  const hits = (windows.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= perMinute) {
    const retryAfterMs = WINDOW_MS - (now - hits[0]);
    windows.set(key, hits);
    return Response.json(
      { error: "Too many requests. Wait a moment and try again.", retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }
  hits.push(now);
  windows.set(key, hits);
  if (windows.size > 10_000) {
    for (const [k, v] of windows) if (now - v[v.length - 1] > WINDOW_MS) windows.delete(k);
    // Still too many live keys means someone is rotating identities: start over rather than grow.
    if (windows.size > 20_000) windows.clear();
  }
  return null;
}
