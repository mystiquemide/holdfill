/** Holdfill mark: outline stem (the position you hold), solid stem (the conversion), limit crossbar. */
export function Mark({ size = 24, inverse = false }: { size?: number; inverse?: boolean }) {
  const ink = inverse ? "#ffffff" : "#171717";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="2.75" y="2.75" width="3.5" height="18.5" fill="none" stroke={ink} strokeWidth="1.5" />
      <rect x="17" y="2" width="5" height="20" fill={ink} />
      <rect x="7" y="10.5" width="10" height="3" fill="#FFE9BF" stroke={ink} strokeWidth="0.75" />
    </svg>
  );
}

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-[5px] text-xl tracking-[-0.02em] ${inverse ? "text-paper" : "text-ink"}`}>
      <Mark inverse={inverse} />
      <span><span className="font-normal">hold</span><span className="font-semibold">fill</span></span>
    </span>
  );
}
