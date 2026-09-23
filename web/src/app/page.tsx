import Image from "next/image";
import history from "../../../data/haircut-history.json";
import forkProof from "../../../data/proof-fork.json";
import devnetProof from "../../../data/proof-devnet.json";
import { backtest, type HistoryDay } from "@/server/backtest";
import { AppEntryButton } from "@/components/chrome";
import { EvidencePreview, PreviewCard } from "@/components/hero";
import { Compared, FinalCta, HowItWorks, ProofPreview } from "@/components/sections";
import { ButtonLink, DemoBadge, EligibilityNotice, SectionHead } from "@/components/ui";

// The landing page introduces Holdfill. The app, full evidence, and full proof live on
// /app, /evidence, and /proof.
const at20 = backtest(history.days as HistoryDay[], 2000);

export default function Home() {
  return (
    <>
      <section id="top" className="px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="relative mx-auto max-w-[1440px] overflow-hidden rounded-[var(--radius-card-lg)]">
          <Image
            src="/images/launch-dusk.jpg"
            alt="A rocket's launch trail arcing across a dusk sky over the coast"
            fill
            preload
            sizes="100vw"
            className="object-cover object-[70%_center]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.86)_0%,rgba(255,255,255,0.7)_42%,rgba(255,255,255,0)_78%)]" />
          <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-4 pt-16 pb-10 text-center sm:pt-24 md:px-6">
            <h1 className="animate-rise text-[40px] leading-[1.02] tracking-[-0.03em] sm:text-6xl md:text-7xl">
              Hold through the lockup.
              <span className="block text-[#4a4a4a]">Fill before the deadline.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink">
              Set your price once. Holdfill waits to convert SpaceX PreStocks into SPCXx at your terms. This demo executes with devnet replicas; the market snapshot uses live mainnet data.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <div className="flex items-center gap-2"><AppEntryButton /><DemoBadge /></div>
              <ButtonLink href="/demo" variant="secondary">Watch demo</ButtonLink>
            </div>
            <EligibilityNotice className="mt-3 max-w-md text-ink" />
            <div className="mt-14 w-full max-w-3xl text-left sm:mt-20">
              <PreviewCard />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <SectionHead label="How it works" title="One signature. Your terms. The program enforces them." />
        <HowItWorks />
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <SectionHead label="Evidence" title="The pool pays less than the entitlement." muted="By a different amount every day." />
        <EvidencePreview fillDays={at20.fillDays} tradingDays={at20.tradingDays} firstFill={at20.firstFill?.date ?? null} />
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <SectionHead label="Compared" title="What a holder can do today." />
        <Compared />
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <SectionHead label="Proof" title="Checked on chain, twice." />
        <ProofPreview fork={forkProof} devnetProof={devnetProof} />
      </section>

      <section className="mx-auto max-w-[1200px] px-3 pt-24 sm:px-4 md:px-6">
        <FinalCta />
      </section>
    </>
  );
}
