import { test } from "node:test";
import assert from "node:assert/strict";
import { backtest, parseLimitBps, type HistoryDay } from "./backtest";

const day = (date: string, gapPct: number): HistoryDay => ({ date, gapPct, closeSpcxxPerToken: 5 * (1 - gapPct / 100), volumeUsd: 0 });
const FIXTURE = [day("2026-06-12", 34.28), day("2026-06-13", 22.16), day("2026-08-04", 18.2), day("2026-08-05", 20), day("2026-09-22", 29.06)];

test("counts days at or under the limit", () => {
  const r = backtest(FIXTURE, 2000);
  assert.equal(r.tradingDays, 5);
  assert.equal(r.fillDays, 2);
  assert.deepEqual(r.fills.map((f) => f.date), ["2026-08-04", "2026-08-05"]);
});

test("a day exactly at the limit fills", () => assert.equal(backtest(FIXTURE, 1820).fillDays, 1));

test("first fill is the earliest qualifying day with its gap", () =>
  assert.deepEqual(backtest(FIXTURE, 2300).firstFill, { date: "2026-06-13", gapPct: 22.16 }));

test("no fill below the lowest gap", () => {
  const r = backtest(FIXTURE, 1000);
  assert.equal(r.fillDays, 0);
  assert.equal(r.firstFill, null);
});

test("period spans the series", () => assert.deepEqual(backtest(FIXTURE, 0).period, { from: "2026-06-12", to: "2026-09-22" }));

test("limit parsing accepts 0 to 6000 bps only", () => {
  assert.equal(parseLimitBps("2000"), 2000);
  assert.equal(parseLimitBps("0"), 0);
  assert.equal(parseLimitBps("6000"), 6000);
  for (const bad of [null, "", "6001", "-5", "20.5", "abc", "99999"]) assert.equal(parseLimitBps(bad), null, String(bad));
});
