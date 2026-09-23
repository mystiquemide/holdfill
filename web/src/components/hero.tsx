"use client";

import { day, int, pct, usd, utcTime } from "@/lib/format";
import { GapBar } from "./gap-bar";
import { useLimit, useMarket } from "./providers";
import { NetBadge } from "./ui";

/** Live mainnet preview: the real quote for one raw token against a 20% limit (or the viewer's own limit). */
export function PreviewCard() {
  const { data, error } = useMarket();
  const { limitBps } = useLimit();

  return (
    <div className="rounded-[var(--radius-card-lg)] border border-hairline bg-paper p-5 shadow-[var(--shadow-lift)] sm:p-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <NetBadge net="mainnet" />
        <span className={`text-xs ${error ? "text-deadline" : "text-slate"}`}>
          {error ? "Couldn't reach Solana. Retrying in 15 seconds." : data ? `Quote at ${utcTime(data.quote.asOf)}` : "Reading the pool..."}
        </span>
      </div>
      {data ? (
        <>
          <GapBar
            entitlement={data.quote.value.entitlementSpcxx}
            market={data.quote.value.outSpcxx}
            limitBps={limitBps}
            entitlementUsd={data.entitlementUsdPerToken.value}
            deadline={{ label: `${day(data.deadline.value.at, true)} 23:59 UTC`, daysLeft: data.deadline.value.daysLeft }}
          />
          <p className="mt-2 text-xs leading-relaxed text-slate">
            Meteora DLMM quote for 1 raw token (5 shares), pool fee and the 1% issuer transfer fee included. Entitlement in USD is 5 x the PreStocks mark.
          </p>
        </>
      ) : (
        <div className="py-10 text-center text-sm text-slate">Reading the live quote from the Meteora pool...</div>
      )}
    </div>
  );
}

export function StatsRow() {
  const { data } = useMarket();
  const stats = data
    ? [
        { value: int(data.holders.value), label: "SPACEX holders", source: `Jupiter tokens API, ${utcTime(data.holders.asOf)}` },
        { value: pct(data.quote.value.executableGapPct), label: "Gap today", source: `Meteora quote, ${utcTime(data.quote.asOf)}` },
        { value: `${data.deadline.value.daysLeft} days`, label: "To the issuer deadline", source: "prestocks.com, issuer terms" },
        { value: usd(data.entitlementUsdPerToken.value), label: "Entitlement per token", source: `PreStocks mark x 5, ${utcTime(data.prestocksMarkUsd.asOf)}` },
      ]
    : null;

  return (
    <section aria-label="Live numbers" className="mx-auto max-w-[1200px] px-4 md:px-6">
      <div className="grid grid-cols-2 border-y border-hairline md:grid-cols-4">
        {(stats ?? Array.from({ length: 4 }, () => null)).map((s, i) => (
          <div key={i} className={`px-3 py-6 sm:px-6 ${i % 2 === 1 ? "border-l border-hairline" : ""} ${i >= 2 ? "border-t border-hairline md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}>
            {s ? (
              <>
                <p className="num text-3xl tracking-[-0.02em] sm:text-4xl">{s.value}</p>
                <p className="mt-2 text-sm text-ink">{s.label}</p>
                <p className="mt-1 text-xs text-slate">{s.source}</p>
              </>
            ) : (
              <p className="py-4 text-sm text-slate">Reading mainnet...</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
