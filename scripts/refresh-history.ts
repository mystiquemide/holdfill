// Refreshes data/haircut-history.json: the daily close gap between what the SPACEX/SPCXx pool paid
// and the SPCXx entitlement (5 SPCXx per raw token), since the pool listed on 12 Jun 2026.
//
// The close comes from GeckoTerminal's pool OHLCV priced in the quote token, so each value is SPCXx
// received per raw SPACEX on the last trade of the UTC day, fees included, with no USD conversion.
// Days without a trade are absent. The current UTC day is left out because its bar is still open.
import fs from "node:fs";
import path from "node:path";
import { MAINNET, ROOT } from "./lib/env";

const OUT = path.join(ROOT, "data/haircut-history.json");
const SHARES_PER_TOKEN = 5;
const BASE = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${MAINNET.pool.toBase58()}/ohlcv/day`;

// SpaceX IPO lockup releases with a fixed date, from the prospectus lockup section as reported by
// the sources below. Earnings-triggered releases without a fixed date are left out.
const UNLOCKS = [
  { date: "2026-08-06", label: "First release, 20% of the 180-day block" },
  { date: "2026-08-20", label: "Up to 7% of the block" },
  { date: "2026-09-09", label: "Up to 7% of the block" },
  { date: "2026-09-24", label: "Up to 7% of the block" },
  { date: "2026-10-09", label: "Up to 7% of the block" },
  { date: "2026-10-24", label: "Up to 7% of the block" },
  { date: "2026-12-08", label: "180-day lockup expires" },
];
const UNLOCK_SOURCES = [
  "https://purepowerpicks.com/spacex-lockup-schedule/",
  "https://darrowwealthmanagement.com/blog/spacex-ipo-employee-lockup-release-dates/",
];

type Ohlcv = { data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } };

async function series(currency: "token" | "usd") {
  const res = await fetch(`${BASE}?aggregate=1&limit=1000&currency=${currency}&token=base`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GeckoTerminal ${currency} OHLCV returned ${res.status}`);
  const body = (await res.json()) as Ohlcv;
  return new Map(body.data.attributes.ohlcv_list.map((r) => [r[0], r]));
}

async function main() {
  const [token, usd] = [await series("token"), await series("usd")];
  const today = Math.floor(Date.now() / 86_400_000) * 86_400;
  const days = [...token.values()]
    .filter(([ts]) => ts < today)
    .sort((a, b) => a[0] - b[0])
    .map(([ts, , , , close]) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      closeSpcxxPerToken: Number(close.toFixed(6)),
      gapPct: Number(((1 - close / SHARES_PER_TOKEN) * 100).toFixed(2)),
      volumeUsd: Math.round(usd.get(ts)?.[5] ?? 0),
    }));
  if (days.length === 0) throw new Error("no completed days returned");

  const snapshot = {
    network: "mainnet",
    pool: MAINNET.pool.toBase58(),
    source: `GeckoTerminal daily OHLCV for ${MAINNET.pool.toBase58()}, priced in SPCXx (close), volume in USD`,
    method: "gapPct = 1 - close / 5, where close is SPCXx received per raw SPACEX on the day's last trade (fees included) and 5 SPCXx is the entitlement per raw token",
    fetchedAt: new Date().toISOString(),
    firstDay: days[0].date,
    lastDay: days[days.length - 1].date,
    days,
    unlocks: { source: UNLOCK_SOURCES, dates: UNLOCKS },
  };
  fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${days.length} trading days, ${snapshot.firstDay} to ${snapshot.lastDay}`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
