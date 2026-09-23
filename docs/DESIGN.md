# Holdfill design system

Version 1.0, 23 September 2026. Status: awaiting approval.

This file is the complete design spec. Build from it alone.

## 1. Brand

- Name: Holdfill, written `holdfill` in the wordmark and "Holdfill" in sentences.
- Tagline: "Hold through the lockup. Fill before the deadline."
- One-line positioning: Standing exit orders for pre-IPO tokens. Set your price and your deadline once. Holdfill converts when the gap closes, never below your terms, never after the deadline.
- Personality: calm, exact, trustworthy. A brokerage order ticket, not a trading game.
- Voice: short sentences, plain words, real numbers. State facts, never hype. Never promise a price or a return.

### Words to use and avoid

| Use | Avoid |
|---|---|
| order, limit, fill, convert, deadline, entitlement, haircut, gap, revoke | moon, gains, profit, guaranteed, free money, risk-free |
| "never below your terms" | "best price" |
| "devnet replica" | "mock", "fake", "demo tokens" |
| "live mainnet" | "real-time" without a timestamp |
| "the conversion path PreStocks defined", "waits for your price" | "trapped", "stuck", "rug", "discount trap", "expire worthless" as a scare line |
| the issuer's deadline text, quoted and linked | paraphrased deadline warnings |

## 2. Logo

- Mark: a capital H made of three rectangles. Left stem is an outline (the position you hold). Right stem is solid (the conversion once filled). Crossbar is the holder's limit line and uses the hold color.
- Geometry on a 24 x 24 grid: stems 5 wide, 20 tall, at x 2 and x 17; outline stroke 1.5; crossbar 10 wide, 3 tall, at x 7, y 10.5.
- Wordmark: `holdfill` lowercase Geist. `hold` weight 400, `fill` weight 600. Letter spacing -0.02em.
- Lockup: mark left, wordmark right, gap equal to one stem width.
- Favicon: the mark alone on the ground color.
- Never: gradients, shadows, rotation, recoloring the stems, adding arrows or rockets.

## 3. Color tokens

Dark is the default theme. A light theme uses the same tokens.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--ground` | #0B0D10 | #F6F4EF | page background |
| `--surface` | #14171C | #FFFFFF | cards, ticket |
| `--surface-2` | #1B1F26 | #F2EFE8 | inputs, table headers |
| `--line` | #262B33 | #E2DED5 | borders, grid |
| `--text` | #E8E6E1 | #15181D | primary text |
| `--muted` | #8A909A | #6B7079 | labels, secondary |
| `--hold` | #F5B544 | #B7791F | armed orders, limit line, brand accent |
| `--fill` | #3DDC97 | #1F8A5B | filled, received |
| `--deadline` | #FF6B4A | #C2410C | countdown, expiry risk, errors |
| `--revoked` | #5B616B | #9CA3AF | cancelled |

Rules: one meaning per state color. No gradients, no glow, no purple. Text on `--hold` and `--fill` fills uses `--ground`.

## 4. Typography

| Role | Font | Size / line height | Weight |
|---|---|---|---|
| Display (hero) | Geist | 56/60, mobile 36/40 | 600, tracking -0.03em |
| H1 | Geist | 32/38 | 600 |
| H2 | Geist | 22/28 | 600 |
| Body | Geist | 15/24 | 400 |
| Label | Geist | 12/16, uppercase, tracking 0.06em | 500 |
| Numbers | Geist Mono | inherit size | 500, tabular figures |

Every price, ratio, amount, percentage, and countdown uses Geist Mono with `font-variant-numeric: tabular-nums`. Load both from Google Fonts via `next/font/google`.

## 5. Layout

- 12-column grid, max width 1200px, 24px gutters, 16px side padding on mobile.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Radius: 6 on inputs and buttons, 10 on cards. No pill buttons.
- Borders: 1px `--line`. Cards have no shadows.
- Motion: 150ms ease-out on hover and state changes. The gap bar animates its fill width over 400ms when data changes. Respect `prefers-reduced-motion`.

## 6. Components

### 6.1 Network label (`NetBadge`)
Small uppercase label with a 1px border. Two variants only:
- `LIVE MAINNET` in `--text` on `--surface-2`.
- `DEVNET REPLICA` in `--hold` with `--hold` border.
Every card that shows a number carries one. No colored dots.

### 6.2 Gap bar (`GapBar`), the signature component
Props: entitlement, market, limit_bps, fallback floor, status.
```
ENTITLEMENT  5.000 SPCXx                                          $771.52
MARKET       3.547 SPCXx  ██████████████████████████░░░░░░░░░░░  29.1% gap
YOUR LIMIT   20%                                      ▲
DEADLINE     12 Mar 2027                                    171 days left
```
- Track: full width = entitlement. Solid segment = market share of entitlement in `--muted` while waiting, `--fill` once the market reaches the limit.
- Hatched segment = the gap, `--line` hatch at 45 degrees.
- Limit tick: 2px `--hold` line with a small triangle and label.
- Fallback floor tick: dashed `--deadline` line, shown only when the fallback date is within 30 days or passed.
- All values in Geist Mono. Height 12px on the track. Labels above and below, never inside.

### 6.3 Order ticket (`OrderTicket`)
Fields, in order:
1. Amount to convert: number input in displayed SPACEX shares, with MAX. Helper: "= 0.2000 raw tokens".
2. Maximum haircut: slider 0 to 60% in 1% steps plus number input. Default 20%. Helper shows today's gap and the backtest line: "Would have filled on 6 of 71 days since listing."
3. Fallback date: date input. Default 1 Mar 2027. Max 11 Mar 2027.
4. Fallback floor: select 40%, 50%, 60%, 70% of entitlement. Default 50%.
Preview block: "You will receive at least 0.8000 SPCXx per share before 1 Mar 2027, and at least 0.5000 after. Nothing converts after 12 Mar 2027."
Disclosures, always visible, muted 12px: "Holdfill never holds your tokens. You approve the order program for this amount only and can revoke at any time. The issuer controls a transfer fee, a pause switch, and a permanent delegate on this token."
Primary button: "Sign order" in `--hold` fill, `--ground` text. Disabled with a specific reason when invalid.

### 6.4 Order card (`OrderCard`)
Shows status label (ARMED in `--hold`, FILLED in `--fill`, PARTIAL in `--fill` outline, REVOKED in `--revoked`, BLOCKED in `--deadline`), the gap bar for this order, filled / size, received, minimum per share now, time to fallback and deadline, and actions: "Check now" (secondary) and "Revoke" (text button in `--deadline`).

### 6.5 Stat tile (`Stat`)
Label on top, value in Geist Mono 28px, one-line source under it ("Jupiter tokens API, 23 Sep 14:02 UTC"). Never a chart inside a tile.

### 6.6 Activity row (`TxRow`)
Time, event (Created, Filled, Check, Rejected, Revoked), amount in, amount out, realized haircut, signature link to Solana Explorer with the right cluster.

### 6.7 History chart (`HaircutChart`)
Line of daily haircut since 12 Jun 2026. Y axis 0 to 45%, inverted is not allowed. Horizontal `--hold` line at the viewer's limit. Days at or below the limit get a `--fill` marker. Vertical dashed markers for lockup release dates (9 Sep, 24 Sep, 9 Oct, 24 Oct, 8 Dec). Tooltip: date, haircut, pool volume. Hand-built SVG, no chart library.

### 6.8 Buttons
Primary: `--hold` fill. Secondary: `--surface-2` fill, `--line` border. Destructive text button: `--deadline`. Heights 40 desktop, 44 mobile.

## 7. Page and screens

One route, `/`. The page reads top to bottom as hero, product, evidence, proof. Header links scroll to sections. One page to polish, one URL to share.

### 7.1 Hero (live mainnet)

```
+------------------------------------------------------------------------+
| [H] holdfill          Product   Evidence   Proof    [ Connect wallet ] |
+------------------------------------------------------------------------+
| LIVE MAINNET                                                           |
| SpaceX listed on 12 June. SpaceX PreStocks convert into SPCXx.         |
| Holdfill waits for your price.                                         |
| Hold through the lockup. Fill before the deadline.                     |
|                                                                        |
| [ GapBar, live mainnet, entitlement in USD from PreStocks mark, 20% ] |
|                                                                        |
| [ Set an order ]   [ See the proof ]                                   |
+------------------------------------------------------------------------+
| 10,059 holders | 29.1% gap today | 171 days to the deadline |          |
| $771 entitlement per token (PreStocks mark)   (each Stat with source)  |
+------------------------------------------------------------------------+
```
- Hero numbers come from `/api/market`. While loading, show the last cached values with their timestamp, never zeros.
- The entitlement USD value is `5 x markPrice` per raw token from the PreStocks API (PreStocks' SpaceX mark tracks the listed SPCX price). Source line: "PreStocks mark, HH:MM UTC".
- Two gap numbers exist and must never be mixed. **Executable gap**: from a live quote for a given size, including the 1% transfer fee and slippage. Used in the hero (quote for 1 raw token), the order ticket (quote for the ticket size), and the order card. **Daily close gap**: from pool daily close prices. Used only in the history chart and backtest. Each carries its label.
- Copy stays pro-holder and pro-issuer: state the conversion path PreStocks defined, then what Holdfill adds. Never frame the gap as a flaw of PreStocks.

### 7.2 Product section, disconnected

```
+------------------------------------------------------------------------+
| PRODUCT                                                                |
| MARKET  LIVE MAINNET                          | YOUR POSITION           |
| [GapBar mainnet]                              | Connect a wallet to see |
| Pool quote 1 raw  PreStocks mark  SPCXx price  | your SPACEX and set an |
| SpaceX price  Holders  Supply                 | order on devnet.        |
|                                               | [ Connect wallet ]      |
+------------------------------------------------------------------------+
```
- SPCXx USD price from the Jupiter price API. Pool-implied value per share = SPCXx per share from the quote x SPCXx USD price, shown next to the PreStocks mark.

### 7.3 Product section, connected, wallet on devnet with no replica tokens

```
| YOUR POSITION  DEVNET REPLICA                                          |
| Mainnet SPACEX (read only): 0.0000                                     |
| Devnet replica SPACEX: 0.0000                                          |
| Get 1 replica SPACEX to try an order on devnet.                        |
| [ Get replica SPACEX ]   You need a little devnet SOL for fees.        |
```
- Faucet success: "Sent 1 replica SPACEX (5 shares). View transaction."
- Faucet limited: "One faucet request per wallet per hour. Try again at 15:40 UTC."
- No devnet SOL: link to faucet.solana.com with the wallet address prefilled in a copy field.

### 7.4 Product section, connected with replica tokens, no order

```
| YOUR POSITION  DEVNET REPLICA        | ORDER TICKET  DEVNET REPLICA    |
| 1.0000 raw  =  5.0000 shares         | Amount   [ 5.0000 ] shares MAX  |
| Entitlement  5.0000 SPCXx            | Max haircut  [====|----] 20%    |
| Pool pays    3.5470 SPCXx            | Fallback date [ 2027-03-01 ]    |
| Gap          29.1%                   | Fallback floor [ 50% v ]        |
| [GapBar devnet with limit preview]   | Preview: at least 0.8000 SPCXx  |
|                                      | per share before 1 Mar 2027...  |
|                                      | Disclosures                     |
|                                      | [ Sign order ]                  |
```

### 7.5 Product section, order armed

```
| ORDER  ARMED                                            DEVNET REPLICA |
| [GapBar with limit tick]                                               |
| Filled 0.0000 / 5.0000 shares   Received 0.0000 SPCXx                  |
| Minimum now 0.8000 SPCXx per share   Fallback in 159 days             |
| Waiting: pool pays 29.1% under entitlement, your limit is 20%.         |
| [ Check now ]                                           Revoke         |
```

### 7.6 Product section, filled or partial

```
| ORDER  FILLED                                           DEVNET REPLICA |
| [GapBar in fill color]                                                 |
| Filled 5.0000 / 5.0000 shares   Received 4.1250 SPCXx                  |
| Realized haircut 17.5% including the 1% issuer transfer fee            |
| ACTIVITY                                                               |
| 14:02 Filled  5.0000 -> 4.1250  17.5%  4xT...9Qa                       |
| 13:55 Created size 5.0000 limit 20%    2mB...7Lk                        |
```
Partial: label PARTIAL, "Filled 2.0000 / 5.0000 shares. Waiting for liquidity at your limit."

### 7.7 Blocked and error states

| State | Message |
|---|---|
| Wallet on mainnet while signing | "Holdfill orders run on devnet for this build. Switch your wallet to devnet to sign." |
| User rejects signature | "Signature cancelled. Nothing was sent." |
| Insufficient devnet SOL | "You need about 0.01 devnet SOL for fees." plus faucet link |
| Mint paused | BLOCKED: "The issuer paused this token. Your order cannot fill until it resumes." |
| Fee changed | BLOCKED: "The issuer changed the transfer fee from 1.00% to X%. Revoke and create a new order to accept it." |
| Deadline passed | "The issuer deadline passed. This order can no longer fill." |
| RPC failure | "Couldn't reach Solana. Retrying in 10 seconds." Keep last good values with timestamp. |
| Check now, not reachable | "Checked 14:05 UTC. Pool pays 27.8% under entitlement. Your limit is 20%. No fill." |

### 7.8 Evidence section (live mainnet)

```
+------------------------------------------------------------------------+
| EVIDENCE  LIVE MAINNET                                                 |
| The gap since listing       [HaircutChart, limit line, unlock markers] |
| Your limit would have filled on 6 of 71 days. First: 13 Jun 2026.      |
|------------------------------------------------------------------------|
| No order type exists today   [ Run check ]                             |
| POST lite-api.jup.ag/trigger/v1/createOrder  (checked 14:02 UTC)       |
| {"error":"... Mint PreANx...fTh has transfer fee","code":2}            |
|------------------------------------------------------------------------|
| One real sale     [wallet] sold [n] SPACEX for [m] SPCXx on [date],    |
|                   [x]% under entitlement. Next unlock [k] days later.  |
|                   [ View on Solana Explorer ]                          |
| One real deadline XAI conversion closed 12 Sep 2026.                   |
|                   1,476 wallets still hold XAI.                        |
+------------------------------------------------------------------------+
```
- The "one real sale" values come from `data/case-study.json`, produced from a real mainnet transaction. Ship real values or remove the block.

### 7.9 Proof section

```
+------------------------------------------------------------------------+
| PROOF                                                                  |
| On cloned mainnet state (real SPACEX, real pool, real 1% fee)          |
|  PASS  Order fills from the holder's wallet, keeper holds nothing      |
|  PASS  Issuer pause blocks the fill                                    |
|  PASS  Fill after revoke rejected                                      |
|  PASS  Fill below the holder's minimum rejected                        |
|  PASS  Issuer fee change blocks the fill                               |
|  Run it yourself: npm run proof:fork                                   |
|------------------------------------------------------------------------|
| On devnet   Program [id]   Upgrade authority: [status]                 |
|  Created [sig]   Filled [sig]   Rejected [sig]   Revoked [sig]         |
+------------------------------------------------------------------------+
| Built for Stocklana. PreStocks tokens are not available to US persons. |
| Holdfill does not set prices or guarantee conversion value.            |
+------------------------------------------------------------------------+
```
- Program id and signatures come from `config/devnet.json`, `data/proof-devnet.json`, and `data/proof-fork.json`, written by the deploy and proof scripts. No hand-typed signatures.

## 8. Microcopy

| Moment | Copy |
|---|---|
| Order created | "Order armed. Holdfill will fill when the pool pays at least 0.8000 SPCXx per share." |
| Filled | "Filled. You received 4.1250 SPCXx. Realized haircut 17.5%." |
| Revoked | "Order revoked. The approval is removed and nothing else can fill." |
| Empty activity | "No activity yet. Your first check runs within 10 seconds of signing." |

## 9. Mobile

- Single column. Order ticket moves below the position card.
- Gap bar keeps all labels, stacked above the track.
- Tables become stacked rows with label and value pairs.
- Primary button full width, 44px tall.

## 10. Build rules

- Build one section at a time. Verify it renders with real data before starting the next.
- Keep approved sections unchanged while building later ones.
- Every number shows its network label and a timestamp or source line.
- No placeholder copy, lorem ipsum, or dead links in any shipped screen.
- No em dashes anywhere in UI copy.
