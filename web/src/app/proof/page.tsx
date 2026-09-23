import type { Metadata } from "next";
import forkProof from "../../../../data/proof-fork.json";
import devnetProof from "../../../../data/proof-devnet.json";
import v2Proof from "../../../../data/proof-devnet-v2.json";
import { NeverDoes, Proof, V2ProofList } from "@/components/sections";
import { BackHome } from "@/components/chrome";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Proof" };

export default function ProofPage() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-8 pb-24 md:px-6">
      <div className="mb-10"><BackHome /></div>
      <SectionHead level={1} label="Proof" title="Checked on chain, twice." muted="Run it yourself." />
      <Proof fork={forkProof} devnetProof={devnetProof} />
      <h2 className="mt-16 mb-5 text-2xl tracking-[-0.01em]">Price orders and arming, on devnet</h2>
      <V2ProofList data={v2Proof} />
      <div className="mt-16"><NeverDoes /></div>
    </section>
  );
}
