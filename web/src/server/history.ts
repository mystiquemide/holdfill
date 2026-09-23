import "server-only";
import snapshot from "../../../data/haircut-history.json";
import { getMarket } from "./market";
import type { HistoryDay } from "./backtest";

export const HISTORY = snapshot as typeof snapshot & { days: HistoryDay[] };

export type History = {
  network: "mainnet";
  asOf: string;
  gapKind: "daily close";
  source: string;
  method: string;
  fetchedAt: string;
  days: HistoryDay[];
  unlocks: typeof snapshot.unlocks;
  /** Today's executable gap for 1 raw token. A different measure from the daily closes, kept apart on purpose. */
  live: { gapKind: "executable"; gapPct: number; source: string; asOf: string } | null;
};

/** The snapshot is static; only the live point is fetched (getMarket has its own 15 s cache). */
export async function getHistory(): Promise<History> {
  const market = await getMarket().catch(() => null);
  return {
    network: "mainnet",
    asOf: new Date().toISOString(),
    gapKind: "daily close",
    source: HISTORY.source,
    method: HISTORY.method,
    fetchedAt: HISTORY.fetchedAt,
    days: HISTORY.days,
    unlocks: HISTORY.unlocks,
    live: market
      ? { gapKind: "executable", gapPct: market.quote.value.executableGapPct, source: market.quote.source, asOf: market.quote.asOf }
      : null,
  };
}
