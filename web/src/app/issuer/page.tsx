import type { Metadata } from "next";
import { BackHome } from "@/components/chrome";
import { Chip, NetBadge, SectionHead, Source } from "@/components/ui";
import { day, explorerAddr, int, num, pct, shortAddr, usdCompact, utcTime } from "@/lib/format";
import { getIssuerView, type IssuerMarket, type IssuerView } from "@/server/issuer";

export const metadata: Metadata = { title: "Issuer view", description: "How many PreStocks holders have a standing order, how much it covers, and what already converted." };

function Coverage({ m }: { m: IssuerMarket }) {
  if (!m.ordersOpen) return <span className="text-slate">Not open yet</span>;
  return <span className="num">{num(m.coveredShares, 2)} shares <span className="text-slate">({usdCompact(m.coveredUsd)})</span></span>;
}

const counts = (m: IssuerMarket) => (m.ordersOpen ? `${m.live} live, ${m.filled} filled${m.blocked ? `, ${m.blocked} blocked` : ""}` : "none");

function MarketTable({ data }: { data: IssuerView }) {
  return (
    <>
      <ul className="flex flex-col gap-3 xl:hidden">
        {data.markets.map((m) => (
          <li key={m.symbol} className="rounded-[var(--radius-card)] border border-hairline p-4">
            <p className="text-base">{m.name}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate">Mainnet holders</dt><dd className="num">{m.holders === null ? "n/a" : int(m.holders)}</dd>
              <dt className="text-slate">Deadline</dt><dd>{m.deadline ? `${day(m.deadline, true)}, ${m.daysLeft} days` : <span className="text-slate">None announced</span>}</dd>
              <dt className="text-slate">Devnet orders</dt><dd>{counts(m)}</dd>
              <dt className="text-slate">Covered</dt><dd><Coverage m={m} /></dd>
              <dt className="text-slate">Converted</dt><dd className="num">{m.ordersOpen ? `${num(m.filledShares, 2)} shares` : "none"}</dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-[var(--radius-card-lg)] border border-hairline xl:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-hairline text-slate">
              <th className="p-4 font-normal">Market</th>
              <th className="p-4 text-right font-normal">Mainnet holders</th>
              <th className="p-4 font-normal">Deadline</th>
              <th className="p-4 font-normal">Devnet orders</th>
              <th className="p-4 font-normal">Covered by a live approval</th>
              <th className="p-4 text-right font-normal">Converted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {data.markets.map((m) => (
              <tr key={m.symbol} className={m.ordersOpen ? "bg-vellum/60" : ""}>
                <th scope="row" className="p-4 font-normal">{m.name}</th>
                <td className="num p-4 text-right">{m.holders === null ? "n/a" : int(m.holders)}</td>
                <td className="p-4">{m.deadline ? `${day(m.deadline, true)}, ${m.daysLeft} days` : <span className="text-slate">None announced</span>}</td>
                <td className={`p-4 ${m.ordersOpen ? "" : "text-slate"}`}>{counts(m)}</td>
                <td className="p-4"><Coverage m={m} /></td>
                <td className="num p-4 text-right">{m.ordersOpen ? `${num(m.filledShares, 2)} shares` : <span className="text-slate">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OrderList({ data }: { data: IssuerView }) {
  if (data.orders.length === 0) return <p className="text-sm text-slate">No open orders on devnet right now.</p>;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card-lg)] border border-hairline">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-hairline text-slate">
            <th className="p-4 font-normal">Order</th>
            <th className="p-4 font-normal">Market</th>
            <th className="p-4 text-right font-normal">Limit</th>
            <th className="p-4 text-right font-normal">Filled</th>
            <th className="p-4 font-normal">Status</th>
            <th className="p-4 font-normal">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {data.orders.map((o) => (
            <tr key={o.address}>
              <td className="p-4"><a href={explorerAddr(o.address, "devnet")} target="_blank" rel="noreferrer" className="mono underline underline-offset-4">{shortAddr(o.address)}</a></td>
              <td className="p-4">{o.symbol}</td>
              <td className="num p-4 text-right">{pct(o.limitBps / 100, 0)}</td>
              <td className="num p-4 text-right">{num(o.filledShares, 2)} / {num(o.sizeShares, 2)}</td>
              <td className="p-4"><Chip tone={o.status}>{o.status}</Chip></td>
              <td className="p-4 text-slate">{day(o.createdAt)} {utcTime(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function IssuerPage() {
  const data = await getIssuerView().catch(() => null);
  const totals = data?.markets.reduce(
    (t, m) => ({ live: t.live + m.live, shares: t.shares + m.coveredShares, usd: t.usd + m.coveredUsd, filled: t.filled + m.filledShares, received: t.received + m.received }),
    { live: 0, shares: 0, usd: 0, filled: 0, received: 0 },
  );

  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-8 pb-24 md:px-6">
      <div className="mb-10"><BackHome /></div>
      <SectionHead
        level={1}
        label="Issuer view"
        title="Who is covered before the deadline."
        muted="Orders on devnet, holders on mainnet."
        intro="An issuer can see how many holders have a standing order, how much those orders cover, and what already converted. Orders on this page are devnet demo orders. Holder counts are live mainnet."
      />
      {!data || !totals ? (
        <p className="rounded-[var(--radius-card)] border border-hairline p-6 text-sm text-slate">Couldn&apos;t read orders or market data. Reload in a minute.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2"><NetBadge net="devnet" /><NetBadge net="mainnet" /></div>
            <span className="text-xs text-slate">Read at {utcTime(data.asOf)}</span>
          </div>
          <div className="mb-8 grid gap-6 border-y border-hairline py-6 sm:grid-cols-3">
            {[
              [String(totals.live), "live orders with the approval in place"],
              [`${num(totals.shares, 2)} shares`, `covered, ${usdCompact(totals.usd)} at the PreStocks mark`],
              [`${num(totals.filled, 2)} shares`, `converted into ${num(totals.received, 4)} SPCXx`],
            ].map(([v, label]) => (
              <div key={label}>
                <p className="num text-3xl tracking-[-0.02em]">{v}</p>
                <p className="mt-2 text-sm">{label}</p>
              </div>
            ))}
          </div>
          <h2 className="mb-4 text-2xl tracking-[-0.01em]">By market</h2>
          <MarketTable data={data} />
          <Source>Orders: Holdfill order accounts on devnet, with each owner&apos;s token approval read on chain. Holders: Jupiter tokens API. Value: remaining shares x PreStocks mark.</Source>

          <h2 className="mt-12 mb-4 text-2xl tracking-[-0.01em]">Open orders</h2>
          <OrderList data={data} />
          <Source>Closing or revoking an order deletes its account, so it leaves this list. Its history stays on chain. Blocked means the holder removed the approval without closing the order.</Source>
        </>
      )}
    </section>
  );
}
