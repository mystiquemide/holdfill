import type { Metadata } from "next";
import { AppEntryButton, BackHome } from "@/components/chrome";
import { HowItWorks } from "@/components/sections";
import { DemoBadge, EligibilityNotice, SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "How it works" };

export default function HowPage() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-8 pb-24 md:px-6">
      <div className="mb-10"><BackHome /></div>
      <SectionHead
        level={1}
        label="How it works"
        title="Approve. Wait. Fill."
        intro="Set the least SPCXx you will accept. Your replica SPACEX stays in your wallet until the devnet pool can fill your order at that minimum."
      />
      <h2 className="mb-5 text-2xl tracking-[-0.01em]">Three steps</h2>
      <HowItWorks />
      <div className="mt-10 rounded-[var(--radius-card)] border border-hairline bg-paper p-6 sm:p-8">
        <h2 className="text-2xl tracking-[-0.01em]">What a 20% limit means</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate">
          The issuer&apos;s conversion amount is 5 SPCXx for one raw SPACEX token. A 20% limit requires at least 4 SPCXx per raw token before the fallback date. The displayed pool payout is a current quote for selling one raw token after fees.
        </p>
        <div className="mt-6 flex items-center gap-2"><AppEntryButton /><DemoBadge /></div>
        <EligibilityNotice className="mt-3 max-w-md text-slate" />
      </div>
    </section>
  );
}
