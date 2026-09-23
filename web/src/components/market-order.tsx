"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { MarketPosition, MarketOrder } from "@/server/usdc-markets";
import type { Markets } from "@/server/markets";
import type { OrderEvent, OrderHistory } from "@/server/orders";
import { day, explainError, explorerTx, int, num, pct, shortAddr, signedPct, usd, usdCompact, utcTime } from "@/lib/format";
import { Modal, WalletButton } from "./chrome";
import { Activity, Line, Stat, usePolling, useSubmit } from "./order";
import { useToasts } from "./providers";
import { Button, Chip, NetBadge, Source } from "./ui";

const BASE = 1e9;
const EXPIRIES = [30, 90, 180, 365];
const FALLBACK_DAYS = [7, 14, 30, 60, 90];
const FLOORS = [4000, 5000, 6000, 7000];
const post = (url: string, body: object) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Order panel for a PreStocks token with no issuer event: sell into USDC at a price, or arm for the IPO. */
export function MarketOrderSection({ symbol }: { symbol: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] [&>*]:min-w-0">
      <MainnetCard symbol={symbol} />
      <PositionPanel symbol={symbol} />
    </div>
  );
}

function MainnetCard({ symbol }: { symbol: string }) {
  const { data, error } = usePolling<Markets>("/api/markets", 60_000);
  const m = data?.markets.find((x) => x.symbol === symbol);
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-lg">Market</h2><NetBadge net="mainnet" /></div>
      {m ? (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            <Fact label="PreStocks mark" value={usd(m.markUsd)} source="per token, PreStocks API" />
            <Fact label="Jupiter price" value={m.poolUsd === null ? "n/a" : usd(m.poolUsd)} source={m.vsMarkPct === null ? "Jupiter price API" : `${signedPct(m.vsMarkPct)} vs mark`} />
            <Fact label="Holders" value={m.holders === null ? "n/a" : int(m.holders)} source="Jupiter tokens API" />
            <Fact label="24h volume" value={m.volume24hUsd === null ? "n/a" : usdCompact(m.volume24hUsd)} source="all pools" />
            <Fact label="Transfer fee" value={m.transferFeeBps === null ? "n/a" : pct(m.transferFeeBps / 100, 0)} source="set by the issuer" />
            <Fact label="Jupiter Trigger" value={m.jupiterTrigger?.refused ? "Refused" : m.jupiterTrigger ? "Accepted" : "n/a"} source="limit order into USDC" />
          </dl>
          <p className="mt-5 rounded-[14px] bg-vellum p-4 text-sm leading-relaxed">
            No conversion event announced. Until an issuer names a successor token, holders can sell into USDC at a price they set, or arm an order for the event.
          </p>
          <Source>{error ? "Couldn't refresh. Showing the last values." : `Updated ${utcTime(data!.asOf)}`}</Source>
        </>
      ) : (
        <p className="py-8 text-sm text-slate">{error ? "Couldn't reach the market data sources." : "Reading mainnet..."}</p>
      )}
    </div>
  );
}

function Fact({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.06em] text-slate">{label}</dt>
      <dd className="num mt-1 text-lg text-ink">{value}</dd>
      <dd className="text-xs text-slate">{source}</dd>
    </div>
  );
}

function describe(e: OrderEvent): string {
  if (e.kind === "created") return `${num(Number(e.sizeRaw ?? 0) / BASE)} tokens, at least ${usd(e.pricePerToken ?? 0)} each`;
  if (e.kind === "armed") return `${num(Number(e.sizeRaw ?? 0) / BASE)} tokens, largest gap ${pct((e.limitBps ?? 0) / 100, 0)}`;
  if (e.kind === "activated") return "issuer terms copied in";
  if (e.kind === "filled") return `${num(Number(e.amountInRaw ?? 0) / BASE)} tokens at ${usd(e.pricePerToken ?? 0)} each`;
  if (e.kind === "cancelled") return Number(e.amountInRaw ?? 0) > 0 ? `closed after selling ${num(Number(e.amountInRaw) / BASE)} tokens` : "revoked before any fill";
  return explainError(e.error);
}

function PositionPanel({ symbol }: { symbol: string }) {
  const { publicKey, connected } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  const pos = usePolling<MarketPosition>(owner ? `/api/position?owner=${owner}&market=${symbol}` : null, 10_000);
  const hist = usePolling<OrderHistory>(owner ? `/api/orders?owner=${owner}&market=${symbol}` : null, 15_000);
  const [ended, setEnded] = useState<"revoked" | "closed" | null>(null);
  const refreshAll = useCallback(() => { pos.refresh(); hist.refresh(); }, [pos, hist]);

  const shell = (children: React.ReactNode) => (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-lg">Your position</h2><NetBadge net="devnet" /></div>
      {children}
    </div>
  );

  if (!connected || !owner) {
    return shell(
      <div className="flex min-h-64 flex-1 flex-col items-start justify-center gap-4">
        <p className="max-w-md text-lg">Connect a wallet to try a {symbol} order on devnet.</p>
        <WalletButton id="order-connect" />
        <p className="text-sm text-slate">Orders use devnet replica tokens and replica USDC, so nothing on mainnet moves.</p>
      </div>,
    );
  }
  const p = pos.data;
  if (!p) return shell(<p className="py-10 text-sm text-slate">{pos.error ? "Couldn't reach Solana. Retrying in 10 seconds." : "Reading your devnet wallet..."}</p>);

  const events = hist.data?.events ?? [];
  const banner = ended && !p.devnet.order ? (
    <div className="mb-5 rounded-[14px] bg-vellum p-4 text-sm">{ended === "closed" ? "Order closed. Its SOL deposit is back in your wallet." : "Order revoked. The approval is removed and nothing else can fill."}</div>
  ) : null;

  const body = p.devnet.order
    ? <OrderCard position={p} order={p.devnet.order} onChange={refreshAll} onEnded={setEnded} />
    : BigInt(p.devnet.tokensRaw) === 0n
      ? shell(<>{banner}<Faucet position={p} soldOut={events.some((e) => e.kind === "filled")} onDone={refreshAll} /></>)
      : <>{banner}<Ticket position={p} onDone={() => { setEnded(null); refreshAll(); }} /></>;

  return (
    <div className="flex flex-col gap-6">
      {body}
      {(p.devnet.order || events.length > 0) && <Activity events={events} describe={describe} />}
    </div>
  );
}

function Balances({ p }: { p: MarketPosition }) {
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt className="text-xs uppercase tracking-[0.06em] text-slate">Mainnet {p.symbol}</dt>
        <dd className="num mt-1 text-lg">{num(p.mainnet.tokens)}</dd>
        <dd className="text-xs text-slate">read only</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-[0.06em] text-slate">Devnet replica {p.symbol}</dt>
        <dd className="num mt-1 text-lg">{num(p.devnet.tokens)}</dd>
        <dd className="num text-xs text-slate">{num(p.devnet.usdc, 2)} replica USDC, {num(p.devnet.sol, 3)} SOL</dd>
      </div>
    </dl>
  );
}

function Faucet({ position, soldOut, onDone }: { position: MarketPosition; soldOut: boolean; onDone: () => void }) {
  const toasts = useToasts();
  const [busy, setBusy] = useState(false);
  const [limited, setLimited] = useState<string | null>(null);
  const request = async () => {
    setBusy(true);
    try {
      const res = await post("/api/faucet", { owner: position.owner, market: position.symbol });
      const body = await res.json();
      if (res.ok) {
        toasts.push({ tone: "ok", title: `Sent 1 replica ${position.symbol}${body.sentSol > 0 ? " and 0.02 devnet SOL for fees" : ""}.`, href: body.explorer });
        onDone();
      } else if (res.status === 429 && body.retryAt) {
        setLimited(`${body.error} Try again at ${utcTime(body.retryAt)}.`);
      } else {
        toasts.push({ tone: "error", title: body.error ?? "The faucet couldn't send tokens right now." });
      }
    } catch {
      toasts.push({ tone: "error", title: "Couldn't reach the faucet. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Balances p={position} />
      <p className="text-base">
        {soldOut ? `Your last order sold all your replica ${position.symbol}. Get 1 more to set another order.` : `Get 1 replica ${position.symbol} to try an order.`} If your wallet is low on devnet SOL, we add 0.02 SOL for fees.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={request} disabled={busy || !!limited}>{busy ? "Sending..." : `Get replica ${position.symbol}`}</Button>
        {limited && <p className="text-sm text-deadline">{limited}</p>}
      </div>
    </div>
  );
}

function Ticket({ position, onDone }: { position: MarketPosition; onDone: () => void }) {
  const submit = useSubmit();
  const quote = position.devnet.quote?.outUsdc ?? null;
  const [mode, setMode] = useState<"price" | "arm">("price");
  const [amount, setAmount] = useState(() => num(position.devnet.tokens).replace(/,/g, ""));
  const [price, setPrice] = useState(() => (quote ? String(Math.floor(quote)) : ""));
  const [expiry, setExpiry] = useState(90);
  const [limit, setLimit] = useState(20);
  const [days, setDays] = useState(30);
  const [floor, setFloor] = useState(5000);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const tokens = Number(amount);
  const sizeRaw = Number.isFinite(tokens) ? BigInt(Math.floor(tokens * BASE)) : 0n;
  const usdPerToken = Number(price);
  const reason =
    !amount || !(tokens > 0) ? "Enter an amount"
    : sizeRaw > BigInt(position.devnet.tokensRaw) ? `Enter ${num(position.devnet.tokens)} or less`
    : mode === "price" && !(usdPerToken > 0) ? "Enter a price"
    : position.devnet.sol < 0.005 ? "Add a little devnet SOL for fees"
    : null;

  const sign = async () => {
    setBusy(true);
    const ok = mode === "price"
      ? await submit(() => post("/api/tx/price-order", { owner: position.owner, market: position.symbol, sizeRaw: sizeRaw.toString(), usdPerToken, expiryDays: expiry }),
        `Order set. It sells when the pool pays at least ${usd(usdPerToken)} per token.`)
      : await submit(() => post("/api/tx/arm", { owner: position.owner, market: position.symbol, sizeRaw: sizeRaw.toString(), limitBps: limit * 100, fallbackDaysBefore: days, floorBps: floor }),
        "Order armed. It activates when the issuer names a successor token.");
    setBusy(false);
    setConfirm(false);
    if (ok) onDone();
  };

  const tab = (m: "price" | "arm", label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
      className={`h-10 flex-1 rounded-full px-4 text-sm font-medium transition-colors duration-150 ${mode === m ? "bg-ink text-paper" : "text-ink hover:bg-hairline"}`}>{label}</button>
  );

  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 shadow-[var(--shadow-lift)] sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-2"><h2 className="text-lg">Order ticket</h2><NetBadge net="devnet" /></div>
      <div role="tablist" aria-label="Order type" className="mb-5 flex gap-1 rounded-full bg-vellum p-1">
        {tab("price", "Sell at your price")}
        {tab("arm", "Arm for the IPO")}
      </div>
      <p className="text-sm text-slate">
        You hold <span className="num text-ink">{num(position.devnet.tokens)}</span> replica {position.symbol} and <span className="num">{num(position.devnet.sol, 3)}</span> devnet SOL.
        {quote !== null && <> The devnet pool pays <span className="num text-ink">{usd(quote)}</span> per token right now, fees included.</>}
      </p>

      <form className="mt-5 flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (!reason) setConfirm(true); }}>
        <div>
          <label htmlFor="m-amount" className="text-sm">Amount</label>
          <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-input)] bg-vellum p-1.5 pl-4 focus-within:outline focus-within:outline-2 focus-within:outline-ink">
            <input id="m-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="num min-w-0 flex-1 bg-transparent py-2 text-lg outline-none" />
            <span className="text-sm text-slate">tokens</span>
            <button type="button" onClick={() => setAmount(num(position.devnet.tokens).replace(/,/g, ""))} className="h-11 rounded-full bg-paper px-4 text-sm font-medium hover:bg-hairline lg:pointer-fine:h-9 lg:pointer-fine:px-3">Max</button>
          </div>
        </div>

        {mode === "price" ? (
          <>
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <div>
                <label htmlFor="m-price" className="text-sm">Least USDC per token</label>
                <input id="m-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} className="num mt-2 w-full rounded-[var(--radius-input)] bg-vellum px-3 py-3 text-sm outline-none focus:outline-2 focus:outline-ink" />
              </div>
              <div>
                <label htmlFor="m-expiry" className="text-sm">Expires in</label>
                <select id="m-expiry" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} className="num mt-2 w-full rounded-[var(--radius-input)] bg-vellum px-3 py-3 text-sm outline-none focus:outline-2 focus:outline-ink">
                  {EXPIRIES.map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
              </div>
            </div>
            <div className="rounded-[14px] bg-vellum p-4 text-sm leading-relaxed">
              Sells when the pool pays at least <span className="num">{usd(usdPerToken || 0)}</span> per token, after fees. {quote !== null && usdPerToken > 0 && (usdPerToken <= quote ? "Today's pool price already meets it, so the keeper can fill on its next check." : `That is ${pct((usdPerToken / quote - 1) * 100)} above today's pool price.`)}
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="flex items-baseline justify-between">
                <label htmlFor="m-limit" className="text-sm">Largest gap you accept</label>
                <span className="num text-2xl">{limit}%</span>
              </div>
              <input id="m-limit" type="range" min={0} max={60} step={1} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="limit mt-3 w-full" />
            </div>
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <div>
                <label htmlFor="m-days" className="text-sm">Fallback, before the deadline</label>
                <select id="m-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="num mt-2 w-full rounded-[var(--radius-input)] bg-vellum px-3 py-3 text-sm outline-none focus:outline-2 focus:outline-ink">
                  {FALLBACK_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="m-floor" className="text-sm">Fallback floor, of entitlement</label>
                <select id="m-floor" value={floor} onChange={(e) => setFloor(Number(e.target.value))} className="num mt-2 w-full rounded-[var(--radius-input)] bg-vellum px-3 py-3 text-sm outline-none focus:outline-2 focus:outline-ink">
                  {FLOORS.map((f) => <option key={f} value={f}>{f / 100}%</option>)}
                </select>
              </div>
            </div>
            <div className="rounded-[14px] bg-vellum p-4 text-sm leading-relaxed">
              Nothing sells now. When the issuer names a successor token and a conversion amount, the keeper activates this order. It then fills at no less than {100 - limit}% of that amount, and from {days} days before the issuer&apos;s deadline at no less than {floor / 100}%. If no event is ever announced, it never fills.
            </div>
          </>
        )}

        <p className="text-xs leading-relaxed text-slate">
          Holdfill never holds your tokens. You approve the order program for this amount only and can revoke at any time. The issuer controls a transfer fee, a pause switch, and a permanent delegate on this token.
        </p>
        <Button type="submit" disabled={!!reason || busy} className="w-full">{reason ?? (busy ? "Waiting for your wallet..." : mode === "price" ? "Sign order" : "Arm order")}</Button>
        {reason === "Add a little devnet SOL for fees" && (
          <p className="text-xs text-slate">Get devnet SOL at <a className="text-ink underline underline-offset-4" href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a> for {shortAddr(position.owner)}.</p>
        )}
      </form>

      {confirm && (
        <Modal title={mode === "price" ? "Confirm price order" : "Confirm armed order"} onClose={() => !busy && setConfirm(false)}>
          <dl className="mt-2 flex flex-col gap-2 text-sm">
            <Line k="You approve" v={`${num(tokens)} replica ${position.symbol}`} />
            {mode === "price" ? (
              <>
                <Line k="Least per token" v={`${usd(usdPerToken)} USDC`} />
                <Line k="Least in total" v={`${usd(usdPerToken * tokens)} USDC`} />
                <Line k="Expires" v={`in ${expiry} days`} />
              </>
            ) : (
              <>
                <Line k="Largest gap" v={`${limit}%`} />
                <Line k="Fallback" v={`${days} days before the deadline, at ${floor / 100}%`} />
                <Line k="Activates" v="when the issuer names a successor" />
              </>
            )}
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-slate">Your wallet may preview this on mainnet and warn that it could fail. Holdfill sends it to devnet, where the replica tokens live.</p>
          <div className="mt-5 flex gap-2">
            <Button onClick={sign} disabled={busy} className="flex-1">{busy ? "Waiting for your wallet..." : "Sign in wallet"}</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Back</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OrderCard({ position, order, onChange, onEnded }: { position: MarketPosition; order: MarketOrder; onChange: () => void; onEnded: (how: "revoked" | "closed") => void }) {
  const submit = useSubmit();
  const toasts = useToasts();
  const [check, setCheck] = useState<{ tone: "wait" | "ok" | "error"; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const size = Number(order.sizeRaw) / BASE;
  const filled = Number(order.filledRaw) / BASE;
  const received = Number(order.receivedRaw) / 1e6;
  const isFilled = order.status === "filled";
  const armed = order.kind === "armed";
  const blocked = !isFilled && !order.approvalInPlace;
  const tone = isFilled ? "filled" : blocked ? "blocked" : filled > 0 ? "partial" : "armed";
  const label = isFilled ? "filled" : blocked ? "blocked" : armed ? "waiting for issuer" : filled > 0 ? "partial" : "armed";

  const runCheck = async () => {
    setChecking(true);
    try {
      const res = await post("/api/keeper/tick", { order: order.address });
      const body = await res.json();
      const at = utcTime(body.checkedAt ?? new Date().toISOString());
      if (res.status === 429) { setCheck({ tone: "wait", text: `Checked moments ago. Try again in ${Math.ceil((body.retryAfterMs ?? 5000) / 1000)} seconds.` }); return; }
      if (!res.ok) { setCheck({ tone: "error", text: "Couldn't reach the keeper. Try again in a moment." }); return; }
      const a = body.attempts?.[0];
      if (!a) { setCheck({ tone: "wait", text: armed ? `Checked ${at}. No issuer event yet.` : `Checked ${at}. Nothing to do.` }); return; }
      if (a.action === "filled") {
        toasts.push({ tone: "ok", title: `Filled. About ${num(Number(a.quotedOut ?? 0) / 1e6, 2)} USDC landed in your wallet.`, href: explorerTx(a.signature, "devnet") });
        setCheck({ tone: "ok", text: `Filled at ${at}.` });
        onChange();
      } else if (a.action === "waiting") {
        setCheck({ tone: "wait", text: `Checked ${at}. ${a.reason.charAt(0).toUpperCase()}${a.reason.slice(1)}. No fill yet.` });
      } else {
        setCheck({ tone: "error", text: `Checked ${at}. ${a.action === "skipped" ? a.reason : explainError(a.reason)}` });
      }
    } catch {
      setCheck({ tone: "error", text: "Couldn't reach the keeper. Try again in a moment." });
    } finally {
      setChecking(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    const ok = await submit(() => post("/api/tx/revoke", { owner: position.owner, market: position.symbol }),
      isFilled ? "Order closed. You can set a new one." : "Order revoked. The approval is removed and nothing else can fill.");
    setBusy(false);
    setConfirm(false);
    if (ok) { onEnded(isFilled ? "closed" : "revoked"); onChange(); }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 shadow-[var(--shadow-lift)] sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3"><h2 className="text-lg">Your {position.symbol} order</h2><Chip tone={tone}>{label}</Chip></div>
        <NetBadge net="devnet" />
      </div>

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Stat label={armed ? "Armed" : "Sold"} value={num(armed ? size : filled)} unit={armed ? "tokens" : `of ${num(size)} tokens`} />
        {armed ? (
          <>
            <Stat label="Largest gap" value={pct(order.limitBps / 100, 0)} unit="of the future entitlement" />
            <Stat label="Fallback" value={String(order.fallbackDaysBefore ?? 0)} unit="days before the deadline" />
            <Stat label="Floor" value={pct(order.fallbackFloorBps / 100, 0)} unit="of entitlement" />
          </>
        ) : (
          <>
            <Stat label="Received" value={num(received, 2)} unit="USDC" tone={received > 0 ? "text-fill" : undefined} />
            <Stat label="Least per token" value={order.minUsdcPerToken === null ? "n/a" : usd(order.minUsdcPerToken)} unit="USDC, after fees" />
            <Stat label="Expires" value={order.expiresAt ? day(order.expiresAt, true) : "n/a"} unit={order.expiresAt ? utcTime(order.expiresAt) : ""} />
          </>
        )}
      </dl>

      <div className="mt-5 min-h-6 text-sm" aria-live="polite">
        {isFilled ? (
          <p className="text-fill">Filled. You received {num(received, 2)} USDC, {usd(filled > 0 ? received / filled : 0)} per token after fees.</p>
        ) : blocked ? (
          <p className="text-deadline">Your approval was removed. Revoke to close the order.</p>
        ) : check ? (
          <p className={check.tone === "ok" ? "text-fill" : check.tone === "error" ? "text-deadline" : "text-ink"}>{check.text}</p>
        ) : armed ? (
          <p className="text-slate">Waiting for the issuer to name a successor token. The keeper activates this order on its first check after that, then fills at your terms.</p>
        ) : (
          <p className="text-slate">The keeper checks the devnet pool every 10 seconds. You can also check now.{position.devnet.quote && <> Today the pool pays {usd(position.devnet.quote.outUsdc)} per token.</>}</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {!isFilled && <Button variant="secondary" onClick={runCheck} disabled={checking}>{checking ? "Checking..." : "Check now"}</Button>}
        <Button variant={isFilled ? "secondary" : "danger"} onClick={() => setConfirm(true)} disabled={busy}>{isFilled ? "Close and set a new order" : "Revoke"}</Button>
      </div>
      <p className="mt-4 text-sm text-slate">One order per wallet for each token. {isFilled ? "Close this one" : "Revoke this one"} to set a new order.</p>
      <Source>Order <a className="tap underline underline-offset-4" href={`https://explorer.solana.com/address/${order.address}?cluster=devnet`} target="_blank" rel="noreferrer">{shortAddr(order.address)}</a> on devnet.</Source>

      {confirm && (
        <Modal title={isFilled ? "Close this order" : "Revoke this order"} onClose={() => !busy && setConfirm(false)}>
          <p className="text-sm text-slate">{isFilled ? "Closing returns the order account's small SOL deposit to you, so you can set a new order." : "Revoke closes the order and removes the approval in one transaction. Anything already sold stays in your wallet as USDC."}</p>
          <div className="mt-5 flex gap-2">
            <Button variant={isFilled ? "primary" : "danger"} onClick={revoke} disabled={busy} className="flex-1">{busy ? "Waiting for your wallet..." : isFilled ? "Close order" : "Revoke"}</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Keep order</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
