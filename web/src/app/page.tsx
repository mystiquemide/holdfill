import Image from "next/image";
import history from "../../../data/haircut-history.json";
import forkProof from "../../../data/proof-fork.json";
import devnetProof from "../../../data/proof-devnet.json";
import caseStudy from "../../../data/case-study.json";
import type { HistoryDay } from "@/server/backtest";
import { Header } from "@/components/chrome";
import { GapHistory, JupiterCheck } from "@/components/evidence";
import { PreviewCard, StatsRow } from "@/components/hero";
import { OrderSection } from "@/components/order";
import { Compared, FinalCta, Footer, HowItWorks, NeverDoes, Proof, RealDeadline, RealSale } from "@/components/sections";
import { ButtonLink, Keycap, SectionHead } from "@/components/ui";

const days = history.days as HistoryDay[];

export default function Home() {
  return (
    <>
      <Header />
      <main id="main">
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
                Set your price once. Holdfill converts your SpaceX PreStocks into SPCXx when the pool pays it, never below your terms and never after 12 Mar 2027.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <ButtonLink href="#order">Set an order</ButtonLink>
                <span className="hidden items-center gap-2 text-sm text-ink sm:inline-flex">Press <Keycap>O</Keycap> anytime</span>
              </div>
              <div className="mt-14 w-full max-w-3xl text-left sm:mt-20">
                <PreviewCard />
              </div>
            </div>
            <p className="absolute bottom-3 right-4 text-xs text-paper/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">Photo: SpaceX on Unsplash</p>
          </div>
        </section>

        <div className="mt-12"><StatsRow /></div>

        <section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-24 md:px-6">
          <SectionHead label="How it works" title="One signature. Your terms. The program enforces them." />
          <HowItWorks />
        </section>

        <section id="order" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-24 md:px-6">
          <SectionHead
            label="Your order"
            title="Set an order on devnet."
            muted="Watch mainnet next to it."
            intro="Orders run against replica SPACEX and SPCXx that copy the mainnet tokens' fee and decimals, on a devnet pool kept in line with the mainnet price. Mainnet balances are read only."
          />
          <OrderSection history={days} />
        </section>

        <section id="evidence" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-24 md:px-6">
          <SectionHead label="Evidence" title="The gap closes, unevenly." muted="A standing order catches it." />
          <GapHistory days={days} unlocks={history.unlocks.dates} />
          <div className="mt-10 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <div id="jupiter" className="scroll-mt-20"><JupiterCheck /></div>
            <RealSale data={caseStudy} />
          </div>
          <div className="mt-6"><RealDeadline data={caseStudy} /></div>
        </section>

        <section id="compared" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-24 md:px-6">
          <SectionHead label="Compared" title="What a holder can do today." />
          <Compared />
        </section>

        <section id="proof" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pt-24 md:px-6">
          <SectionHead label="Proof" title="Checked on chain, twice." muted="Run it yourself." />
          <Proof fork={forkProof} devnetProof={devnetProof} />
        </section>

        <section className="mx-auto max-w-[1200px] px-4 pt-24 md:px-6">
          <NeverDoes />
        </section>

        <section className="mx-auto max-w-[1200px] px-3 pt-16 sm:px-4 md:px-6">
          <FinalCta />
        </section>
      </main>
      <Footer />
    </>
  );
}
