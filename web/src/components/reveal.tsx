"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Rises into view the first time it scrolls on screen. Children marked `data-item` stagger in
 * order of their `--i` style. Content renders visible on the server and without JavaScript; the
 * hidden state only applies after mount, and never with reduced motion.
 */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.reveal = "";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.reveal = "in";
        io.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}
