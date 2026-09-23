"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { shortAddr } from "@/lib/format";
import { Button } from "./ui";
import { Logo } from "./logo";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#order", label: "Your order" },
  { href: "#evidence", label: "Evidence" },
  { href: "#proof", label: "Proof" },
];

const KNOWN_WALLETS = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/downloads" },
];

/** "O" jumps to the order ticket, unless the viewer is typing somewhere. */
function useOrderShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "o" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName))) return;
      e.preventDefault();
      document.getElementById("order")?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => (document.getElementById("ticket-amount") ?? document.getElementById("order-connect"))?.focus({ preventScroll: true }), 450);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function Header() {
  const [menu, setMenu] = useState(false);
  useOrderShortcut();

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">Skip to content</a>
      <div className="bg-cream">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-[13px] text-ink sm:text-sm">
          <span>Orders run on devnet replicas. Market data is live mainnet.</span>
          <a href="#proof" className="inline-flex h-7 items-center rounded-full bg-ink px-3 text-xs font-medium text-paper hover:bg-black">See the proof</a>
        </div>
      </div>
      <header className="sticky top-0 z-40">
        <nav className="border-b border-hairline bg-paper" aria-label="Main">
          <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 md:px-6">
            <a href="#top" aria-label="Holdfill, back to top"><Logo /></a>
            <ul className="hidden items-center gap-6 text-sm lg:flex">
              {NAV.map((n) => (
                <li key={n.href}><a href={n.href} className="inline-block py-3 text-ink underline-offset-4 hover:underline">{n.label}</a></li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <WalletButton />
              <button
                className="inline-flex size-11 items-center justify-center rounded-full bg-vellum lg:hidden"
                aria-expanded={menu}
                aria-controls="mobile-menu"
                aria-label={menu ? "Close menu" : "Open menu"}
                onClick={() => setMenu((m) => !m)}
              >
                <span aria-hidden className="text-lg leading-none">{menu ? "×" : "≡"}</span>
              </button>
            </div>
          </div>
          {menu && (
            <div id="mobile-menu" className="border-t border-hairline bg-paper px-4 py-3 lg:hidden">
              <ul className="flex flex-col">
                {NAV.map((n) => (
                  <li key={n.href}>
                    <a href={n.href} onClick={() => setMenu(false)} className="block rounded-[14px] px-3 py-3 text-base text-ink hover:bg-vellum">{n.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>
      </header>
    </>
  );
}

export function WalletButton({ id, block }: { id?: string; block?: boolean }) {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (connected && publicKey) {
    const addr = publicKey.toBase58();
    return (
      <div className="relative" ref={ref}>
        <Button variant="secondary" onClick={() => setMenu((m) => !m)} aria-expanded={menu} className={block ? "w-full" : ""}>
          <span className="mono text-sm">{shortAddr(addr)}</span>
        </Button>
        {menu && (
          <div className="absolute right-0 mt-2 w-56 rounded-[var(--radius-card)] border border-hairline bg-paper p-2 shadow-[var(--shadow-lift)]">
            <button
              className="w-full rounded-[14px] px-3 py-2.5 text-left text-sm hover:bg-vellum"
              onClick={async () => {
                try { await navigator.clipboard.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
              }}
            >
              {copied ? "Address copied" : "Copy address"}
            </button>
            <button className="w-full rounded-[14px] px-3 py-2.5 text-left text-sm text-deadline hover:bg-vellum" onClick={() => { setMenu(false); disconnect(); }}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Button id={id} onClick={() => setOpen(true)} disabled={connecting} className={block ? "w-full" : ""}>
        {connecting ? "Connecting..." : "Connect wallet"}
      </Button>
      {open && <WalletPicker onClose={() => setOpen(false)} />}
    </>
  );
}

function WalletPicker({ onClose }: { onClose: () => void }) {
  const { wallets, select } = useWallet();
  const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const missing = KNOWN_WALLETS.filter((k) => !detected.some((w) => w.adapter.name === k.name));

  return (
    <Modal title="Connect a wallet" onClose={onClose}>
      <p className="text-sm text-slate">Holdfill asks your wallet to sign. It never sees your keys, and orders run on devnet.</p>
      <ul className="mt-5 flex flex-col gap-2">
        {detected.map((w) => (
          <li key={w.adapter.name}>
            <button
              onClick={() => { select(w.adapter.name as WalletName); onClose(); }}
              className="flex w-full items-center gap-3 rounded-[14px] bg-vellum px-4 py-3 text-left hover:bg-hairline"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.adapter.icon} alt="" width={28} height={28} className="rounded-lg" />
              <span className="flex-1">{w.adapter.name}</span>
              <span className="text-xs text-fill">Detected</span>
            </button>
          </li>
        ))}
        {missing.map((k) => (
          <li key={k.name}>
            <a href={k.url} target="_blank" rel="noreferrer" className="flex w-full items-center gap-3 rounded-[14px] border border-hairline px-4 py-3 hover:bg-vellum">
              <span className="flex-1">{k.name}</span>
              <span className="text-xs text-slate underline underline-offset-4">Install</span>
            </a>
          </li>
        ))}
      </ul>
      {detected.length === 0 && <p className="mt-4 text-sm text-slate">No Solana wallet found in this browser. Install one above, then reload this page.</p>}
    </Modal>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("button, a, input, select")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="animate-rise w-full max-w-md rounded-[var(--radius-card-lg)] bg-paper p-6 shadow-[var(--shadow-lift)]">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-2xl tracking-[-0.01em]">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="inline-flex size-9 items-center justify-center rounded-full bg-vellum text-lg hover:bg-hairline">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
