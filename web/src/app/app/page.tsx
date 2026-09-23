import type { Metadata } from "next";
import Link from "next/link";
import history from "../../../../data/haircut-history.json";
import type { HistoryDay } from "@/server/backtest";
import { OrderSection } from "@/components/order";
import { MarketOrderSection } from "@/components/market-order";
import { BackHome } from "@/components/chrome";
import { DemoBadge, EligibilityNotice, SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Your order" };

const MARKETS = [
  { symbol: "SPACEX", label: "SpaceX", note: "Deadline open" },
  { symbol: "ANTHROPIC", label: "Anthropic", note: "No event yet" },
  { symbol: "OPENAI", label: "OpenAI", note: "No event yet" },
] as const;

const INTRO: Record<string, string> = {
  SPACEX: "Convert replica SPACEX into replica SPCXx at your terms before the issuer deadline. The devnet pool follows the mainnet price. Mainnet balances are read only.",
  ANTHROPIC: "Sell replica Anthropic into replica USDC at a price you set, or arm an order for the day the issuer names a successor. The devnet pool follows the mainnet Meteora USDC pool. Mainnet balances are read only.",
  OPENAI: "Sell replica OpenAI into replica USDC at a price you set, or arm an order for the day the issuer names a successor. The devnet pool follows the mainnet Meteora USDC pool. Mainnet balances are read only.",
};

export default async function AppPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const requested = String((await searchParams).market ?? "SPACEX").toUpperCase();
  const market = MARKETS.find((m) => m.symbol === requested) ?? MARKETS[0];

  return (
    <section id="app" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-8 pb-24 md:px-6">
      <div className="mb-10"><BackHome /></div>
      <SectionHead level={1} label="Your order" title="Set an order on devnet." muted="Watch mainnet next to it." intro={INTRO[market.symbol]} />
      <nav aria-label="Market" className="mb-6 flex flex-wrap gap-2">
        {MARKETS.map((m) => {
          const active = m.symbol === market.symbol;
          return (
            <Link
              key={m.symbol}
              href={m.symbol === "SPACEX" ? "/app" : `/app?market=${m.symbol}`}
              aria-current={active ? "page" : undefined}
              scroll={false}
              className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm transition-colors duration-150 ${active ? "bg-ink text-paper" : "bg-vellum text-ink hover:bg-hairline"}`}
            >
              <span className="font-medium">{m.label}</span>
              <span className={active ? "text-paper/70" : "text-slate"}>{m.note}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mb-3"><DemoBadge /></div>
      <EligibilityNotice className="mb-6 rounded-[14px] bg-cream px-4 py-3 text-ink" />
      {market.symbol === "SPACEX"
        ? <OrderSection history={history.days as HistoryDay[]} />
        : <MarketOrderSection key={market.symbol} symbol={market.symbol} />}
    </section>
  );
}
