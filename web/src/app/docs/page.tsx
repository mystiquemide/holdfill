import type { Metadata } from "next";
import Link from "next/link";
import config from "../../../../config/devnet.json";
import { DocPage, DocSection, Terms } from "@/components/doc";
import { explorerAddr, shortAddr } from "@/lib/format";

export const metadata: Metadata = { title: "Docs", description: "How to set, fill, and revoke a Holdfill order, and what the program checks on every fill." };

const ADDRESSES: [string, string][] = [
  ["Order program", config.programId],
  ["Lifecycle event", config.lifecycleEvent],
  ["Replica SPACEX", config.replicaSpacex],
  ["Replica SPCXx", config.replicaSpcxx],
  ["DLMM pool", config.pool],
];

const API: [string, string][] = [
  ["GET /api/market", "Live mainnet quote, pool fee, transfer fee, and the issuer's conversion value."],
  ["GET /api/markets", "Every PreStocks market: holders, value at mark, pool price, issuer fee, Jupiter Trigger result, and lifecycle events."],
  ["GET /api/issuer", "Open Holdfill orders on devnet by market, with live approvals, coverage, and conversions."],
  ["GET /api/history", "Daily close gap since listing, with dated unlocks."],
  ["GET /api/backtest?limit=2000", "How many trading days a limit, in basis points, would have filled."],
  ["GET /api/position?owner=", "Mainnet SPACEX (read only), devnet replica balances, and the open order."],
  ["GET /api/orders?owner=", "Order history from on-chain events."],
  ["GET /api/jupiter-check", "Live test that Jupiter's trigger API refuses the PreStocks mint."],
  ["GET /api/program", "The order program's current upgrade authority."],
];

export default function DocsPage() {
  return (
    <DocPage
      label="Docs"
      title="Using Holdfill"
      intro="Holdfill lets a SpaceX PreStocks holder set one standing order to convert into SPCXx. Tokens stay in the wallet until the pool pays the holder's minimum."
    >
      <DocSection title="Before you start">
        <ul>
          <li>A Solana wallet such as Phantom, Solflare, or Backpack. The wallet only signs. Holdfill relays the transaction to devnet, so the wallet&apos;s own network setting doesn&apos;t matter.</li>
          <li>Orders use devnet replica tokens. Nothing on mainnet moves. Market prices shown in the app come from mainnet.</li>
          <li>PreStocks are unavailable in the U.S. and to U.S. persons. Read the <a href="https://prestocks.com/faq?tab=legal" target="_blank" rel="noreferrer">issuer&apos;s terms</a>.</li>
        </ul>
      </DocSection>

      <DocSection title="Set an order">
        <ul>
          <li>Connect your wallet and open the app.</li>
          <li>If you hold no replica SPACEX, use the faucet. It sends 1 replica SPACEX (5 shares) and a little devnet SOL for fees if your wallet is low.</li>
          <li>Pick the amount, the largest gap you accept, a fallback date, and a fallback floor.</li>
          <li>Sign once. That transaction creates the order and approves the order program for that amount only.</li>
        </ul>
      </DocSection>

      <DocSection title="Order terms">
        <Terms
          items={[
            ["Entitlement", "What the issuer says one raw SPACEX converts into: 5 SPCXx, one per share after the 5x split."],
            ["Gap", "How far a payout falls below entitlement, fees included. A 29% gap pays 3.55 SPCXx per raw token."],
            ["Limit", "The largest gap you accept, up to 60%. A 20% limit requires at least 4 SPCXx per raw token."],
            ["Fallback date", "From this date the fallback floor replaces your limit. It must fall before the issuer deadline."],
            ["Fallback floor", "The least you accept after the fallback date, as a share of entitlement: 40, 50, 60, or 70%."],
            ["Issuer deadline", "12 March 2027, 23:59 UTC. The program refuses every fill after it."],
          ]}
        />
      </DocSection>

      <DocSection title="How a fill works">
        <p>A keeper checks open orders every 10 seconds. When the pool quote meets your minimum, it calls the program&apos;s execute instruction. Anyone can call execute, and you can press Check now to run one pass yourself.</p>
        <p>The program swaps through the Meteora DLMM pool as your approved delegate, measures what reached your SPCXx account, and reverts the whole transaction if it&apos;s below your minimum. Orders can fill in parts. The keeper sells the largest amount that still meets your terms.</p>
        <p>Every fill also checks that the pool, mints, and token accounts match the order, the issuer hasn&apos;t paused the token or changed its transfer fee since you signed, your approval covers the amount, and the deadline hasn&apos;t passed.</p>
      </DocSection>

      <DocSection title="One order per wallet">
        <p>Each wallet has one order at a time. A token account can approve only one delegate for one amount, so a second order would silently replace the first order&apos;s approval.</p>
        <p>To change your terms, revoke the open order and set a new one. After a full fill, close the order. Closing returns the order account&apos;s SOL deposit.</p>
      </DocSection>

      <DocSection title="Revoke">
        <p>Revoke closes the order and removes the approval in one transaction. Anything already filled stays in your wallet. After that, nothing can fill, and a fill attempt fails on chain. See the <Link href="/demo">recorded example</Link>.</p>
      </DocSection>

      <DocSection title="Faucet limits">
        <ul>
          <li>The faucet only tops up wallets holding less than 0.5 raw replica SPACEX (2.5 shares).</li>
          <li>A wallet with an open order or remaining tokens can request once per hour. A wallet that sold everything and closed its order can refill right away.</li>
          <li>The faucet sends at most 20 grants per hour across all wallets.</li>
        </ul>
      </DocSection>

      <DocSection title="Devnet addresses">
        <Terms
          items={ADDRESSES.map(([name, addr]) => [
            name,
            <a key={addr} href={explorerAddr(addr, "devnet")} target="_blank" rel="noreferrer" className="mono">{shortAddr(addr)}</a>,
          ])}
        />
      </DocSection>

      <DocSection title="Public API">
        <p>Read endpoints return JSON and need no key.</p>
        <Terms items={API.map(([route, what]) => [route, what])} />
      </DocSection>

      <DocSection title="Verify it yourself">
        <p>The <Link href="/proof">proof page</Link> links every recorded devnet transaction and the local fork proof, which runs the same program against cloned mainnet mint and pool state. The <Link href="/evidence">evidence page</Link> shows the market data behind the product.</p>
      </DocSection>
    </DocPage>
  );
}
