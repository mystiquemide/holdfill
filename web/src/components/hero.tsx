"use client";

import { day, int, pct, usd, utcTime } from "@/lib/format";
import { GapBar, GapExplanation } from "./gap-bar";
import { useLimit, useMarket } from "./providers";
import { ButtonLink, NetBadge } from "./ui";

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
          <GapExplanation entitlement={data.quote.value.entitlementSpcxx} limitBps={limitBps} />
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

/** Landing-page summary of the evidence: live gap, historical fill rate, and the Jupiter refusal. */
export function EvidencePreview({ fillDays, tradingDays, firstFill }: { fillDays: number; tradingDays: number; firstFill: string | null }) {
  const { data } = useMarket();
  const facts = [
    {
      value: data ? pct(data.quote.value.executableGapPct) : "...",
      label: "under the SPCXx entitlement, pool quote right now",
      source: data ? `Meteora quote for 1 raw token, ${utcTime(data.quote.asOf)}` : "Reading the live pool...",
    },
    {
      value: `${fillDays} of ${tradingDays}`,
      label: "trading days a 20% limit would have filled",
      source: firstFill ? `Daily closes since listing, first on ${day(firstFill)}` : "Daily closes since listing",
    },
    {
      value: "Refused",
      label: "Jupiter limit orders for PreStocks",
      source: "The API rejects the token's transfer fee. Checked live on the evidence page.",
    },
  ];
  return (
    <div className="rounded-[var(--radius-card-lg)] border border-hairline bg-paper p-6 sm:p-8">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate">From the live SPACEX market</p>
        <NetBadge net="mainnet" />
      </div>
      <dl className="mt-6 grid gap-6 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="border-t border-hairline pt-4">
            <dt className="sr-only">{f.label}</dt>
            <dd className="num text-3xl tracking-[-0.02em]">{f.value}</dd>
            <dd className="mt-2 text-sm text-ink">{f.label}</dd>
            <dd className="mt-1 text-xs text-slate">{f.source}</dd>
          </div>
        ))}
      </dl>
      <ButtonLink href="/evidence" variant="secondary" className="mt-8">Explore the evidence →</ButtonLink>
    </div>
  );
}
