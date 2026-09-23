import Image from "next/image";
import history from "../../../data/haircut-history.json";
import forkProof from "../../../data/proof-fork.json";
import devnetProof from "../../../data/proof-devnet.json";
import { backtest, type HistoryDay } from "@/server/backtest";
import { AppEntryButton } from "@/components/chrome";
import { EvidencePreview, PreviewCard } from "@/components/hero";
import { BuiltOn, Compared, FinalCta, HowItWorks, OrderTypes, ProofPreview } from "@/components/sections";
import { Reveal } from "@/components/reveal";
import { ButtonLink, EligibilityNotice, SectionHead } from "@/components/ui";

// The landing page introduces Holdfill. The app, full evidence, and full proof live on
// /app, /evidence, and /proof.
const at20 = backtest(history.days as HistoryDay[], 2000);

export default function Home() {
  return (
    <>
      <section id="top" className="px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="relative mx-auto max-w-[1440px] overflow-hidden rounded-[var(--radius-card-lg)]">
          <div className="drift absolute inset-0">
            <Image
              src="/images/launch-dusk.jpg"
              alt="A rocket's launch trail arcing across a dusk sky over the coast"
              fill
              preload
              sizes="100vw"
              className="settle object-cover object-[70%_center]"
            />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.86)_0%,rgba(255,255,255,0.7)_42%,rgba(255,255,255,0)_78%)]" />
          <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-4 pt-16 pb-10 text-center sm:pt-24 md:px-6">
            <h1 className="rise-1 text-[40px] leading-[1.02] tracking-[-0.03em] sm:text-6xl md:text-7xl">
              Limit orders for pre-IPO tokens.
              <span className="block text-[#4a4a4a]">At your price, before the deadline.</span>
            </h1>
            <p className="rise-2 mt-6 max-w-xl text-lg leading-relaxed text-ink">
              PreStocks can sell far below what they convert into, and they expire if not swapped before the issuer&apos;s deadline. Set the least you&apos;ll accept and sign once. Your tokens stay in your wallet until the market pays your price.
            </p>
            <div className="rise-3 mt-8 flex flex-wrap items-center justify-center gap-4">
              <AppEntryButton />
              <ButtonLink href="/demo" variant="secondary">Watch demo</ButtonLink>
              <ButtonLink href="/markets" variant="secondary">See all markets</ButtonLink>
            </div>
            <EligibilityNotice className="rise-3 mt-3 max-w-md text-ink" />
            <div className="rise-4 mt-14 w-full max-w-3xl text-left sm:mt-20">
              <PreviewCard />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <Reveal><SectionHead label="Orders" title="Three orders, one program." muted="Pick the one that fits your token." /></Reveal>
        <Reveal><OrderTypes /></Reveal>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <Reveal><SectionHead label="How it works" title="One signature. Your terms. The program enforces them." /></Reveal>
        <Reveal><HowItWorks /></Reveal>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <Reveal><SectionHead label="Evidence" title="SpaceX holders get less than their tokens convert into." muted="By a different amount every day." /></Reveal>
        <Reveal><EvidencePreview fillDays={at20.fillDays} tradingDays={at20.tradingDays} firstFill={at20.firstFill?.date ?? null} /></Reveal>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <Reveal><SectionHead label="Compared" title="What a holder can do today." /></Reveal>
        <Reveal><Compared /></Reveal>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <Reveal><SectionHead label="Proof" title="Checked on chain, twice." /></Reveal>
        <Reveal><ProofPreview fork={forkProof} devnetProof={devnetProof} /></Reveal>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
        <Reveal><SectionHead label="Built on" title="Built on Solana, with the tools PreStocks holders already use." /></Reveal>
        <Reveal><BuiltOn /></Reveal>
      </section>

      <section className="mx-auto max-w-[1200px] px-3 pt-24 sm:px-4 md:px-6">
        <Reveal><FinalCta /></Reveal>
      </section>
    </>
  );
}
