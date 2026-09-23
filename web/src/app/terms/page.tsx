import type { Metadata } from "next";
import Link from "next/link";
import { DocPage, DocSection } from "@/components/doc";

export const metadata: Metadata = { title: "Terms of use", description: "The terms for using the Holdfill demo." };

export default function TermsPage() {
  return (
    <DocPage
      label="Legal"
      title="Terms of use"
      intro="These terms cover the Holdfill website, app, and API. By using them you accept these terms. If you don't accept them, don't use Holdfill."
      updated="23 September 2026"
    >
      <DocSection title="What Holdfill is">
        <p>Holdfill is a demonstration of standing conversion orders for SpaceX PreStocks. Orders run on Solana devnet with replica tokens that have no value. Market data comes from Solana mainnet and is shown for information only.</p>
        <p>Holdfill is software. It isn&apos;t a broker, exchange, custodian, investment adviser, or issuer, and it doesn&apos;t hold your tokens or keys.</p>
      </DocSection>

      <DocSection title="No advice">
        <p>Nothing on Holdfill is financial, investment, legal, or tax advice. Prices, gaps, backtests, and case studies describe past or current market data. They don&apos;t predict what any token will be worth or whether a conversion will be available.</p>
      </DocSection>

      <DocSection title="Eligibility">
        <p>PreStocks are unavailable in the U.S. and to U.S. persons. You&apos;re responsible for making sure you&apos;re allowed to hold and trade them where you live. Read the <a href="https://prestocks.com/faq?tab=legal" target="_blank" rel="noreferrer">issuer&apos;s terms</a>. Holdfill isn&apos;t affiliated with SpaceX, PreStocks, xStocks, Meteora, or Jupiter.</p>
      </DocSection>

      <DocSection title="Your wallet, your responsibility">
        <ul>
          <li>You control your wallet and keys. Holdfill asks your wallet to sign and never sees your keys.</li>
          <li>Read each transaction in your wallet before you sign. A signed order approves the order program to sell up to the amount you chose.</li>
          <li>You can revoke an order at any time. Anything already filled stays in your wallet.</li>
        </ul>
      </DocSection>

      <DocSection title="Risks">
        <ul>
          <li>The issuer controls a transfer fee, a pause switch, a freeze authority, and a permanent delegate on the SpaceX PreStocks token. The issuer can change these at any time.</li>
          <li>Pool liquidity can be thin. A fill can take a long time or never happen.</li>
          <li>The keeper, website, or API can stop or fail. Your tokens stay in your wallet when they do.</li>
          <li>The order program is new, unaudited, and upgradeable. Blockchain transactions can&apos;t be reversed once confirmed.</li>
          <li>Tokens not converted before the issuer&apos;s deadline may expire worthless under the issuer&apos;s terms.</li>
        </ul>
      </DocSection>

      <DocSection title="Acceptable use">
        <p>Don&apos;t attack, overload, or scrape the service beyond normal use, and don&apos;t abuse the devnet faucet. We can limit or block access to protect the service.</p>
      </DocSection>

      <DocSection title="No warranty">
        <p>Holdfill is provided as is, without warranties of any kind. To the fullest extent the law allows, the Holdfill team isn&apos;t liable for losses from using or being unable to use Holdfill, including missed fills, fills at your minimum, market moves, issuer actions, or third-party service failures.</p>
      </DocSection>

      <DocSection title="Code license">
        <p>The Holdfill source code is released under the MIT license. The Holdfill name and logo aren&apos;t covered by that license.</p>
      </DocSection>

      <DocSection title="Changes">
        <p>We may update these terms. The date at the top shows the latest version. See also the <Link href="/privacy">privacy notice</Link>.</p>
      </DocSection>
    </DocPage>
  );
}
