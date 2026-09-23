import type { Metadata } from "next";
import proof from "../../../../data/proof-devnet.json";
import { BackHome } from "@/components/chrome";
import { ButtonLink, DemoBadge, SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Wallet-free demo" };

const STEPS = [
  { key: "orderCreated", title: "Set the order", explanation: "The holder approved a capped amount and set the largest gap they would accept." },
  { key: "filled", title: "Fill above the minimum", explanation: "The keeper swapped a portion only when the pool paid more than the order's minimum." },
  { key: "rejectedBelowMinimum", title: "Reject a lower payout", explanation: "A tighter order failed on chain when the pool would have paid less than its minimum. No fill occurred." },
  { key: "revoked", title: "Revoke the approval", explanation: "The holder closed the order and removed the token approval in one transaction." },
] as const;

export default function DemoPage() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-8 pb-24 md:px-6">
      <div className="mb-10"><BackHome /></div>
      <SectionHead
        level={1}
        label="Wallet-free demo"
        title="Four recorded outcomes, one clear rule."
        intro="Follow recorded devnet transactions without connecting a wallet. Each link opens the transaction on Solana Explorer so you can check the result."
      />
      <div className="mb-6"><DemoBadge /></div>
      <ol className="grid gap-4 md:grid-cols-2">
        {STEPS.map((step, index) => {
          const tx = proof.transactions[step.key];
          return (
            <li key={step.key} className="rounded-[var(--radius-card)] border border-hairline bg-paper p-6">
              <span className="num inline-flex size-9 items-center justify-center rounded-full bg-vellum text-sm">{index + 1}</span>
              <h2 className="mt-5 text-xl">{step.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate">{step.explanation}</p>
              <p className="mt-4 rounded-[14px] bg-vellum p-4 text-sm leading-relaxed">{tx.detail}</p>
              <p className={`mt-3 text-sm ${tx.result.startsWith("failed") ? "text-deadline" : "text-fill"}`}>{tx.result.startsWith("failed") ? "Rejected on chain" : "Confirmed on devnet"}</p>
              <a href={tx.explorer} target="_blank" rel="noreferrer" className="mt-2 inline-block py-2 text-sm text-ink underline underline-offset-4">Inspect transaction</a>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 text-sm text-slate">
        A later fill attempt after revocation was also <a href={proof.transactions.refusedAfterRevoke.explorer} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">refused on chain</a>. These are historical proof transactions; the live app uses devnet replicas, while market prices shown elsewhere come from mainnet.
      </p>
      <div className="mt-8"><ButtonLink href="/proof" variant="secondary">See all proof →</ButtonLink></div>
    </section>
  );
}
