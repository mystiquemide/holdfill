import type { Metadata } from "next";
import history from "../../../../data/haircut-history.json";
import caseStudy from "../../../../data/case-study.json";
import type { HistoryDay } from "@/server/backtest";
import { GapHistory, JupiterCheck } from "@/components/evidence";
import { StatsRow } from "@/components/hero";
import { RealDeadline, RealSale } from "@/components/sections";
import { BackHome } from "@/components/chrome";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Evidence" };

export default function EvidencePage() {
  return (
    <>
      <section className="mx-auto max-w-[1200px] px-4 pt-8 md:px-6">
        <div className="mb-10"><BackHome /></div>
        <SectionHead level={1} label="Evidence" title="The gap closes, unevenly." muted="A standing order catches it." />
      </section>
      <StatsRow />
      <section className="mx-auto max-w-[1200px] px-4 pt-16 pb-24 md:px-6">
        <GapHistory days={history.days as HistoryDay[]} unlocks={history.unlocks.dates} />
        <div className="mt-10 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div id="jupiter" className="scroll-mt-20"><JupiterCheck /></div>
          <RealSale data={caseStudy} />
        </div>
        <div className="mt-6"><RealDeadline data={caseStudy} /></div>
      </section>
    </>
  );
}
