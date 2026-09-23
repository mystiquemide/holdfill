import type { Metadata } from "next";
import { BackHome } from "@/components/chrome";
import { ButtonLink, NetBadge, SectionHead, Source } from "@/components/ui";
import { day, explorerAddr, int, signedPct, usdCompact, utcTime } from "@/lib/format";
import { getMarkets, type MarketRow, type Markets } from "@/server/markets";

export const metadata: Metadata = { title: "Markets", description: "Every PreStocks market live: holders, value, pool price against the PreStocks mark, issuer fee, and conversion deadlines." };

const orNa = <T,>(v: T | null, f: (v: T) => string) => (v === null ? "n/a" : f(v));

function Lifecycle({ m }: { m: MarketRow }) {
  if (m.event) {
    return (
      <span className="flex flex-col gap-1">
        <span className="inline-flex h-6 w-fit items-center rounded-full bg-cream px-2.5 text-xs font-medium uppercase tracking-[0.06em] text-hold">Deadline open</span>
        <span className="text-slate">Into {m.event.successor.replace(/.*\((.*)\)/, "$1")} by {day(m.event.deadline, true)}, {m.event.daysLeft} days</span>
      </span>
    );
  }
  return <span className="text-slate">No event announced</span>;
}

function Trigger({ m }: { m: MarketRow }) {
  if (!m.jupiterTrigger) return <span className="text-slate">Not checked</span>;
  return m.jupiterTrigger.refused
    ? <span className="text-deadline" title={m.jupiterTrigger.message}>Refused</span>
    : <span className="text-fill">Accepted</span>;
}

function Table({ data }: { data: Markets }) {
  return (
    <>
      <ul className="flex flex-col gap-3 xl:hidden">
        {data.markets.map((m) => (
          <li key={m.mint} className="rounded-[var(--radius-card)] border border-hairline p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-base">{m.name}</p>
              <a href={explorerAddr(m.mint, "mainnet")} target="_blank" rel="noreferrer" className="mono text-xs text-slate underline underline-offset-4">{m.symbol}</a>
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate">Holders</dt><dd className="num">{orNa(m.holders, int)}</dd>
              <dt className="text-slate">Value at mark</dt><dd className="num">{usdCompact(m.markValueUsd)}</dd>
              <dt className="text-slate">Jupiter price vs mark</dt><dd className="num">{orNa(m.vsMarkPct, (v) => signedPct(v))}</dd>
              <dt className="text-slate">24h volume</dt><dd className="num">{orNa(m.volume24hUsd, usdCompact)}</dd>
              <dt className="text-slate">Issuer fee</dt><dd className="num">{orNa(m.transferFeeBps, (v) => `${v / 100}%`)}</dd>
              <dt className="text-slate">Jupiter Trigger</dt><dd><Trigger m={m} /></dd>
              <dt className="text-slate">Lifecycle</dt><dd><Lifecycle m={m} /></dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-[var(--radius-card-lg)] border border-hairline xl:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-hairline text-slate">
              <th className="p-4 font-normal">Market</th>
              <th className="p-4 text-right font-normal">Holders</th>
              <th className="p-4 text-right font-normal">Value at mark</th>
              <th className="p-4 text-right font-normal">Jupiter price vs mark</th>
              <th className="p-4 text-right font-normal">24h volume</th>
              <th className="p-4 text-right font-normal">Issuer fee</th>
              <th className="p-4 font-normal">Jupiter Trigger</th>
              <th className="p-4 font-normal">Lifecycle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {data.markets.map((m) => (
              <tr key={m.mint} className={m.event ? "bg-vellum/60" : ""}>
                <th scope="row" className="p-4 font-normal">
                  <span className="block">{m.name}</span>
                  <a href={explorerAddr(m.mint, "mainnet")} target="_blank" rel="noreferrer" className="mono text-xs text-slate underline underline-offset-4">{m.symbol}</a>
                </th>
                <td className="num p-4 text-right">{orNa(m.holders, int)}</td>
                <td className="num p-4 text-right">{usdCompact(m.markValueUsd)}</td>
                <td className="num p-4 text-right">{orNa(m.vsMarkPct, (v) => signedPct(v))}</td>
                <td className="num p-4 text-right">{orNa(m.volume24hUsd, usdCompact)}</td>
                <td className="num p-4 text-right">{orNa(m.transferFeeBps, (v) => `${v / 100}%`)}</td>
                <td className="p-4"><Trigger m={m} /></td>
                <td className="p-4"><Lifecycle m={m} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function MarketsPage() {
  const data = await getMarkets().catch(() => null);
  const refused = data?.markets.filter((m) => m.jupiterTrigger?.refused).length ?? 0;
  const holders = data?.markets.reduce((s, m) => s + (m.holders ?? 0), 0) ?? 0;
  const value = data?.markets.reduce((s, m) => s + m.markValueUsd, 0) ?? 0;
  const xai = data?.expired[0];

  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-8 pb-24 md:px-6">
      <div className="mb-10"><BackHome /></div>
      <SectionHead
        level={1}
        label="Markets"
        title="Every PreStocks market, live."
        muted="One conversion deadline is open."
        intro="Each PreStocks mint carries the issuer's 1% transfer fee. Jupiter's trigger API refuses mints with a transfer fee, so none of them can hold a standing order there today."
      />
      {!data ? (
        <p className="rounded-[var(--radius-card)] border border-hairline p-6 text-sm text-slate">Couldn&apos;t reach the market data sources. Reload in a minute.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <NetBadge net="mainnet" />
            <span className="text-xs text-slate">Read at {utcTime(data.asOf)}</span>
          </div>
          <div className="mb-8 grid gap-6 border-y border-hairline py-6 sm:grid-cols-3">
            {[
              [`${refused} of ${data.markets.length}`, "refused by Jupiter Trigger right now"],
              [int(holders), "holder accounts, summed across markets"],
              [usdCompact(value), "held, at the PreStocks mark"],
            ].map(([v, label]) => (
              <div key={label}>
                <p className="num text-3xl tracking-[-0.02em]">{v}</p>
                <p className="mt-2 text-sm">{label}</p>
              </div>
            ))}
          </div>
          <Table data={data} />
          <Source>
            Holders, pool price, and volume: {data.sources.holders.replace(" holderCount", "")}. Value: {data.sources.mark}. Jupiter price vs mark compares Jupiter&apos;s blended price per share with the PreStocks mark; a sell quote on one pool can differ. Fee: {data.sources.mint}. Jupiter: {data.sources.trigger}.
          </Source>

          {xai && (
            <div className="mt-12 rounded-[var(--radius-card-lg)] border border-hairline bg-paper p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-2xl tracking-[-0.01em]">Expired: XAI</h2>
                <span className="inline-flex h-6 items-center rounded-full bg-[#f7e3dc] px-2.5 text-xs font-medium uppercase tracking-[0.06em] text-deadline">Deadline passed {day(xai.deadline)}</span>
              </div>
              <blockquote className="mt-4 max-w-2xl border-l-2 border-hairline pl-4 text-sm leading-relaxed text-slate">
                &ldquo;{xai.terms}&rdquo; <a href={xai.source} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">Issuer</a>
              </blockquote>
              <p className="mt-5 text-lg">
                <span className="num">{int(xai.walletsHolding)}</span> wallets still held <span className="num">{int(xai.tokensHeld)}</span> XAI after the deadline.
              </p>
              <Source>Token accounts for the XAI mint with a nonzero balance, counted by owner, {day(xai.checkedAt)} {utcTime(xai.checkedAt)}.</Source>
            </div>
          )}

          <div className="mt-12 flex flex-wrap items-center gap-3">
            <ButtonLink href="/app">Set a SpaceX order</ButtonLink>
            <ButtonLink href="/issuer" variant="secondary">Issuer view</ButtonLink>
            <ButtonLink href="/evidence" variant="secondary">See the SpaceX evidence</ButtonLink>
          </div>
        </>
      )}
    </section>
  );
}
