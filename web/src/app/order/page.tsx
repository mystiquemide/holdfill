import type { Metadata } from "next";
import history from "../../../../data/haircut-history.json";
import type { HistoryDay } from "@/server/backtest";
import { OrderSection } from "@/components/order";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Your order" };

export default function OrderPage() {
  return (
    <section id="order" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-16 md:px-6">
      <SectionHead
        level={1}
        label="Your order"
        title="Set an order on devnet."
        muted="Watch mainnet next to it."
        intro="Orders run against replica SPACEX and SPCXx that copy the mainnet tokens' fee and decimals, on a devnet pool kept in line with the mainnet price. Mainnet balances are read only."
      />
      <OrderSection history={history.days as HistoryDay[]} />
    </section>
  );
}
