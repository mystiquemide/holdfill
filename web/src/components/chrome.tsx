"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { shortAddr } from "@/lib/format";
import { useConnectIntent } from "./providers";
import { Button } from "./ui";
import { Logo } from "./logo";

const NAV = [
  { href: "/order", label: "Your order" },
  { href: "/evidence", label: "Evidence" },
  { href: "/proof", label: "Proof" },
];

// "How it works" is a section of the landing page. It scrolls there without putting a # in the URL.
let pendingSection: string | null = null;

export function HowItWorksLink({ className = "", onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <Link
      href="/"
      className={className}
      onClick={(e) => {
        onNavigate?.();
        if (pathname === "/") {
          e.preventDefault();
          document.getElementById("how")?.scrollIntoView({ behavior: "smooth" });
          return;
        }
        e.preventDefault();
        pendingSection = "how";
        router.push("/");
      }}
    >
      How it works
    </Link>
  );
}

/** On the landing page, finishes a "How it works" click that started on another page. */
export function PendingSectionScroll() {
  useEffect(() => {
    if (!pendingSection) return;
    const id = pendingSection;
    pendingSection = null;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }));
  }, []);
  return null;
}

const KNOWN_WALLETS = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/downloads" },
];

/** The footer belongs to the landing page only; the product pages end with their own content. */
export function LandingOnly({ children }: { children: React.ReactNode }) {
  return usePathname() === "/" ? <>{children}</> : null;
}

/** Link back to the landing page, at the top of /order, /evidence, and /proof. */
export function BackHome() {
  return (
    <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-full bg-vellum px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-hairline">
      <span aria-hidden>←</span> Back to home
    </Link>
  );
}

/** "O" opens the order page (or focuses the ticket when already there), unless the viewer is typing. */
function useOrderShortcut(pathname: string, go: (href: string) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "o" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName))) return;
      e.preventDefault();
      if (pathname !== "/order") { go("/order"); return; }
      (document.getElementById("ticket-amount") ?? document.getElementById("order-connect"))?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, go]);
}

/**
 * After a connection the viewer started from the wallet picker, open the order page. After a
 * disconnect while on the order page, go home. Automatic reconnects on load never redirect.
 */
function useWalletRedirects(pathname: string, go: (href: string) => void) {
  const { connected } = useWallet();
  const { consumeConnectIntent } = useConnectIntent();
  const was = useRef(connected);
  useEffect(() => {
    if (connected && consumeConnectIntent() && pathname !== "/order") go("/order");
    if (was.current && !connected && pathname === "/order") go("/");
    was.current = connected;
  }, [connected, consumeConnectIntent, pathname, go]);
}

export function Header() {
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const go = useCallback((href: string) => router.push(href), [router]);
  useOrderShortcut(pathname, go);
  useWalletRedirects(pathname, go);
  const isActive = (href: string) => pathname === href;

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">Skip to content</a>
      <div className="bg-cream">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-[13px] text-ink sm:text-sm">
          <span>Orders run on devnet replicas. Market data is live mainnet.</span>
          <Link href="/proof" className="inline-flex h-7 items-center rounded-full bg-ink px-3 text-xs font-medium text-paper hover:bg-black">See the proof</Link>
        </div>
      </div>
      <header className="sticky top-0 z-40">
        <nav className="border-b border-hairline bg-paper" aria-label="Main">
          <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 md:px-6">
            <Link href="/" aria-label="Holdfill home"><Logo /></Link>
            <ul className="hidden items-center gap-6 text-sm lg:flex">
              <li><HowItWorksLink className="inline-block py-3 text-ink underline-offset-8 hover:underline" /></li>
              {NAV.map((n) => (
                <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={`inline-block py-3 underline-offset-8 hover:underline ${isActive(n.href) ? "text-ink underline decoration-hold decoration-2" : "text-ink"}`}
                >
                  {n.label}
                </Link>
              </li>
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
                <li><HowItWorksLink onNavigate={() => setMenu(false)} className="block rounded-[14px] px-3 py-3 text-base text-ink hover:bg-vellum" /></li>
                {NAV.map((n) => (
                  <li key={n.href}>
                    <Link
                    href={n.href}
                    onClick={() => setMenu(false)}
                    aria-current={isActive(n.href) ? "page" : undefined}
                    className={`block rounded-[14px] px-3 py-3 text-base text-ink hover:bg-vellum ${isActive(n.href) ? "bg-vellum" : ""}`}
                  >
                    {n.label}
                  </Link>
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
  const { markConnectIntent } = useConnectIntent();
  const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const missing = KNOWN_WALLETS.filter((k) => !detected.some((w) => w.adapter.name === k.name));

  return (
    <Modal title="Connect a wallet" onClose={onClose}>
      <p className="text-sm text-slate">Holdfill asks your wallet to sign. It never sees your keys, and orders run on devnet.</p>
      <ul className="mt-5 flex flex-col gap-2">
        {detected.map((w) => (
          <li key={w.adapter.name}>
            <button
              onClick={() => { markConnectIntent(); select(w.adapter.name as WalletName); onClose(); }}
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
