// Pure backtest math over the daily close gap series. No I/O, so it runs under node:test.

export type HistoryDay = { date: string; closeSpcxxPerToken: number; gapPct: number; volumeUsd: number };

export type Backtest = {
  limitPct: number;
  tradingDays: number;
  fillDays: number;
  /** Days whose close gap was at or under the limit, oldest first. */
  fills: { date: string; gapPct: number }[];
  /** First day a standing order at this limit would have filled, with that day's close gap. */
  firstFill: { date: string; gapPct: number } | null;
  period: { from: string; to: string };
};

/** Parses a limit in basis points (0 to 6000, the order ticket's range). Returns null when invalid. */
export function parseLimitBps(raw: string | null): number | null {
  if (raw === null || !/^\d{1,4}$/.test(raw)) return null;
  const bps = Number(raw);
  return bps <= 6000 ? bps : null;
}

export function backtest(days: HistoryDay[], limitBps: number): Backtest {
  if (days.length === 0) throw new Error("empty history");
  const limitPct = limitBps / 100;
  const fills = days.filter((d) => d.gapPct <= limitPct).map(({ date, gapPct }) => ({ date, gapPct }));
  return {
    limitPct,
    tradingDays: days.length,
    fillDays: fills.length,
    fills,
    firstFill: fills[0] ?? null,
    period: { from: days[0].date, to: days[days.length - 1].date },
  };
}
