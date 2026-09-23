"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { backtest, type HistoryDay } from "@/server/backtest";
import { day, int, pct, utcTime } from "@/lib/format";
import { useLimit } from "./providers";
import { Button, NetBadge, Source } from "./ui";

type Unlock = { date: string; label: string };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

const Y_MAX = 45;

export function GapHistory({ days, unlocks }: { days: HistoryDay[]; unlocks: Unlock[] }) {
  const { limitBps, setLimitBps } = useLimit();
  const limitPct = limitBps / 100;
  const bt = useMemo(() => backtest(days, limitBps), [days, limitBps]);
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const h = width < 640 ? 260 : 340;
  const pad = { l: 40, r: 12, t: 16, b: 28 };
  const t0 = Date.parse(days[0].date), t1 = Date.parse(days[days.length - 1].date);
  const x = (iso: string) => pad.l + ((Date.parse(iso) - t0) / (t1 - t0)) * (width - pad.l - pad.r);
  const y = (g: number) => pad.t + (1 - g / Y_MAX) * (h - pad.t - pad.b);
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(d.date).toFixed(1)},${y(d.gapPct).toFixed(1)}`).join("");
  const inRange = unlocks.filter((u) => u.date >= days[0].date && u.date <= days[days.length - 1].date);
  const upcoming = unlocks.filter((u) => u.date > days[days.length - 1].date);
  const monthTicks = ["2026-07-01", "2026-08-01", "2026-09-01"];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = 0;
    days.forEach((d, i) => { if (Math.abs(x(d.date) - px) < Math.abs(x(days[best].date) - px)) best = i; });
    setHover(best);
  };
  const hd = hover !== null ? days[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="text-2xl tracking-[-0.01em]">The gap since listing</h3>
          <p className="mt-1 text-sm text-slate">Daily closes on the Meteora pool, priced in SPCXx. Drag your limit.</p>
        </div>
        <NetBadge net="mainnet" />
      </div>

      <div className="mt-6 flex items-center gap-4">
        <label htmlFor="chart-limit" className="shrink-0 text-sm">Your limit</label>
        <input id="chart-limit" type="range" min={0} max={45} step={1} value={limitPct} onChange={(e) => setLimitBps(Number(e.target.value) * 100)} className="limit w-full max-w-sm" />
        <span className="num w-12 text-right text-lg">{pct(limitPct, 0)}</span>
      </div>

      <div ref={ref} className="relative mt-4 w-full">
        {width > 0 && (
          <svg width={width} height={h} role="img" aria-label={`Daily gap between the pool price and the SPCXx entitlement from ${day(days[0].date)} to ${day(days[days.length - 1].date)}. The table below lists every day.`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="touch-pan-y select-none">
            {[0, 15, 30, 45].map((g) => (
              <g key={g}>
                <line x1={pad.l} x2={width - pad.r} y1={y(g)} y2={y(g)} stroke="#e5e7eb" />
                <text x={pad.l - 8} y={y(g) + 4} textAnchor="end" className="fill-slate font-mono text-[12px]">{g}%</text>
              </g>
            ))}
            {monthTicks.map((m) => (
              <text key={m} x={x(m)} y={h - 8} textAnchor="middle" className="fill-slate text-[12px]">{day(m).replace("1 ", "")}</text>
            ))}
            {inRange.map((u) => (
              <line key={u.date} x1={x(u.date)} x2={x(u.date)} y1={pad.t} y2={h - pad.b} stroke="#6f6f6f" strokeDasharray="3 4" />
            ))}
            <line x1={pad.l} x2={width - pad.r} y1={y(limitPct)} y2={y(limitPct)} stroke="#845a0c" strokeWidth={2} />
            <text x={width - pad.r} y={y(limitPct) - 6} textAnchor="end" className="fill-hold text-[12px]">your limit {pct(limitPct, 0)}</text>
            <path d={line} fill="none" stroke="#171717" strokeWidth={1.5} strokeLinejoin="round" />
            {days.map((d) => d.gapPct <= limitPct && <circle key={d.date} cx={x(d.date)} cy={y(d.gapPct)} r={3.5} fill="#17724b" />)}
            {hd && (
              <g>
                <line x1={x(hd.date)} x2={x(hd.date)} y1={pad.t} y2={h - pad.b} stroke="#171717" strokeOpacity={0.25} />
                <circle cx={x(hd.date)} cy={y(hd.gapPct)} r={5} fill="#fff" stroke="#171717" strokeWidth={1.5} />
              </g>
            )}
          </svg>
        )}
        {hd && (
          <div className="pointer-events-none absolute top-2 rounded-[14px] border border-hairline bg-paper px-3 py-2 text-xs shadow-[var(--shadow-lift)]" style={{ left: Math.min(Math.max(x(hd.date) - 80, 0), Math.max(width - 170, 0)) }}>
            <p className="text-ink">{day(hd.date, true)}</p>
            <p className="num mt-0.5">{pct(hd.gapPct)} gap, ${int(hd.volumeUsd)} volume</p>
            <p className={hd.gapPct <= limitPct ? "text-fill" : "text-slate"}>{hd.gapPct <= limitPct ? `A ${pct(limitPct, 0)} limit fills` : `A ${pct(limitPct, 0)} limit waits`}</p>
          </div>
        )}
      </div>

      <p className="mt-4 text-lg">
        Your {pct(limitPct, 0)} limit would have filled on <span className="num">{bt.fillDays} of {bt.tradingDays}</span> trading days.
        {bt.firstFill ? <> First: {day(bt.firstFill.date)}.</> : <> The gap never closed that far.</>}
      </p>
      <p className="mt-1 text-sm text-slate">
        Dashed lines mark dated lockup releases: {inRange.map((u) => day(u.date)).join(", ")}.
        {upcoming.length > 0 && <> Still ahead: {upcoming.map((u) => day(u.date)).join(", ")}.</>}
      </p>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer py-2 text-ink underline underline-offset-4">Show every day in a table</summary>
        <div className="mt-3 max-h-80 overflow-auto rounded-[14px] border border-hairline">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-vellum text-xs uppercase tracking-[0.06em] text-slate">
              <tr><th className="px-3 py-2 font-normal">Date</th><th className="px-3 py-2 font-normal">SPCXx per token</th><th className="px-3 py-2 font-normal">Gap</th><th className="px-3 py-2 font-normal">Volume</th><th className="px-3 py-2 font-normal">At {pct(limitPct, 0)}</th></tr>
            </thead>
            <tbody className="num divide-y divide-hairline">
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <td className="px-3 py-1.5">{d.date}</td>
                  <td className="px-3 py-1.5">{d.closeSpcxxPerToken.toFixed(4)}</td>
                  <td className="px-3 py-1.5">{pct(d.gapPct, 2)}</td>
                  <td className="px-3 py-1.5">${int(d.volumeUsd)}</td>
                  <td className={`px-3 py-1.5 ${d.gapPct <= limitPct ? "text-fill" : "text-slate"}`}>{d.gapPct <= limitPct ? "fills" : "waits"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <Source>Source: GeckoTerminal daily OHLCV for the SPACEX/SPCXx pool, close priced in SPCXx. Gap = 1 minus close / 5 SPCXx. Days without a trade are absent. Lockup dates as reported from the SpaceX prospectus.</Source>
    </div>
  );
}

type JupiterResult = {
  checkedAt: string;
  endpoint: string;
  prestocks: { httpStatus: number; accepted: boolean; response?: { error?: string } };
  control: { accepted: boolean; label: string; httpStatus: number };
};

export function JupiterCheck() {
  const [data, setData] = useState<JupiterResult | null>(null);
  const [state, setState] = useState<"idle" | "running" | "error">("running");

  const load = async () => {
    try {
      const res = await fetch("/api/jupiter-check", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
      setState("idle");
    } catch {
      setState("error");
    }
  };
  const run = () => { setState("running"); load(); };
  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, []);

  return (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-lg">Jupiter limit orders refuse PreStocks</h3><NetBadge net="mainnet" /></div>
      <p className="text-sm text-slate">We ask Jupiter&apos;s limit order API to create a SPACEX order, live, and the same order for SPCXx as a control.</p>
      <div className="mono mt-4 flex-1 break-all rounded-[14px] bg-vellum p-4 text-xs leading-relaxed">
        {data ? (
          <>
            <p className="text-slate">POST {data.endpoint.replace("https://", "")}</p>
            <p className="mt-2 break-words text-deadline">SPACEX: HTTP {data.prestocks.httpStatus}, &quot;{data.prestocks.response?.error?.replace("unable to validate create order request: ", "") ?? "refused"}&quot;</p>
            <p className="mt-2 text-fill">SPCXx control: HTTP {data.control.httpStatus}, {data.control.accepted ? "accepted" : "refused"}</p>
            <p className="mt-2 text-slate">Checked {utcTime(data.checkedAt)}</p>
          </>
        ) : state === "error" ? (
          <p className="text-deadline">Couldn&apos;t reach Jupiter just now. Try again.</p>
        ) : (
          <p className="text-slate">Asking Jupiter...</p>
        )}
      </div>
      <div className="mt-4"><Button variant="secondary" onClick={run} disabled={state === "running"}>{state === "running" ? "Checking..." : "Run the check again"}</Button></div>
    </div>
  );
}
