import type { Metadata } from "next";
import history from "../../../../data/haircut-history.json";
import type { HistoryDay } from "@/server/backtest";
import { OrderSection } from "@/components/order";
import { BackHome } from "@/components/chrome";
import { DemoBadge, EligibilityNotice, SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Your order" };

export default function AppPage() {
  return (
    <section id="app" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-8 pb-24 md:px-6">
      <div className="mb-10"><BackHome /></div>
      <SectionHead
        level={1}
        label="Your order"
        title="Set an order on devnet."
        muted="Watch mainnet next to it."
        intro="Orders run against replica SPACEX and SPCXx that copy the mainnet tokens' fee and decimals, on a devnet pool kept in line with the mainnet price. Mainnet balances are read only."
      />
      <div className="mb-3"><DemoBadge /></div>
      <EligibilityNotice className="mb-6 rounded-[14px] bg-cream px-4 py-3 text-ink" />
      <OrderSection history={history.days as HistoryDay[]} />
    </section>
  );
}
