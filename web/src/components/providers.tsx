"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { Market } from "@/server/market";

// ---------- Live mainnet market (polled, last good value kept) ----------

type MarketState = { data: Market | null; error: boolean; refresh: () => void };
const MarketCtx = createContext<MarketState>({ data: null, error: false, refresh: () => {} });
const MARKET_KEY = "holdfill:market";

function MarketProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Market | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/market", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as Market;
      setData(next);
      setError(false);
      try { localStorage.setItem(MARKET_KEY, JSON.stringify(next)); } catch {}
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    // First paint: the last good values with their own timestamp, never zeros.
    try {
      const saved = localStorage.getItem(MARKET_KEY);
      // Reading storage has to wait for mount (the server has none); one extra render is the point.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setData((d) => d ?? (JSON.parse(saved) as Market));
    } catch {}
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  return <MarketCtx.Provider value={{ data, error, refresh }}>{children}</MarketCtx.Provider>;
}

export const useMarket = () => useContext(MarketCtx);

// ---------- Connect intent: only a connection the viewer asked for sends them to /order ----------

type IntentApi = { markConnectIntent: () => void; consumeConnectIntent: () => boolean };
const IntentCtx = createContext<IntentApi>({ markConnectIntent: () => {}, consumeConnectIntent: () => false });
const INTENT_WINDOW_MS = 120_000;

function IntentProvider({ children }: { children: ReactNode }) {
  // A wallet that reconnects on its own after a refresh leaves this empty, so it never redirects.
  const at = useRef(0);
  const api = useMemo(() => ({
    markConnectIntent: () => { at.current = Date.now(); },
    consumeConnectIntent: () => { const fresh = Date.now() - at.current < INTENT_WINDOW_MS; at.current = 0; return fresh; },
  }), []);
  return <IntentCtx.Provider value={api}>{children}</IntentCtx.Provider>;
}

export const useConnectIntent = () => useContext(IntentCtx);

// ---------- The viewer's limit, shared by hero, ticket, and chart ----------

type LimitState = { limitBps: number; setLimitBps: (bps: number) => void };
const LimitCtx = createContext<LimitState>({ limitBps: 2000, setLimitBps: () => {} });

function LimitProvider({ children }: { children: ReactNode }) {
  const [limitBps, setLimitBps] = useState(2000);
  return <LimitCtx.Provider value={{ limitBps, setLimitBps }}>{children}</LimitCtx.Provider>;
}

export const useLimit = () => useContext(LimitCtx);

// ---------- Toasts for transaction progress ----------

export type Toast = { id: number; tone: "info" | "ok" | "error"; title: string; body?: string; href?: string; sticky?: boolean };
type ToastApi = { push: (t: Omit<Toast, "id">) => number; update: (id: number, t: Partial<Toast>) => void; dismiss: (id: number) => void };
const ToastCtx = createContext<ToastApi>({ push: () => 0, update: () => {}, dismiss: () => {} });

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const schedule = useCallback((t: Toast) => {
    if (!t.sticky) setTimeout(() => dismiss(t.id), t.tone === "error" ? 9000 : 6000);
  }, [dismiss]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const toast = { ...t, id: next.current++ };
    setToasts((all) => [...all.slice(-2), toast]);
    schedule(toast);
    return toast.id;
  }, [schedule]);
  const update = useCallback((id: number, patch: Partial<Toast>) => {
    setToasts((all) => all.map((t) => {
      if (t.id !== id) return t;
      const merged = { ...t, ...patch };
      if (t.sticky && patch.sticky === false) schedule(merged);
      return merged;
    }));
  }, [schedule]);
  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div aria-live="polite" className="fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="animate-rise w-full max-w-sm rounded-[var(--radius-card)] border border-hairline bg-paper p-4 shadow-[var(--shadow-lift)]">
            <div className="flex items-start gap-3">
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${t.tone === "ok" ? "bg-fill" : t.tone === "error" ? "bg-deadline" : "bg-hold"}`} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-ink">{t.title}</p>
                {t.body && <p className="mt-1 text-slate">{t.body}</p>}
                {t.href && <a href={t.href} target="_blank" rel="noreferrer" className="tap mt-1 text-ink underline underline-offset-4">View transaction</a>}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate hover:bg-vellum">×</button>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToasts = () => useContext(ToastCtx);

// ---------- Root ----------

// The wallet only signs. Transactions are built and relayed by the server, so this endpoint is only
// used by the adapter itself.
const DEVNET_RPC = "https://api.devnet.solana.com";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={[]} autoConnect>
        <MarketProvider>
          <LimitProvider>
            <IntentProvider>
              <ToastProvider>{children}</ToastProvider>
            </IntentProvider>
          </LimitProvider>
        </MarketProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
