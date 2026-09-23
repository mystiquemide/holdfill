# Holdfill design system

Version 2.0, 23 September 2026. This is the spec the Holdfill pages are built from.

## 1. Brand

- Name: Holdfill, `holdfill` in the wordmark, "Holdfill" in sentences.
- Tagline: "Hold through the lockup. Fill before the deadline."
- Positioning: standing exit orders for pre-IPO tokens. Set your price once. Holdfill converts when the pool pays it, never below your terms, never after the issuer deadline.
- Personality: calm, exact, a little warm. Paper and ink, with a cream accent. Consumer friendly, never a trading game.
- Voice: short sentences, plain words, real numbers with a source. Never promise a price or a return.

| Use | Avoid |
|---|---|
| order, limit, fill, convert, deadline, entitlement, gap, revoke | moon, gains, profit, guaranteed, risk-free |
| "never below your terms" | "best price" |
| "devnet replica", "live mainnet" | "mock", "fake", "demo tokens", "real-time" without a time |
| the issuer's deadline text, quoted and linked | "trapped", "stuck", "rug", "expire worthless" as a scare line |

Copy stays pro-holder and pro-issuer: state the conversion path PreStocks defined, then what Holdfill adds.

## 2. Logo

- Mark on a 24 grid: left stem is an outline (the position you hold), right stem is solid (the conversion), crossbar is a cream bar outlined in ink (the limit).
- Wordmark: `hold` at 400, `fill` at 600, Geist, tracking -0.02em. Mark left, wordmark right, 5px gap.
- Favicon: the mark on white, rounded square (`web/src/app/icon.svg`).

## 3. Color

Light theme. Marketing chrome is ink, paper, vellum, and cream only. State colors appear only inside product UI (gap bar, order card, ticket, chart, activity).

| Token | Hex | Use |
|---|---|---|
| `ink` | #171717 | text, primary buttons, dark CTA card |
| `paper` | #FFFFFF | canvas, cards |
| `vellum` | #F3F3F3 | secondary buttons, inputs, table column |
| `hairline` | #E5E7EB | borders, dividers |
| `slate` | #6F6F6F | secondary text (5.0:1 on white, 4.5:1 on vellum) |
| `cream` | #FFE9BF | honesty strip, DEVNET REPLICA and ARMED chips |
| `hold` | #845A0C | limit line and tick, ARMED text (6.1:1 white, 5.1:1 cream) |
| `fill` | #17724B | filled, received, fill markers (5.9:1 white) |
| `deadline` | #B93C12 | errors, BLOCKED, rejected (5.7:1 white) |
| `revoked` | #6B7079 | closed orders, always with a text label |

No gradients except photo scrims. No purple, no blue.

## 4. Type

- Geist 400 for everything, 500 for button and chip labels. Headlines at 400 with tracking -0.02 to -0.03em, second line in slate.
- Scale: 12, 14, 15, 16, 18, 24, 36, 48, 60, 72. Display 72 desktop, 40 mobile, line height 1.0 to 1.1.
- Numbers use tabular figures in Geist (`.num`). Geist Mono (`.mono`) only for addresses, signatures, and code.
- Minimum text size 12px, including chart labels.

## 5. Layout and shape

- Container 1200px, 24px gutters, 16px side padding on mobile. Section spacing 96px.
- Cards 20px radius, large cards and photo frames 24px, inputs 14px, buttons and chips fully rounded.
- 1px hairline borders. One soft four-layer shadow (`--shadow-lift`) only on the live preview card, the order ticket, the order card, modals, and toasts.
- Motion: 150ms ease-out on state changes, gap bar width 400ms, one rise-in on the hero. `prefers-reduced-motion` removes motion.

## 6. Imagery

| Where | Photo | Source |
|---|---|---|
| Hero frame | Launch trail at dusk | SpaceX on Unsplash |
| Final CTA card | Launch arc through star trails | SpaceX on Unsplash |
| One real deadline | Hourglass on white | Wilhelm Gunkel on Unsplash |

Full opacity, never blurred, a white scrim behind hero text and an ink scrim behind CTA text. No credit lines on the page (the Unsplash License does not require them). The landing footer states Holdfill is not affiliated with SpaceX or PreStocks.

## 7. Components

| Component | Rules |
|---|---|
| NetBadge | `LIVE MAINNET` on vellum or `DEVNET REPLICA` on cream. Every card with a number carries one. Never wraps. |
| Button | Primary ink, secondary vellum, danger vellum with deadline text, light (on dark). 44px tall. No outline-only buttons. Disabled buttons state the reason and the next step as their label. |
| GapBar | Entitlement row, pool-pays row with gap, track (solid share, hatched gap, hold tick with label), limit row with "not yet", "pool meets it now", or "filled", optional deadline row. The tick follows the viewer's shared limit. |
| Stat | Value, label, source with time. |
| Order ticket | Holdings line, devnet gap bar, amount with Max, limit slider (0 to 60%) with live backtest line, fallback date, floor (40 to 70%), preview, disclosures, Sign order. |
| Order card | Chip (ARMED, PARTIAL, FILLED, BLOCKED), gap bar, four stats, one status line, Check now, Revoke (or Close and set a new order when filled). |
| Activity | Time, event (Created, Filled, Closed, Rejected), detail, signature linked to Explorer. |
| HaircutChart | Hand-built SVG, 0 to 45%, hold limit line, fill markers on days at or under the limit, dashed lockup lines explained in a legend, hover tooltip, full daily table in a disclosure. |
| Modal | Title, close button, Escape closes, focus moves in and returns. |
| Toast | Bottom right (bottom center on mobile), dot color by tone, optional transaction link. |

## 8. Page

The landing page, `/how`, `/evidence`, and `/proof` share the honesty strip and marketing nav with the wallet button. The nav marks the current marketing route with a hold-colored underline. "How it works" links to `/how` from every page. `/app` has its own focused header with the logo and wallet button, without the marketing strip or navigation. Only the landing page has the footer. The standalone pages open with a "Back to home" button.

| Route | Contents |
|---|---|
| `/` | Hero with live preview card, a devnet demo badge and wallet-free demo link, How it works, evidence preview (live gap, 20% backtest, scoped Jupiter V1 result), a comparison including Jupiter V2 and Meteora, proof preview, and wallet connection CTAs. |
| `/how` | Three-step explanation, a plain-language limit example, and a wallet connection CTA. |
| `/demo` | Wallet-free walkthrough of recorded devnet order creation, fill, below-minimum rejection, and revocation, with Explorer links. |
| `/app` | The app: market card and the position panel with every order state, ticket, modals, activity. |
| `/evidence` | Stats row, gap history chart with backtest and daily table, live Jupiter check, one real sale, one real deadline. |
| `/proof` | Cloned-mainnet run with mint and pool links, devnet program, upgrade authority, signatures, what Holdfill never does. |

Connecting from the wallet picker opens `/app`. Disconnecting while on `/app` returns to `/`. A wallet that reconnects on its own after a refresh never redirects. Landing CTAs open the wallet picker, or open `/app` for a wallet that is already connected. `/order` redirects to `/app` for older links. A direct visit to `/app` without a wallet shows the connect state.

The landing and app explain entitlement, the live pool quote, and the minimum implied by the viewer's limit in plain language. A devnet demo badge sits by the main wallet action and before order setup. PreStocks' ownership, liquidity, and eligibility risks appear by wallet CTAs and before the order interface, with a link to the issuer's terms. The Jupiter check names Trigger V1, announces loading, response time, cached check time, and refresh errors; V2 compatibility is left unverified.

The order section states, in order: not connected, loading, no replica tokens (faucet), holding (ticket), armed, partial, filled, blocked (paused, fee changed, deadline passed, approval removed), revoked banner. Transactions are built by the server, signed in the wallet, and relayed by the server to devnet.

Every number shows its network and a time or source. Two gap measures are never mixed: the executable gap (a live quote for a stated size, fees included) and the daily close gap (history and backtest only).

## 9. Microcopy

| Moment | Copy |
|---|---|
| Order armed | "Order armed. Holdfill fills when the pool pays at least 0.8000 SPCXx per share." |
| Waiting check | "Checked 08:03 UTC. Pool pays 29.3% under entitlement. Your limit is 10%. No fill yet." |
| Filled | "Filled. You received 3.5358 SPCXx. Realized gap 29.3% including the 1% issuer transfer fee." |
| Revoked | "Order revoked. The approval is removed and nothing else can fill." |
| Signature cancelled | "Signature cancelled. Nothing was sent." |
| Check that never reached the chain | "The fill didn't go through this time, and nothing moved. Try again in a few seconds." |
| RPC down | "Couldn't reach Solana. Retrying in 10 seconds." Last values stay with their time. |
| Empty activity | "No activity yet. The keeper's first check runs within 10 seconds of signing." |

## 10. Mobile

Single column. The honesty strip scrolls away, the nav stays. The comparison becomes one block per question. Nothing scrolls sideways at 390px. Interactive targets are at least 24px or spaced 24px apart.

## 11. Build rules

- One section at a time, checked in the browser at 1440 and 390 before the next.
- No placeholder copy, no illustrative numbers, no dead links, no em dashes.
- Keep approved sections unchanged while building later ones.
