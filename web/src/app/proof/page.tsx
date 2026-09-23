import type { Metadata } from "next";
import forkProof from "../../../../data/proof-fork.json";
import devnetProof from "../../../../data/proof-devnet.json";
import { NeverDoes, Proof } from "@/components/sections";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Proof" };

export default function ProofPage() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-16 md:px-6">
      <SectionHead level={1} label="Proof" title="Checked on chain, twice." muted="Run it yourself." />
      <Proof fork={forkProof} devnetProof={devnetProof} />
      <div className="mt-16"><NeverDoes /></div>
    </section>
  );
}
