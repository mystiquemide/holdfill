import type { Metadata } from "next";
import Link from "next/link";
import { DocPage, DocSection } from "@/components/doc";

export const metadata: Metadata = { title: "Privacy", description: "What Holdfill collects, why, and who else sees it." };

export default function PrivacyPage() {
  return (
    <DocPage
      label="Legal"
      title="Privacy"
      intro="Holdfill has no accounts, no cookies, and no analytics. Here is the little it does handle."
      updated="23 September 2026"
    >
      <DocSection title="What we handle">
        <ul>
          <li><strong>Your public wallet address.</strong> The app sends it to our server to read balances, build order transactions, relay the transactions you sign, and run the faucet.</li>
          <li><strong>Transactions you sign.</strong> The server forwards them to Solana devnet. It accepts only Holdfill order and token transactions.</li>
          <li><strong>Faucet requests.</strong> The server keeps your wallet address and last request time in memory to apply the faucet limits. It isn&apos;t written to disk and clears when the server restarts.</li>
          <li><strong>Request logs.</strong> The web server that hosts Holdfill may log your IP address, browser, and the pages or endpoints you request, for security and debugging.</li>
        </ul>
        <p>Holdfill never asks for your name, email, or private keys.</p>
      </DocSection>

      <DocSection title="Public blockchain data">
        <p>Everything you do on chain, including orders, fills, and revokes, is public and permanent on Solana. Anyone can link those transactions to your wallet address. We can&apos;t delete them.</p>
      </DocSection>

      <DocSection title="Stored in your browser">
        <ul>
          <li>The last market snapshot, so prices appear instantly on your next visit.</li>
          <li>The name of the wallet you last connected, so it can reconnect automatically.</li>
        </ul>
        <p>Both stay in your browser&apos;s local storage. Clear your site data to remove them.</p>
      </DocSection>

      <DocSection title="Services that see your requests">
        <ul>
          <li><strong>Helius</strong> (Solana RPC). Our server sends your wallet address with balance and transaction queries.</li>
          <li><strong>Solana devnet.</strong> Receives the transactions you sign.</li>
          <li><strong>Jupiter and PreStocks.</strong> Our server fetches prices from them. Your address isn&apos;t sent.</li>
          <li><strong>Your wallet.</strong> Phantom, Solflare, Backpack, and others have their own privacy policies.</li>
          <li><strong>Solana Explorer.</strong> Opens only when you follow a transaction link.</li>
        </ul>
        <p>We don&apos;t sell or share data for advertising.</p>
      </DocSection>

      <DocSection title="Changes">
        <p>We may update this notice. The date at the top shows the latest version. See also the <Link href="/terms">terms of use</Link>.</p>
      </DocSection>
    </DocPage>
  );
}
