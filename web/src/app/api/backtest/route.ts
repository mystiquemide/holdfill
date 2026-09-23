import type { NextRequest } from "next/server";
import { backtest, parseLimitBps } from "@/server/backtest";
import { HISTORY } from "@/server/history";

export async function GET(request: NextRequest) {
  const limitBps = parseLimitBps(request.nextUrl.searchParams.get("limit") ?? "2000");
  if (limitBps === null) return Response.json({ error: "The limit must be basis points from 0 to 6000." }, { status: 400 });
  return Response.json(
    { network: "mainnet", asOf: new Date().toISOString(), gapKind: "daily close", source: HISTORY.source, ...backtest(HISTORY.days, limitBps) },
    { headers: { "Cache-Control": "public, s-maxage=600" } },
  );
}
