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
  ["SPACEX / SPCXx pool", config.pool],
  ["Replica USDC", config.replicaUsdc],
  ["Replica ANTHROPIC", config.markets.ANTHROPIC.mint],
  ["ANTHROPIC / USDC pool", config.markets.ANTHROPIC.pool],
  ["Replica OPENAI", config.markets.OPENAI.mint],
  ["OPENAI / USDC pool", config.markets.OPENAI.pool],
];

const API: [string, string][] = [
  ["GET /api/market", "Live mainnet quote, pool fee, transfer fee, and the issuer's conversion value."],
  ["GET /api/markets", "Every PreStocks market: holders, value at mark, pool price, issuer fee, Jupiter Trigger result, and lifecycle events."],
  ["GET /api/issuer", "Open Holdfill orders on devnet by market, with live approvals, coverage, and conversions."],
  ["GET /api/history", "Daily close gap since listing, with dated unlocks."],
  ["GET /api/backtest?limit=2000", "How many trading days a limit, in basis points, would have filled."],
  ["GET /api/position?owner=&market=", "Mainnet balance (read only), devnet replica balances, the devnet quote, and the open order. market is SPACEX (default), ANTHROPIC, or OPENAI."],
  ["GET /api/orders?owner=&market=", "Order history from on-chain events."],
  ["GET /api/jupiter-check", "Live test that Jupiter's trigger API refuses the PreStocks mint."],
  ["GET /api/program", "The order program's current upgrade authority."],
];

export default function DocsPage() {
  return (
    <DocPage
      label="Docs"
      title="Using Holdfill"
      intro="Holdfill lets a PreStocks holder set a standing order: convert SpaceX into SPCXx before the issuer deadline, sell other PreStocks into USDC at a set price, or arm an order for the day an issuer names a successor. Tokens stay in the wallet until the order fills."
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
          <li>Connect your wallet, open the app, and pick a market: SpaceX, Anthropic, or OpenAI.</li>
          <li>If you hold none of that token, use the faucet. It sends 1 replica token (for SpaceX, 5 shares) and a little devnet SOL for fees if your wallet is low.</li>
          <li>Set your terms. For SpaceX: the largest gap you accept, a fallback date, and a fallback floor. For Anthropic and OpenAI: either the least USDC per token and an expiry, or terms armed for a future IPO.</li>
          <li>Sign once. That transaction creates the order and approves the order program for that amount only.</li>
        </ul>
      </DocSection>

      <DocSection title="SpaceX: convert before the deadline">
        <p>SpaceX is the only PreStocks market with an issuer conversion event today, so its orders convert into SPCXx, the listed SpaceX token.</p>
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

      <DocSection title="Anthropic and OpenAI: sell at a price, or arm for the IPO">
        <p>These tokens have no issuer event yet, so the app offers two order types on devnet replicas, against replica USDC.</p>
        <Terms
          items={[
            ["Sell at your price", "Set the least USDC per token and an expiry of 30 to 365 days. The program checks that the pool trades exactly this token against USDC, and never lets the order outlive an issuer deadline."],
            ["Arm for the IPO", "Set the largest gap from the future entitlement, a fallback of 7 to 90 days before the future deadline, and a floor. Nothing sells until the issuer names a successor. The keeper then copies the issuer's terms into the order and fills at your limit. If no event comes, the order never fills."],
          ]}
        />
        <p>Jupiter&apos;s trigger API refuses every PreStocks mint because of the transfer fee; the <Link href="/markets">markets page</Link> checks this live. The <Link href="/demo">demo</Link> shows a recorded arm, a simulated issuer event on a separate demo token, activation, and fill.</p>
      </DocSection>

      <DocSection title="How a fill works">
        <p>A keeper checks open orders every 10 seconds. When the pool quote meets your minimum, it calls the program&apos;s execute instruction. Anyone can call execute, and you can press Check now to run one pass yourself.</p>
        <p>The program swaps through the Meteora DLMM pool as your approved delegate, measures what reached your SPCXx or USDC account, and reverts the whole transaction if it&apos;s below your minimum. Orders can fill in parts. The keeper sells the largest amount that still meets your terms.</p>
        <p>Every fill also checks that the pool, mints, and token accounts match the order, the issuer hasn&apos;t paused the token or changed its transfer fee since you signed, your approval covers the amount, and the deadline hasn&apos;t passed.</p>
      </DocSection>

      <DocSection title="One order per token">
        <p>Each wallet has one order per token at a time. A token account can approve only one delegate for one amount, so a second order would silently replace the first order&apos;s approval.</p>
        <p>To change your terms, revoke the open order and set a new one. After a full fill, close the order. Closing returns the order account&apos;s SOL deposit.</p>
      </DocSection>

      <DocSection title="Revoke">
        <p>Revoke closes the order and removes the approval in one transaction. Anything already filled stays in your wallet. After that, nothing can fill, and a fill attempt fails on chain. See the <Link href="/demo">recorded example</Link>.</p>
      </DocSection>

      <DocSection title="Faucet limits">
        <ul>
          <li>The faucet only tops up wallets holding less than half a replica token (2.5 shares for SpaceX).</li>
          <li>Each token has its own faucet limit. A wallet with an open order or remaining tokens can request once per hour. A wallet that sold everything and closed its order can refill right away.</li>
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
