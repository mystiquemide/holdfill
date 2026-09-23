import Image from "next/image";
import Link from "next/link";
import { day, explorerAddr, explorerTx, int, num, pct, shortAddr } from "@/lib/format";
import { Logo } from "./logo";
import { AppEntryButton } from "./chrome";
import { ProgramAuthority, CopyCommand } from "./proof-live";
import { ButtonLink, EligibilityNotice, NetBadge, Source } from "./ui";

// ---------- How it works ----------

const STEPS = [
  { n: "1", title: "Approve", body: "Pick an amount and the largest gap you accept. One signature approves the order program for that amount only. Revoke anytime." },
  { n: "2", title: "Wait", body: "Your tokens stay in your wallet. A keeper checks the pool every 10 seconds and does nothing until the price meets your terms." },
  { n: "3", title: "Fill", body: "When the pool pays your minimum, the program swaps and checks that you received at least that much. From your fallback date, your floor applies." },
];

export function HowItWorks() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {STEPS.map((s, i) => (
        <div key={s.n} data-item style={{ "--i": i } as React.CSSProperties} className="rounded-[var(--radius-card)] border border-hairline bg-paper p-6">
          <span className="num inline-flex size-9 items-center justify-center rounded-full bg-vellum text-sm">{s.n}</span>
          <h3 className="mt-5 text-xl">{s.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-slate">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

// ---------- Evidence: one real sale, one real deadline ----------

type CaseStudy = {
  sale: {
    walletShort: string; date: string;
    throughPool: { swaps: number; shares: number; receivedSpcxx: number; gapPct: number };
    featured: { signature: string; explorer: string; shares: number; receivedSpcxx: number; gapPct: number };
    context: { firstCloseAtOrUnder20: { date: string; daysLater: number } | null };
  };
  xai: { issuerTerms: { text: string; source: string }; walletsHolding: number; xaiHeld: number; checkedAt: string };
};

export function RealSale({ data }: { data: CaseStudy }) {
  const s = data.sale;
  const later = s.context.firstCloseAtOrUnder20;
  return (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg">One real sale</h2><NetBadge net="mainnet" /></div>
      <p className="flex-1 text-lg leading-relaxed">
        On {day(s.date)}, wallet <span className="mono text-[0.9em]">{s.walletShort}</span> sold <span className="num">{int(s.throughPool.shares)}</span> shares through the pool in <span className="num">{s.throughPool.swaps}</span> swaps and received <span className="num">{int(s.throughPool.receivedSpcxx)}</span> SPCXx, <span className="num">{pct(s.throughPool.gapPct)}</span> less than those shares convert into.
        {later && <> The daily close gap first reached 20% on {day(later.date)}, <span className="num">{later.daysLater}</span> days later.</>}
      </p>
      <p className="mt-4 text-sm text-slate">
        One of those swaps: <span className="num">{int(s.featured.shares)}</span> shares for <span className="num">{num(s.featured.receivedSpcxx)}</span> SPCXx, {pct(s.featured.gapPct)} under.{" "}
        <a className="text-ink underline underline-offset-4" href={s.featured.explorer} target="_blank" rel="noreferrer">View it on Solana Explorer</a>
      </p>
      <Source>Rebuilt from chain by npm run case-study. The pool leg only: SPACEX the pool received, SPCXx it paid.</Source>
    </div>
  );
}

export function RealDeadline({ data }: { data: CaseStudy }) {
  const x = data.xai;
  return (
    <div className="grid overflow-hidden rounded-[var(--radius-card-lg)] border border-hairline bg-paper md:grid-cols-[2fr_3fr]">
      <div className="relative min-h-64 bg-paper md:min-h-full">
        <Image src="/images/hourglass.jpg" alt="An hourglass with the last dark sand running into the lower glass" fill sizes="(min-width: 768px) 480px, 100vw" className="object-cover" />
      </div>
      <div className="flex flex-col justify-center p-6 sm:p-10">
        <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-lg">One real deadline</h2><NetBadge net="mainnet" /></div>
        <blockquote className="text-2xl leading-snug tracking-[-0.01em]">&ldquo;{x.issuerTerms.text.replace("xAI was acquired by SpaceX. ", "").replace(", or it will expire worthless.", ".")}&rdquo;</blockquote>
        <p className="mt-3 text-sm text-slate">
          xAI PreStocks terms, <a className="text-ink underline underline-offset-4" href={x.issuerTerms.source} target="_blank" rel="noreferrer">prestocks.com/xai</a>
        </p>
        <p className="mt-6 text-lg">
          <span className="num">{int(x.walletsHolding)}</span> wallets still hold <span className="num">{num(x.xaiHeld, 1)}</span> XAI after that deadline.
        </p>
        <Source>Counted on chain {day(x.checkedAt)}: token accounts for the XAI mint with a balance above zero.</Source>
      </div>
    </div>
  );
}

// ---------- Compared ----------

const ROWS: [string, string, string, string, string][] = [
  ["Where tokens wait", "In your wallet until fill", "Sold immediately", "In a Privy-managed vault", "In DLMM pool bins"],
  ["Minimum output", "Fixed floor enforced by the program", "Swap quote and slippage bound", "V2 derives a floor; output can vary", "Bin price; net output for this mint unverified"],
  ["SPACEX transfer fee", "1% tested on cloned mainnet state", "Included in the live quote", "V1 checked live on Evidence; V2 untested", "Exact pool limit-order handling unverified"],
  ["Cancel or reclaim", "Revoke approval and close order", "Already sold", "Cancel, then withdraw from vault", "Cancel and withdraw remaining deposit"],
  ["Issuer deadline", "Fallback floor and hard cutoff", "Sells today", "Order expiry; no issuer-specific fallback shown", "Issuer deadline handling unverified"],
];

export function Compared() {
  return (
    <>
      <ul className="flex flex-col gap-3 xl:hidden">
        {ROWS.map(([k, a, b, c, d], i) => (
          <li key={k} data-item style={{ "--i": i } as React.CSSProperties} className="rounded-[var(--radius-card)] border border-hairline p-4">
            <p className="text-base">{k}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate">Holdfill demo</dt><dd>{a}</dd>
              <dt className="text-slate">Sell now</dt><dd className="text-slate">{b}</dd>
              <dt className="text-slate">Jupiter V2</dt><dd className="text-slate">{c}</dd>
              <dt className="text-slate">Meteora</dt><dd className="text-slate">{d}</dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-[var(--radius-card-lg)] border border-hairline xl:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-hairline">
              <th className="w-[18%] p-4 font-normal text-slate"><span className="sr-only">Feature</span></th>
              <th className="w-[20%] bg-vellum p-4 font-normal"><Logo /></th>
              <th className="w-[20%] p-4 font-normal text-slate">Sell on the pool now</th>
              <th className="w-[21%] p-4 font-normal text-slate">Jupiter Trigger V2</th>
              <th className="w-[21%] p-4 font-normal text-slate">Meteora DLMM limit order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ROWS.map(([k, a, b, c, d], i) => (
              <tr key={k} data-item style={{ "--i": i } as React.CSSProperties}>
                <th scope="row" className="p-4 font-normal">{k}</th>
                <td className="bg-vellum p-4">{a}</td>
                <td className="p-4 text-slate">{b}</td>
                <td className="p-4 text-slate">{c}</td>
                <td className="p-4 text-slate">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-slate">
        Holdfill executes on devnet replicas; its real-mint fee and minimum tests run on cloned mainnet state. The <Link href="/evidence" className="text-ink underline underline-offset-4">live Jupiter check</Link> covers Trigger V1 only. Jupiter V2 custody, output, and expiry come from its <a href="https://developers.jup.ag/docs/trigger" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">current docs</a>. Meteora bin deposits and cancellation come from its <a href="https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/examples.mdx" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">SDK examples</a>. An SPACEX limit order on the <a href="https://www.meteora.ag/dlmm/F9oJK3UC6bLVcAoYEZPHNteZACb7YzdZw7FHad4KFC6B" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">exact Meteora pool</a> has not been executed here.
      </p>
    </>
  );
}

// ---------- Proof ----------

type ForkProof = {
  ranAt: string; mainnet: { slot: number }; program: { id: string; sameBinaryAsDevnetDeployment: boolean };
  mints: { spacex: string; spcxx: string }; pool: string;
  checks: { name: string; pass: boolean; result: string }[]; passed: number; total: number;
};
type DevnetProof = { programId: string; transactions: Record<string, { signature: string; result: string }> };

const DEVNET_ROWS: [string, string][] = [
  ["orderCreated", "Order created"],
  ["filled", "Filled at the holder's price"],
  ["rejectedBelowMinimum", "Fill below the minimum, rejected"],
  ["revoked", "Revoked"],
  ["refusedAfterRevoke", "Fill after revoke, refused"],
];

export function Proof({ fork, devnetProof }: { fork: ForkProof; devnetProof: DevnetProof }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
        <h2 className="text-lg">On cloned mainnet state</h2>
        <p className="mt-1 text-sm text-slate">Real SPACEX mint, real Meteora pool, real 1% transfer fee. Mainnet slot <span className="num">{int(fork.mainnet.slot)}</span>, run {day(fork.ranAt)}.</p>
        <dl className="mt-3 flex flex-col gap-3 text-xs text-slate sm:gap-1">
          {([["SPACEX mint", fork.mints.spacex], ["SPCXx mint", fork.mints.spcxx], ["Meteora pool", fork.pool]] as const).map(([k, a]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt>{k}</dt>
              <dd><a className="tap mono text-ink underline underline-offset-4" href={explorerAddr(a, "mainnet")} target="_blank" rel="noreferrer">{shortAddr(a)}</a></dd>
            </div>
          ))}
        </dl>
        <ul className="mt-5 divide-y divide-hairline">
          {fork.checks.map((c) => (
            <li key={c.name} className="flex items-baseline gap-3 py-3">
              <span className={`num w-12 shrink-0 text-sm ${c.pass ? "text-fill" : "text-deadline"}`}>{c.pass ? "PASS" : "FAIL"}</span>
              <span className="flex-1">{c.name}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm">
          <span className="num">{fork.passed} of {fork.total}</span> passed.{" "}
          {fork.program.sameBinaryAsDevnetDeployment && "Same program binary as the devnet deployment."}
        </p>
        <CopyCommand command="npm run proof:fork" />
      </div>

      <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2"><h2 className="text-lg">On devnet</h2><NetBadge net="devnet" /></div>
        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-slate">Program</dt>
            <dd><a className="tap mono underline underline-offset-4" href={explorerAddr(devnetProof.programId, "devnet")} target="_blank" rel="noreferrer">{shortAddr(devnetProof.programId)}</a></dd>
          </div>
          <ProgramAuthority />
        </dl>
        <ul className="mt-4 divide-y divide-hairline border-t border-hairline text-sm">
          {DEVNET_ROWS.map(([key, label]) => {
            const t = devnetProof.transactions[key];
            if (!t) return null;
            const failed = t.result.startsWith("failed");
            return (
              <li key={key} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <span className={failed ? "text-deadline" : "text-ink"}>{label}</span>
                <a className="tap mono underline underline-offset-4" href={explorerTx(t.signature, "devnet")} target="_blank" rel="noreferrer">{shortAddr(t.signature)}</a>
              </li>
            );
          })}
        </ul>
        <Source>The two red rows failed on purpose: they prove the program refuses a fill below the holder&apos;s minimum and any fill after a revoke. They are real transactions on chain, sent without a simulation shortcut. Every signature opens on Solana Explorer.</Source>
      </div>
    </div>
  );
}

export function ProofPreview({ fork, devnetProof }: { fork: ForkProof; devnetProof: DevnetProof }) {
  // Count the same rows the proof page lists, so both pages agree.
  const shown = DEVNET_ROWS.map(([key]) => devnetProof.transactions[key]).filter(Boolean);
  const rejected = shown.filter((t) => t.result.startsWith("failed")).length;
  const signed = shown.length;
  const facts = [
    { value: `${fork.passed} of ${fork.total}`, label: "checks passed on cloned mainnet state", source: "real SPACEX mint, real Meteora pool, real 1% fee" },
    { value: shortAddr(devnetProof.programId), label: "order program deployed on devnet", source: fork.program.sameBinaryAsDevnetDeployment ? "same binary as the fork run" : "devnet deployment", mono: true },
    { value: String(signed), label: "devnet transactions on Explorer", source: `${rejected} of them rejected on purpose, to prove the limits hold` },
  ];
  return (
    <div className="rounded-[var(--radius-card-lg)] border border-hairline bg-paper p-6 sm:p-8">
      <p className="max-w-2xl text-2xl leading-snug tracking-[-0.01em]">
        Tested against cloned mainnet state.
        <span className="block text-slate">Proven again on devnet.</span>
      </p>
      <dl className="mt-8 grid gap-6 sm:grid-cols-3">
        {facts.map((f, i) => (
          <div key={f.label} data-item style={{ "--i": i } as React.CSSProperties} className="border-t border-hairline pt-4">
            <dt className="sr-only">{f.label}</dt>
            <dd className={`${f.mono ? "mono text-2xl" : "num text-3xl"} tracking-[-0.02em]`}>{f.value}</dd>
            <dd className="mt-2 text-sm text-ink">{f.label}</dd>
            <dd className="mt-1 text-xs text-slate">{f.source}</dd>
          </div>
        ))}
      </dl>
      <ButtonLink href="/proof" variant="secondary" className="mt-8">Verify the proof →</ButtonLink>
    </div>
  );
}

// ---------- Never, final CTA, footer ----------

export function NeverDoes() {
  const items = [
    "Holdfill never holds your tokens.",
    "Holdfill never sets a price.",
    "Holdfill never fills below your minimum or after the issuer deadline.",
    "PreStocks tokens are not available to US persons.",
  ];
  return (
    <ul className="grid gap-x-10 gap-y-4 border-y border-hairline py-8 text-lg md:grid-cols-2">
      {items.map((i) => <li key={i} className="flex gap-3"><span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink" />{i}</li>)}
    </ul>
  );
}

export function FinalCta() {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-card-lg)] bg-ink">
      <Image src="/images/launch-stars.jpg" alt="" fill sizes="(min-width: 1200px) 1200px, 100vw" className="zoom-in-view object-cover" />
      <div className="absolute inset-0 bg-ink/35" />
      <div className="relative flex min-h-[420px] flex-col items-center justify-center px-6 py-16 text-center">
        <h2 className="text-4xl leading-[1.05] tracking-[-0.02em] text-paper md:text-6xl">
          Set your price once.
          <span className="block text-paper/75">Holdfill fills it or waits.</span>
        </h2>
        <AppEntryButton variant="light" className="mt-10" />
        <EligibilityNotice className="mt-3 max-w-md text-paper/80" />
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-hairline">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-10 px-4 py-12 md:grid-cols-[2fr_1fr_1fr_1fr] md:px-6">
        <div className="col-span-2 md:col-span-1">
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-slate">Hold through the lockup. Fill before the deadline.</p>
        </div>
        <nav aria-label="Product" className="text-sm">
          <p className="text-slate">Product</p>
          <ul className="mt-1 flex flex-col">
            <li><Link className="inline-block py-2.5 underline-offset-4 hover:underline" href="/how">How it works</Link></li>
            <li><Link className="inline-block py-2.5 underline-offset-4 hover:underline" href="/evidence">Evidence</Link></li>
            <li><Link className="inline-block py-2.5 underline-offset-4 hover:underline" href="/proof">Proof</Link></li>
            <li><Link className="inline-block py-2.5 underline-offset-4 hover:underline" href="/docs">Docs</Link></li>
          </ul>
        </nav>
        <nav aria-label="Build" className="text-sm">
          <p className="text-slate">Build</p>
          <ul className="mt-1 flex flex-col">
            <li><a className="inline-block py-2.5 underline-offset-4 hover:underline" href="https://github.com/mystiquemide/holdfill" target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a className="inline-block py-2.5 underline-offset-4 hover:underline" href="https://github.com/mystiquemide/holdfill/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">Architecture</a></li>
            <li><Link className="inline-block py-2.5 underline-offset-4 hover:underline" href="/proof">Run the proof</Link></li>
          </ul>
        </nav>
        <nav aria-label="Legal" className="text-sm">
          <p className="text-slate">Legal</p>
          <ul className="mt-1 flex flex-col">
            <li><Link className="inline-block py-2.5 underline-offset-4 hover:underline" href="/terms">Terms</Link></li>
            <li><Link className="inline-block py-2.5 underline-offset-4 hover:underline" href="/privacy">Privacy</Link></li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 border-t border-hairline px-4 py-6 text-xs leading-relaxed text-slate md:flex-row md:items-end md:justify-between md:gap-10 md:px-6">
        <div className="max-w-2xl">
          <p>Holdfill does not set prices or guarantee conversion value. Orders run on devnet replica tokens; market data is live mainnet.</p>
          <p className="mt-1">Holdfill is not affiliated with SpaceX or PreStocks.</p>
        </div>
        <p className="shrink-0 text-ink">© 2026 Holdfill.</p>
      </div>
    </footer>
  );
}
