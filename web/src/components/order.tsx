"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import type { Position } from "@/server/position";
import type { OrderHistory, OrderEvent } from "@/server/orders";
import { backtest, type HistoryDay } from "@/server/backtest";
import { daysUntil, day, explainError, explorerTx, num, pct, shortAddr, usd, utcTime } from "@/lib/format";
import { GapBar, GapExplanation } from "./gap-bar";
import { Modal, WalletButton } from "./chrome";
import { useLimit, useMarket, useToasts } from "./providers";
import { Button, Chip, NetBadge, Source } from "./ui";

const BASE_PER_SHARE = 200_000_000; // 1 raw token = 1e9 base units = 5 shares
const sharesOf = (base: string | number) => Number(base) / BASE_PER_SHARE;
const spcxxOf = (base: string | number) => Number(base) / 1e8;
const DEADLINE = "2027-03-12T23:59:00Z";
const FLOORS = [4000, 5000, 6000, 7000];

// ---------- data hooks ----------

export function usePolling<T>(url: string | null, everyMs: number) {
  // Results are keyed by URL, so switching wallets never shows the previous wallet's data.
  const [state, setState] = useState<{ url: string; data: T | null; error: boolean } | null>(null);
  const refresh = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as T;
      setState({ url, data, error: false });
    } catch {
      setState((s) => ({ url, data: s?.url === url ? s.data : null, error: true }));
    }
  }, [url]);
  useEffect(() => {
    if (!url) return;
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, everyMs);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [url, everyMs, refresh]);
  const current = state && state.url === url ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? false, refresh };
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Build on the server, sign in the wallet, relay through the server, report each step in a toast. */
export function useSubmit() {
  const { signTransaction } = useWallet();
  const toasts = useToasts();
  return useCallback(async (build: () => Promise<Response>, done: string): Promise<boolean> => {
    const id = toasts.push({ tone: "info", title: "Preparing the transaction...", sticky: true });
    try {
      const res = await build();
      const built = await res.json();
      if (!res.ok) { toasts.update(id, { tone: "error", title: built.error ?? "Couldn't prepare the transaction.", sticky: false }); return false; }
      if (!signTransaction) { toasts.update(id, { tone: "error", title: "This wallet can't sign transactions.", body: "Connect Phantom, Solflare, or Backpack instead.", sticky: false }); return false; }
      toasts.update(id, { title: "Approve it in your wallet" });
      const signed = await signTransaction(Transaction.from(b64ToBytes(built.tx)));
      toasts.update(id, { title: "Sending to devnet..." });
      const sent = await fetch("/api/tx/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: signed.serialize().toString("base64") }) });
      const body = await sent.json();
      if (!sent.ok) { toasts.update(id, { tone: "error", title: body.error ?? "Devnet rejected the transaction.", body: explainError(body.code), sticky: false }); return false; }
      toasts.update(id, { tone: "ok", title: done, href: body.explorer, sticky: false });
      return true;
    } catch (e) {
      const err = e as Error;
      const cancelled = err.name === "WalletSignTransactionError" || /reject|cancel|denied/i.test(err.message);
      toasts.update(id, cancelled
        ? { tone: "error", title: "Signature cancelled. Nothing was sent.", sticky: false }
        : { tone: "error", title: "Your wallet couldn't sign this transaction.", body: "Nothing was sent. Try again, or disconnect and reconnect your wallet.", sticky: false });
      return false;
    }
  }, [signTransaction, toasts]);
}

// ---------- section ----------

export function OrderSection({ history }: { history: HistoryDay[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] [&>*]:min-w-0">
      <MarketCard />
      <PositionPanel history={history} />
    </div>
  );
}

function MarketCard() {
  const { data, error } = useMarket();
  const { limitBps } = useLimit();
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg">Market</h2>
        <NetBadge net="mainnet" />
      </div>
      {data ? (
        <>
          <GapBar entitlement={data.quote.value.entitlementSpcxx} market={data.quote.value.outSpcxx} limitBps={limitBps} />
          <GapExplanation entitlement={data.quote.value.entitlementSpcxx} limitBps={limitBps} />
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
            <Fact label="Pool mid gap" value={pct(data.midGapPct.value)} source="active bin price" />
            <Fact label="PreStocks mark" value={usd(data.prestocksMarkUsd.value)} source="per share" />
            <Fact label="SPCXx price" value={usd(data.spcxxUsd.value)} source="Jupiter price API" />
            <Fact label="Pool pays in USD" value={usd(data.marketUsdPerToken.value)} source="per token, quote x SPCXx" />
            <Fact label="Pool fee" value={pct(data.poolFeePct.value, 0)} source="Meteora DLMM" />
            <Fact label="Transfer fee" value={pct(data.transferFeeBps.value / 100, 2)} source="SPACEX mint, set by the issuer" />
          </dl>
          <Source>{error ? "Couldn't reach Solana. Showing the last values." : `Updated ${utcTime(data.asOf)}`}</Source>
        </>
      ) : (
        <p className="py-8 text-sm text-slate">Reading the live mainnet pool...</p>
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

function PositionPanel({ history }: { history: HistoryDay[] }) {
  const { publicKey, connected } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  const pos = usePolling<Position>(owner ? `/api/position?owner=${owner}` : null, 10_000);
  const orders = usePolling<OrderHistory>(owner ? `/api/orders?owner=${owner}` : null, 15_000);
  const [ended, setEnded] = useState<"revoked" | "closed" | null>(null);
  const refreshAll = useCallback(() => { pos.refresh(); orders.refresh(); }, [pos, orders]);

  const shell = (children: React.ReactNode, badge = true) => (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
      {badge && <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-lg">Your position</h2><NetBadge net="devnet" /></div>}
      {children}
    </div>
  );

  if (!connected || !owner) {
    return shell(
      <div className="flex min-h-64 flex-1 flex-col items-start justify-center gap-4">
        <p className="max-w-md text-lg">Connect a wallet to see your SPACEX and set an order on devnet.</p>
        <WalletButton id="order-connect" />
        <p className="text-sm text-slate">Works with Phantom, Solflare, and Backpack. Orders use devnet replica tokens, so nothing on mainnet moves.</p>
      </div>,
      false,
    );
  }

  const p = pos.data;
  if (!p) return shell(<p className="py-10 text-sm text-slate">{pos.error ? "Couldn't reach Solana. Retrying in 10 seconds." : "Reading your devnet wallet..."}</p>);

  const order = p.devnet.order;
  const events = orders.data?.events ?? [];
  const banner = ended && !order ? (
    <div className="mb-5 rounded-[14px] bg-vellum p-4 text-sm">{ended === "closed" ? "Order closed. Its SOL deposit is back in your wallet." : "Order revoked. The approval is removed and nothing else can fill."}</div>
  ) : null;

  if (order) {
    return (
      <div className="flex flex-col gap-6">
        <OrderCard position={p} order={order} onChange={refreshAll} onEnded={setEnded} />
        <Activity events={events} />
      </div>
    );
  }

  if (BigInt(p.devnet.replicaSpacex.raw) === 0n) {
    return (
      <div className="flex flex-col gap-6">
        {shell(<>{banner}<Faucet position={p} soldOut={events.some((e) => e.kind === "filled")} onDone={refreshAll} /></>)}
        {events.length > 0 && <Activity events={events} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {banner}
      <Ticket position={p} history={history} onDone={() => { setEnded(null); refreshAll(); }} />
      {events.length > 0 && <Activity events={events} />}
    </div>
  );
}

// ---------- states C and D ----------

function Faucet({ position, soldOut, onDone }: { position: Position; soldOut: boolean; onDone: () => void }) {
  const toasts = useToasts();
  const [busy, setBusy] = useState(false);
  const [limited, setLimited] = useState<string | null>(null);

  const request = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: position.owner }) });
      const body = await res.json();
      if (res.ok) {
        toasts.push({ tone: "ok", title: `Sent 1 replica SPACEX (5 shares)${body.sentSol > 0 ? " and 0.02 devnet SOL for fees" : ""}.`, href: body.explorer });
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
      <Balances position={position} />
      <p className="text-base">
        {soldOut ? "Your last order sold all your replica SPACEX. Get 1 more (5 shares) to set another order." : "Get 1 replica SPACEX (5 shares) to try an order."} If your wallet is low on devnet SOL, we add 0.02 SOL for fees.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={request} disabled={busy || !!limited}>{busy ? "Sending..." : "Get replica SPACEX"}</Button>
        {limited && <p className="text-sm text-deadline">{limited}</p>}
      </div>
    </div>
  );
}

function Balances({ position }: { position: Position }) {
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt className="text-xs uppercase tracking-[0.06em] text-slate">Mainnet SPACEX</dt>
        <dd className="num mt-1 text-lg">{num(position.mainnet.spacex.shares ?? 0)} shares</dd>
        <dd className="text-xs text-slate">read only</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-[0.06em] text-slate">Devnet replica SPACEX</dt>
        <dd className="num mt-1 text-lg">{num(position.devnet.replicaSpacex.shares ?? 0)} shares</dd>
        <dd className="num text-xs text-slate">{num(position.devnet.sol, 3)} devnet SOL</dd>
      </div>
    </dl>
  );
}

function Ticket({ position, history, onDone }: { position: Position; history: HistoryDay[]; onDone: () => void }) {
  const { limitBps, setLimitBps } = useLimit();
  const submit = useSubmit();
  const holdShares = position.devnet.replicaSpacex.shares ?? 0;
  const [amount, setAmount] = useState(() => num(holdShares).replace(/,/g, ""));
  const [fallback, setFallback] = useState("2027-03-01");
  const [floorBps, setFloorBps] = useState(5000);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const shares = Number(amount);
  const sizeRaw = Number.isFinite(shares) ? BigInt(Math.floor(shares * BASE_PER_SHARE)) : 0n;
  const fallbackTs = Math.floor(Date.parse(`${fallback}T00:00:00Z`) / 1000);
  const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
  const bt = useMemo(() => backtest(history, limitBps), [history, limitBps]);
  const gapToday = position.devnet.quote?.gapPct;

  const reason =
    !amount || !(shares > 0) ? "Enter an amount"
    : sizeRaw > BigInt(position.devnet.replicaSpacex.raw) ? `Enter ${num(holdShares)} shares or less`
    : !(fallbackTs > now / 1000) || fallback > "2027-03-11" ? "Pick a fallback date from tomorrow to 11 Mar 2027"
    : position.devnet.sol < 0.005 ? "Add a little devnet SOL for fees"
    : null;

  const minBefore = 1 - limitBps / 10_000;
  const minAfter = floorBps / 10_000;
  const fallbackLabel = day(`${fallback}T00:00:00Z`, true);

  const sign = async () => {
    setBusy(true);
    const ok = await submit(
      () => fetch("/api/tx/order", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: position.owner, sizeRaw: sizeRaw.toString(), limitBps, fallbackTs, floorBps }),
      }),
      `Order armed. Holdfill fills when the pool pays at least ${num(minBefore)} SPCXx per share.`,
    );
    setBusy(false);
    setConfirm(false);
    if (ok) onDone();
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 shadow-[var(--shadow-lift)] sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-2"><h2 className="text-lg">Order ticket</h2><NetBadge net="devnet" /></div>
      <p className="text-sm text-slate">You hold <span className="num text-ink">{num(holdShares)}</span> replica shares (<span className="num">{num(position.devnet.replicaSpacex.ui)}</span> raw) and <span className="num">{num(position.devnet.sol, 3)}</span> devnet SOL. Mainnet SPACEX, read only: <span className="num">{num(position.mainnet.spacex.shares ?? 0)}</span> shares.</p>
      {position.devnet.quote && (
        <div className="mt-4 mb-6">
          <GapBar entitlement={5} market={position.devnet.quote.outSpcxx} limitBps={limitBps} />
          <Source>Devnet pool quote for 1 raw token, fees included, {utcTime(position.devnet.quote.asOf)}. The devnet pool follows the mainnet price.</Source>
        </div>
      )}
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (!reason) setConfirm(true); }}>
        <div>
          <label htmlFor="ticket-amount" className="text-sm">Amount to convert</label>
          <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-input)] bg-vellum p-1.5 pl-4 focus-within:outline focus-within:outline-2 focus-within:outline-ink">
            <input id="ticket-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="num min-w-0 flex-1 bg-transparent py-2 text-lg outline-none" aria-describedby="amount-help" />
            <span className="text-sm text-slate">shares</span>
            <button type="button" onClick={() => setAmount(num(holdShares).replace(/,/g, ""))} className="h-11 rounded-full bg-paper px-4 text-sm font-medium hover:bg-hairline lg:pointer-fine:h-9 lg:pointer-fine:px-3">Max</button>
          </div>
          <p id="amount-help" className="num mt-1.5 text-xs text-slate">= {num(Number(sizeRaw) / 1e9)} raw tokens, you hold {num(holdShares)} shares</p>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="ticket-limit" className="text-sm">Largest gap you accept</label>
            <span className="num text-2xl">{pct(limitBps / 100, 0)}</span>
          </div>
          <input id="ticket-limit" type="range" min={0} max={60} step={1} value={limitBps / 100} onChange={(e) => setLimitBps(Number(e.target.value) * 100)} className="limit mt-3 w-full" aria-describedby="limit-help" />
          <p id="limit-help" className="mt-2 text-xs leading-relaxed text-slate">
            A {pct(limitBps / 100, 0)} limit means at least {num(minBefore)} SPCXx per share before your fallback date. The gap is how far the pool payout falls below the issuer&apos;s conversion amount.{" "}
            {gapToday !== undefined && <>Today the devnet pool pays {pct(gapToday)} under. </>}
            {bt.fillDays > 0
              ? <>On mainnet, this limit would have filled on <span className="num text-ink">{bt.fillDays} of {bt.tradingDays}</span> trading days since listing, first on {day(bt.firstFill!.date)}.</>
              : <>On mainnet, the daily close never came this close in the <span className="num">{bt.tradingDays}</span> trading days since listing. A wider limit fills sooner.</>}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
          <div>
            <label htmlFor="ticket-fallback" className="text-sm">Fallback date</label>
            <input id="ticket-fallback" type="date" min={tomorrow} max="2027-03-11" value={fallback} onChange={(e) => setFallback(e.target.value)} className="num mt-2 w-full rounded-[var(--radius-input)] bg-vellum px-3 py-3 text-sm outline-none focus:outline-2 focus:outline-ink" />
          </div>
          <div>
            <label htmlFor="ticket-floor" className="text-sm">Fallback floor, of entitlement</label>
            <select id="ticket-floor" value={floorBps} onChange={(e) => setFloorBps(Number(e.target.value))} className="num mt-2 w-full rounded-[var(--radius-input)] bg-vellum px-3 py-3 text-sm outline-none focus:outline-2 focus:outline-ink">
              {FLOORS.map((f) => <option key={f} value={f}>{f / 100}%</option>)}
            </select>
          </div>
        </div>

        <div className="rounded-[14px] bg-vellum p-4 text-sm leading-relaxed">
          You get at least <span className="num">{num(minBefore)}</span> SPCXx per share before {fallbackLabel}, and at least <span className="num">{num(minAfter)}</span> after. Nothing converts after 12 Mar 2027.
        </div>

        <p className="text-xs leading-relaxed text-slate">
          Holdfill never holds your tokens. You approve the order program for this amount only and can revoke at any time. The issuer controls a transfer fee, a pause switch, and a permanent delegate on this token.
        </p>

        <Button type="submit" disabled={!!reason || busy} className="w-full">{reason ?? (busy ? "Waiting for your wallet..." : "Sign order")}</Button>
        {reason === "Add a little devnet SOL for fees" && (
          <p className="text-xs text-slate">Get devnet SOL at <a className="text-ink underline underline-offset-4" href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a> for {shortAddr(position.owner)}.</p>
        )}
      </form>

      {confirm && (
        <Modal title="Confirm order" onClose={() => !busy && setConfirm(false)}>
          <dl className="mt-2 flex flex-col gap-2 text-sm">
            <Line k="You approve" v={`${num(shares)} shares (${num(Number(sizeRaw) / 1e9)} raw)`} />
            <Line k="Largest gap" v={pct(limitBps / 100, 0)} />
            <Line k="Minimum before fallback" v={`${num(minBefore)} SPCXx per share`} />
            <Line k={`Minimum from ${fallbackLabel}`} v={`${num(minAfter)} SPCXx per share`} />
            <Line k="Deadline" v="12 Mar 2027 23:59 UTC" />
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

export function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4 border-b border-hairline pb-2"><dt className="text-slate">{k}</dt><dd className="num text-right">{v}</dd></div>;
}

// ---------- states E to G ----------

type Check = { tone: "wait" | "ok" | "blocked" | "error"; text: string };

function OrderCard({ position, order, onChange, onEnded }: { position: Position; order: NonNullable<Position["devnet"]["order"]>; onChange: () => void; onEnded: (how: "revoked" | "closed") => void }) {
  const submit = useSubmit();
  const toasts = useToasts();
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const size = sharesOf(order.sizeRaw);
  const filled = sharesOf(order.filledRaw);
  const received = spcxxOf(order.receivedRaw);
  const isFilled = order.status === "filled";
  const deadlinePassed = now >= Date.parse(order.deadline);
  const blockedText =
    deadlinePassed ? "The issuer deadline passed. This order can no longer fill."
    : !isFilled && !order.approvalInPlace ? "Your approval was removed. Revoke to close the order."
    : check?.tone === "blocked" ? check.text : null;
  const tone = isFilled ? "filled" : blockedText ? "blocked" : filled > 0 ? "partial" : "armed";
  const quote = position.devnet.quote;
  const realized = filled > 0 ? (1 - received / filled) * 100 : null;

  const runCheck = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/keeper/tick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: order.address }) });
      const body = await res.json();
      const at = utcTime(body.checkedAt ?? new Date().toISOString());
      if (res.status === 429) { setCheck({ tone: "wait", text: `Checked moments ago. Try again in ${Math.ceil((body.retryAfterMs ?? 5000) / 1000)} seconds.` }); return; }
      if (!res.ok) { setCheck({ tone: "error", text: "Couldn't reach the keeper. Try again in a moment." }); return; }
      const a = body.attempts?.[0];
      if (!a) { setCheck({ tone: "wait", text: `Checked ${at}. No active order at this address.` }); return; }
      if (a.action === "filled") {
        toasts.push({ tone: "ok", title: `Filled. ${num(spcxxOf(a.quotedOut ?? 0))} SPCXx landed in your wallet.`, href: explorerTx(a.signature, "devnet") });
        setCheck({ tone: "ok", text: `Filled at ${at}.` });
        onChange();
      } else if (a.action === "waiting") {
        const gap = a.quotedOut && a.amountIn ? (1 - Number(a.quotedOut) / (Number(a.amountIn) / 2)) * 100 : undefined;
        setCheck({ tone: "wait", text: `Checked ${at}. Pool pays ${gap !== undefined ? pct(gap) : "more than your limit"} under entitlement. Your limit is ${pct(a.haircutBps / 100, 0)}. No fill yet.` });
      } else if (a.action === "skipped") {
        const r = String(a.reason);
        const text = r.includes("paused") ? "The issuer paused this token. Your order can't fill until it resumes."
          : r.includes("transfer fee") ? `The issuer changed the transfer fee since you signed (${r.replace(/.*from /, "from ")}). Revoke and create a new order to accept it.`
          : r.includes("approval") ? "Your approval was removed. Revoke to close the order."
          : r.includes("deadline") ? "The issuer deadline passed. This order can no longer fill."
          : r.includes("output token account") ? "Your SPCXx account is missing. Revoke and set the order again to recreate it."
          : `Checked ${at}. ${r}.`;
        setCheck({ tone: "blocked", text });
      } else {
        setCheck({ tone: "error", text: `Checked ${at}. ${explainError(a.reason)}` });
      }
    } catch {
      setCheck({ tone: "error", text: "Couldn't reach the keeper. Try again in a moment." });
    } finally {
      setChecking(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    const ok = await submit(
      () => fetch("/api/tx/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: position.owner }) }),
      isFilled ? "Order closed. You can set a new one." : "Order revoked. The approval is removed and nothing else can fill.",
    );
    setBusy(false);
    setConfirm(false);
    if (ok) { onEnded(isFilled ? "closed" : "revoked"); onChange(); }
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 shadow-[var(--shadow-lift)] sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3"><h2 className="text-lg">Your order</h2><Chip tone={tone}>{tone}</Chip></div>
        <NetBadge net="devnet" />
      </div>

      {quote && <GapBar entitlement={5} market={isFilled ? 5 * (1 - (realized ?? 0) / 100) : quote.outSpcxx} limitBps={order.haircutNowBps} filled={isFilled} />}

      <dl className="mt-2 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Stat label="Filled" value={num(filled)} unit={`of ${num(size)} shares`} />
        <Stat label="Received" value={num(received)} unit="SPCXx" tone={received > 0 ? "text-fill" : undefined} />
        {isFilled ? (
          <>
            <Stat label="Realized gap" value={pct(realized ?? 0)} unit="fees included" />
            <Stat label="Limit was" value={pct(order.limitBps / 100, 0)} unit="largest gap accepted" />
          </>
        ) : (
          <>
            <Stat label="Minimum now" value={num(order.minSpcxxPerShareNow)} unit="SPCXx per share" />
            <Stat label="Fallback in" value={String(daysUntil(order.fallbackAt, now))} unit={`days, then ${pct(order.fallbackFloorBps / 100, 0)} floor`} />
          </>
        )}
      </dl>

      <div className="mt-5 min-h-6 text-sm" aria-live="polite">
        {isFilled ? (
          <p className="text-fill">Filled. You received {num(received)} SPCXx. Realized gap {pct(realized ?? 0)} including the 1% issuer transfer fee.</p>
        ) : blockedText ? (
          <p className="text-deadline">{blockedText}</p>
        ) : check ? (
          <p className={check.tone === "ok" ? "text-fill" : check.tone === "error" ? "text-deadline" : "text-ink"}>{check.text}</p>
        ) : tone === "partial" ? (
          <p>Filled {num(filled)} / {num(size)} shares. Waiting for liquidity at your limit.</p>
        ) : (
          <p className="text-slate">Armed. The keeper checks the devnet pool every 10 seconds. You can also check now.</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {!isFilled && <Button variant="secondary" onClick={runCheck} disabled={checking || deadlinePassed}>{checking ? "Checking the pool..." : "Check now"}</Button>}
        <Button variant={isFilled ? "secondary" : "danger"} onClick={() => setConfirm(true)} disabled={busy}>{isFilled ? "Close and set a new order" : "Revoke"}</Button>
      </div>
      <p className="mt-4 text-sm text-slate">One order per wallet. {isFilled ? "Close this one" : "Revoke this one"} to set a new order.</p>
      <Source>Order <a className="tap underline underline-offset-4" href={`https://explorer.solana.com/address/${order.address}?cluster=devnet`} target="_blank" rel="noreferrer">{shortAddr(order.address)}</a>, deadline {day(DEADLINE, true)} 23:59 UTC.</Source>

      {confirm && (
        <Modal title={isFilled ? "Close this order" : "Revoke this order"} onClose={() => !busy && setConfirm(false)}>
          <p className="text-sm text-slate">{isFilled ? "Closing returns the order account's small SOL deposit to you, so you can set a new order." : "Revoke closes the order and removes the approval in one transaction. Anything already filled stays in your wallet."}</p>
          <div className="mt-5 flex gap-2">
            <Button variant={isFilled ? "primary" : "danger"} onClick={revoke} disabled={busy} className="flex-1">{busy ? "Waiting for your wallet..." : isFilled ? "Close order" : "Revoke"}</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Keep order</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Stat({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.06em] text-slate">{label}</dt>
      <dd className={`num mt-1 whitespace-nowrap text-lg ${tone ?? "text-ink"}`}>{value}</dd>
      <dd className="text-xs text-slate">{unit}</dd>
    </div>
  );
}

// ---------- activity ----------

export function Activity({ events, describe = describeSpacex }: { events: OrderEvent[]; describe?: (e: OrderEvent) => string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-paper p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg">Activity</h2><NetBadge net="devnet" /></div>
      {events.length === 0 ? (
        <p className="text-sm text-slate">No activity yet. The keeper&apos;s first check runs within 10 seconds of signing.</p>
      ) : (
        <ul className="divide-y divide-hairline text-sm">
          {events.map((e, i) => (
            <li key={`${e.signature}-${i}`} className="grid grid-cols-[4.5rem_5.5rem_1fr_auto] items-baseline gap-3 py-2.5 max-sm:grid-cols-[4rem_1fr_auto]">
              <span className="num text-slate">{utcTime(e.time).replace(" UTC", "")}</span>
              <span className={e.kind === "filled" ? "text-fill" : e.kind === "rejected" ? "text-deadline" : "text-ink"}>{EVENT_LABEL[e.kind]}</span>
              <span className="num text-slate max-sm:col-span-3 max-sm:row-start-2 max-sm:-mt-1">{describe(e)}</span>
              <a className="tap mono text-ink underline underline-offset-4 max-sm:col-start-3 max-sm:row-start-1" href={explorerTx(e.signature, "devnet")} target="_blank" rel="noreferrer">{shortAddr(e.signature)}</a>
            </li>
          ))}
        </ul>
      )}
      <Source>Times in UTC. Signatures open on Solana Explorer (devnet).</Source>
    </div>
  );
}

const EVENT_LABEL: Record<OrderEvent["kind"], string> = { created: "Created", filled: "Filled", cancelled: "Closed", rejected: "Rejected", armed: "Armed", activated: "Activated" };

function describeSpacex(e: OrderEvent): string {
  if (e.kind === "created") return `${num(sharesOf(e.sizeRaw ?? 0))} shares, limit ${pct((e.limitBps ?? 0) / 100, 0)}`;
  if (e.kind === "filled") return `${num(sharesOf(e.amountInRaw ?? 0))} shares for ${num(spcxxOf(e.amountOutRaw ?? 0))} SPCXx, ${pct(e.gapPct ?? 0)} gap`;
  if (e.kind === "cancelled") return Number(e.amountInRaw ?? 0) > 0 ? `closed after filling ${num(sharesOf(e.amountInRaw ?? 0))} shares` : "revoked before any fill";
  return explainError(e.error);
}
