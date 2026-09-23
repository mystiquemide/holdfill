import type { ReactNode } from "react";
import { BackHome } from "./chrome";
import { SectionHead } from "./ui";

/** Shell for reading pages: docs, terms, privacy. */
export function DocPage({ label, title, intro, updated, children }: { label: string; title: string; intro: ReactNode; updated?: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-8 pb-24 md:px-6">
      <div className="mb-10"><BackHome /></div>
      <SectionHead level={1} label={label} title={title} intro={intro} />
      {updated && <p className="-mt-6 mb-10 text-sm text-slate">Last updated {updated}</p>}
      <div className="flex max-w-3xl flex-col gap-10">{children}</div>
    </section>
  );
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-2xl tracking-[-0.01em]">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-slate [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** Two-column term list: name on the left, meaning on the right. */
export function Terms({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-hairline rounded-[var(--radius-card)] border border-hairline bg-paper">
      {items.map(([term, meaning]) => (
        <div key={term} className="grid gap-1 p-4 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-ink">{term}</dt>
          <dd className="text-sm leading-relaxed text-slate">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}
