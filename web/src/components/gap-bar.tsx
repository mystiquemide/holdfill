import { num, pct, usd } from "@/lib/format";

type Props = {
  /** SPCXx one raw token converts into (5). */
  entitlement: number;
  /** SPCXx the pool pays for one raw token right now. */
  market: number;
  limitBps: number;
  entitlementUsd?: number;
  deadline?: { label: string; daysLeft: number };
  /** Filled orders show the whole bar in the fill color. */
  filled?: boolean;
  limitLabel?: string;
};

/** The signature view: how much of the entitlement the pool pays, against the holder's limit. */
export function GapBar({ entitlement, market, limitBps, entitlementUsd, deadline, filled, limitLabel = "Your limit" }: Props) {
  const share = Math.max(0, Math.min(1, market / entitlement));
  const gap = (1 - share) * 100;
  const limitAt = 1 - limitBps / 10_000;
  const meets = filled || share >= limitAt;

  return (
    <div className="text-sm">
      <Row label="Entitlement" value={<><span className="num">{num(entitlement)}</span> SPCXx per token</>} right={entitlementUsd !== undefined ? <span className="num">{usd(entitlementUsd)}</span> : undefined} />
      <Row label="Pool pays" value={<><span className="num">{num(market)}</span> SPCXx</>} right={<span className="num">{pct(gap)} gap</span>} />
      <div className="relative mt-3 mb-7 h-3 w-full overflow-visible rounded-full bg-vellum">
        <div className="hatch absolute inset-0 rounded-full" />
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-[400ms] ease-out ${meets ? "bg-fill" : "bg-slate"}`}
          style={{ width: `${(filled ? 1 : share) * 100}%` }}
        />
        <div className="absolute -top-1.5 h-6 w-0.5 bg-hold" style={{ left: `calc(${limitAt * 100}% - 1px)` }} aria-hidden />
        <div className="absolute top-5 -translate-x-1/2 whitespace-nowrap text-xs text-hold" style={{ left: `${Math.min(Math.max(limitAt * 100, 14), 86)}%` }}>
          ▲ {limitLabel} {pct(limitBps / 100, 0)}
        </div>
      </div>
      <Row
        label={limitLabel}
        value={<><span className="num">{pct(limitBps / 100, 0)}</span> largest gap accepted</>}
        right={<span className={meets ? "text-fill" : "text-slate"}>{filled ? "filled" : meets ? "pool meets it now" : "not yet"}</span>}
      />
      {deadline && <Row label="Deadline" value={deadline.label} right={<span className="num">{deadline.daysLeft} days left</span>} />}
    </div>
  );
}

function Row({ label, value, right }: { label: string; value: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-b border-hairline py-2 last:border-b-0">
      <span className="w-full text-xs uppercase tracking-[0.06em] text-slate sm:w-28">{label}</span>
      <span className="flex-1 text-ink">{value}</span>
      {right && <span className="text-right text-ink">{right}</span>}
    </div>
  );
}
