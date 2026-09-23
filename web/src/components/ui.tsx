import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function NetBadge({ net }: { net: "mainnet" | "devnet" }) {
  return net === "mainnet" ? (
    <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-vellum px-2.5 text-xs uppercase tracking-[0.06em] text-ink">Live mainnet</span>
  ) : (
    <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-cream px-2.5 text-xs uppercase tracking-[0.06em] text-hold">Devnet replica</span>
  );
}

const variants = {
  primary: "bg-ink text-paper hover:bg-black disabled:bg-[#bdbdbd]",
  secondary: "bg-vellum text-ink hover:bg-hairline disabled:text-slate",
  danger: "bg-vellum text-deadline hover:bg-[#f7e3dc] disabled:text-slate",
  light: "bg-paper text-ink hover:bg-vellum",
} as const;

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      {...rest}
      className={`inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-[15px] font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Same look as Button, for links. Internal routes use client-side navigation. */
export function ButtonLink({ variant = "primary", className = "", children, href = "", ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: keyof typeof variants }) {
  const cls = `inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-[15px] font-medium transition-colors duration-150 ease-out ${variants[variant]} ${className}`;
  return href.startsWith("/") ? (
    <Link href={href} {...rest} className={cls}>{children}</Link>
  ) : (
    <a href={href} {...rest} className={cls}>{children}</a>
  );
}

/** Hairline divider with a centered gray label, then an optional big heading. */
export function SectionHead({ label, title, muted, intro, level = 2 }: { label: string; title?: string; muted?: string; intro?: ReactNode; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="mb-10 md:mb-14">
      <div className="flex items-center gap-4 text-sm text-slate">
        <span className="h-px flex-1 bg-hairline" />
        <span>{label}</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>
      {title && (
        <Heading className="mt-10 max-w-3xl text-4xl leading-[1.1] tracking-[-0.02em] md:text-5xl">
          {title}
          {muted && <span className="block text-slate">{muted}</span>}
        </Heading>
      )}
      {intro && <div className="mt-5 max-w-2xl text-base leading-relaxed text-slate">{intro}</div>}
    </div>
  );
}

export type ChipTone = "armed" | "filled" | "partial" | "blocked" | "revoked";

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  const cls = {
    armed: "bg-cream text-hold",
    filled: "bg-fill text-paper",
    partial: "border border-fill text-fill",
    blocked: "bg-[#f7e3dc] text-deadline",
    revoked: "bg-vellum text-revoked",
  }[tone];
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium uppercase tracking-[0.06em] ${cls}`}>{children}</span>;
}

export function Source({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs leading-relaxed text-slate">{children}</p>;
}
