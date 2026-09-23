# Holdfill

Hold through the lockup. Fill before the deadline.

Holdfill gives PreStocks holders standing orders on Solana. Tokens stay in the holder's wallet until a fill meets their terms, and an on-chain program enforces the approved amount, the minimum output, the fallback terms, and the issuer deadline. Three order types share one program:

- **Conversion:** SpaceX PreStocks (SPACEX) into SpaceX xStock (SPCXx) before the issuer deadline, at no worse than the holder's limit.
- **Price order:** any PreStocks token into USDC at a price the holder sets. Jupiter's trigger API refuses every PreStocks mint because of its transfer fee.
- **Arm for the IPO:** terms set today for a token whose issuer has not named a successor. The keeper activates the order when the issuer registers the event.

Orders execute on Solana devnet against replica tokens. Market data is live mainnet. A separate local-validator proof runs the same program against cloned mainnet mints and pools.

Built for [Stocklana](https://hackathons.solana.com/hackathons/stocklana) (Solana Foundation), main track and PreStocks bounty.

## Try it

- [Live app](https://holdfill.vercel.app/): SpaceX, Anthropic, and OpenAI markets in the [order app](https://holdfill.vercel.app/app), with an in-app devnet faucet
- [Wallet-free walkthrough](https://holdfill.vercel.app/demo) of recorded devnet transactions
- [Every PreStocks market, live](https://holdfill.vercel.app/markets) and the [issuer view](https://holdfill.vercel.app/issuer)
- [Evidence](https://holdfill.vercel.app/evidence), [proof](https://holdfill.vercel.app/proof), and [docs](https://holdfill.vercel.app/docs)

## Built with

| Service | How Holdfill uses it |
|---|---|
| [Solana](https://solana.com) | The order program (Anchor 1.2) on devnet. Token-2022 mints carry the issuer's transfer fee, pause, and delegate rules. |
| [PreStocks](https://www.prestocks.com) | The tokens holders convert or sell. The PreStocks API supplies mark prices and supply; issuer terms are quoted from its pages. |
| [Meteora](https://www.meteora.ag) | Every fill is a DLMM `swap2` the order program signs as the holder's delegate. The TypeScript SDK builds quotes and swap accounts. |
| [Jupiter](https://jup.ag) | Price API and Tokens API for prices, holders, and volume; a live Trigger API call shows it refuses PreStocks mints. |
| [Helius](https://www.helius.dev) | RPC for mainnet reads and devnet orders, with a separate key for the keeper. |
| [xStocks](https://xstocks.fi) | SPCXx, the listed SpaceX token SpaceX PreStocks convert into. |
| [GeckoTerminal](https://www.geckoterminal.com) | Daily closes for the gap history and backtest. |
| [Next.js](https://nextjs.org) on [Vercel](https://vercel.com) | The web app and API routes. Solana Wallet Adapter connects Phantom, Solflare, and Backpack. |

## How it works

1. The holder signs one transaction: it creates the order account and approves the order program as delegate for that amount only.
2. The keeper checks open orders every 10 seconds and quotes the pool. It sends `execute` only when the quote meets the holder's minimum.
3. The program derives every pool account itself, swaps through Meteora as the delegate, and measures what reached the holder. Anything below the minimum reverts.
4. Revoke closes the order and removes the approval in one transaction.

```
programs/holdfill_orders   Anchor program: orders, lifecycle events, execute
keeper/                    fill worker (also behind the app's "Check now")
web/                       Next.js app and API routes
scripts/                   devnet setup, proofs, data refresh
tests/                     local-validator program suite
config/devnet.json         every devnet address the app uses
data/                      proof records and market history
```

[ARCHITECTURE.md](docs/ARCHITECTURE.md) covers accounts, instructions, trust boundaries, API routes, and replica differences.

## Run it locally

Requirements: Node 22 or later, and a free [Helius](https://www.helius.dev) API key. The program toolchain is only needed for the tests and proofs below.

```bash
git clone https://github.com/mystiquemide/holdfill.git
cd holdfill
npm ci
```

Create `web/.env.local`:

```bash
HELIUS_API_KEY=your_helius_key
KEEPER_KEYPAIR=[...]          # any devnet keypair with a little SOL, as a JSON array; pays for "Check now" fills
KEEPER_TICK_SECRET=any-random-string
# ISSUER_KEYPAIR=[...]        # only the replica mint authority can run the faucet; see below
```

Make a keeper keypair with `solana-keygen new -o keeper.json --no-bip39-passphrase`, fund it at [faucet.solana.com](https://faucet.solana.com), and paste the file's contents as `KEEPER_KEYPAIR`.

Start the app at http://localhost:3000:

```bash
npm run dev:web
```

Your local app uses the same devnet program, replica tokens, and pools as the live app (addresses in `config/devnet.json`). The replica mints belong to the project's issuer key, so a local faucet can't mint. Get replica tokens from the live app's faucet with your wallet, then set orders from your local app.

Run the keeper so orders fill without pressing Check now:

```bash
HELIUS_API_KEY=your_helius_key KEEPER_KEYPAIR_PATH=./keeper.json npm run keeper
```

## Tests and proofs

Anyone with the toolchain can run these. They need Rust 1.89 (pinned in `rust-toolchain.toml`), Anchor 1.2, and the Solana CLI 4.x with `solana-test-validator`.

```bash
npm run test:program        # Rust unit tests for the order math (9)
npm run test:keeper-math    # keeper math matches the program (7)
npm run test:backtest       # backtest over the gap history (6)
npm run build:program       # builds the program and copies the IDL
HELIUS_API_KEY=your_key npm run proof:fork
```

`proof:fork` starts a local validator with cloned mainnet state (the real SpaceX mint and pool, and the real OpenAI mint, USDC, and OpenAI/USDC pool), runs seven checks, stops the validator, and writes [data/proof-fork.json](data/proof-fork.json). It sends nothing to mainnet.

The full program suite (`npm run test:local`, 40 checks, run against a local validator started from `npm run local:args`) registers lifecycle events, so it needs the event admin key and runs in the maintainers' environment. Its latest result is in [data/program-local.json](data/program-local.json).

Recorded devnet transactions, each linked to Solana Explorer:

- [data/proof-devnet.json](data/proof-devnet.json): conversion order created, filled above its minimum, a fill below the minimum refused on chain, revoked, and a fill after revoke refused.
- [data/proof-devnet-v2.json](data/proof-devnet-v2.json): a price order filled into USDC, a price the pool can't pay refused, and an armed order activated by a simulated issuer event on a separate demo token, then filled.

## Devnet deployment

- Order program: [`A6UhawZdBQiMwpDYzFXKzTJD5voF29rLmrViUT6WaSGV`](https://explorer.solana.com/address/A6UhawZdBQiMwpDYzFXKzTJD5voF29rLmrViUT6WaSGV?cluster=devnet). It is upgradeable; the authority is the demo issuer key, shown live on the proof page.
- Replica markets: SPACEX into SPCXx, and Anthropic and OpenAI into USDC, each on a Meteora DLMM pool priced from mainnet. `npm run devnet:sync` re-aligns the SPACEX pool with the mainnet price.

To run your own deployment, change `declare_id!` in `programs/holdfill_orders/src/lib.rs` and `EVENT_ADMIN` in `constants.rs` to your keys, deploy the program, then run `npm run devnet:setup`, `npm run devnet:proof` (registers the SPACEX lifecycle event), and `npm run devnet:markets -- ANTHROPIC OPENAI` with `ISSUER_KEYPAIR_PATH` pointing at your issuer keypair. Each script writes its addresses to `config/devnet.json`, which the app and keeper read.

## Limits

- The keeper fills only while it runs. If it stops, orders stay open and tokens stay in the holder's wallet. Anyone can call the permissionless `execute`, and the app's Check now runs one pass.
- Devnet pools charge a 10% fee (the only devnet preset), so devnet fills pay less than mainnet quotes.
- The devnet replicas keep the 1% transfer fee. Meteora's devnet pools reject the pause, delegate, and scaled-amount extensions without an admin badge; the fork proof covers the real mints.
- PreStocks give economic exposure, not ownership rights, and secondary-market liquidity isn't guaranteed. They are unavailable in the U.S. and to U.S. persons. See the [issuer's terms](https://prestocks.com/faq?tab=legal).

## License

MIT
