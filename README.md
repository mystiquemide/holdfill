# Holdfill

Hold through the lockup. Fill before the deadline.

Holdfill is a standing order demo for converting SpaceX PreStocks (SPACEX) into SpaceX xStock (SPCXx). The holder keeps tokens in their wallet until a fill meets their minimum. The order program enforces the approved amount, minimum output, fallback terms, and issuer deadline.

**Execution is on Solana devnet replicas.** Market data is read from mainnet. The replica pool carries the 1% SPACEX transfer fee, but some mainnet mint extensions cannot be reproduced in the permissionless devnet pool. A separate local-validator proof runs the same program against cloned mainnet mint and pool state.

## See it

- [Product preview](https://holdfill-preview.midelabs.xyz/)
- [Wallet-free walkthrough](https://holdfill-preview.midelabs.xyz/demo)
- [Evidence](https://holdfill-preview.midelabs.xyz/evidence) and [proof](https://holdfill-preview.midelabs.xyz/proof)

The walkthrough links recorded devnet transactions for order creation, a successful fill, a below-minimum rejection, and revocation. It does not require a wallet.

## Verify the proof

The committed [devnet proof record](data/proof-devnet.json) links every transaction to Solana Explorer. In particular:

- [Successful fill](https://explorer.solana.com/tx/4Bs8GmHNn36FhRb2eoU9mZdkphbJcoELvuywNryocfWQE2Eqdbr3NMT9a4zEqo4g887NuwEPXo8byBdjTsaxHwZc?cluster=devnet): the holder received 0.35396549 SPCXx for 0.1 raw SPACEX, above the 0.325 minimum.
- [Below-minimum rejection](https://explorer.solana.com/tx/hyxFFgMh2sTddEKJkth8gfaCrBCvaFrczxC9XPtmW75dFMjyEzXNFuBHCethxXcMhyUtpL5EHpygfLRBu41aefm?cluster=devnet): a 10% limit required at least 0.45 SPCXx and the transaction failed on chain.
- [Revocation](https://explorer.solana.com/tx/36XnRwGqZpFubBmU5u8NdV8ghJwft7JqwdGy5uVi2sz2CYXydMK9R6Aor7z28RHUpLmKyyfvxKtTVm3p1r9xbKeU?cluster=devnet): closes the order and removes approval.

The [fork proof record](data/proof-fork.json) reports five checks against cloned mainnet state, including the real 1% transfer fee, an issuer pause, a fee change, a below-minimum rejection, and revocation. To reproduce it, install Node 22, Rust, Anchor 1.2, and the Solana CLI with `solana-test-validator` on your PATH. Then run:

```bash
npm ci
npm run build:program
HELIUS_API_KEY=your_key npm run proof:fork
```

The script starts and stops a local validator and writes `data/proof-fork.json`. It does not submit mainnet transactions. You can also run `npm run test:program`, `npm run test:keeper-math`, and `npm run test:backtest`.

## Architecture

- `programs/holdfill_orders` stores order terms and enforces the minimum during a Meteora DLMM swap.
- `web/` is a Next.js app. Its server builds unsigned order and revoke transactions, the wallet signs, and the server relays them to devnet.
- `keeper/` checks open orders every 10 seconds and attempts a fill only when the quote meets the holder's terms.
- Mainnet reads supply the market quote, historical evidence, and issuer context. Devnet handles every demo order.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for accounts, trust boundaries, API routes, and replica differences. The devnet program is upgradeable; the current authority is the demo issuer key and its address is read live on the proof page.

## Operational limits

The keeper checks open orders every 10 seconds while its worker is running. If it stops, an order stays open and the holder's tokens stay in their wallet; the holder can use **Check now** and anyone can call the permissionless execute path. The app labels the age of live market reads and keeps the last good value when a refresh fails. Price matching between the mainnet quote and devnet replica pool is run on demand.

PreStocks give economic exposure, not ownership rights, and secondary-market liquidity is not guaranteed. They are unavailable in the U.S. and to U.S. persons. See the [issuer's eligibility terms](https://prestocks.com/faq?tab=legal).

MIT license.
