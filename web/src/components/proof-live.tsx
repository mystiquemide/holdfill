"use client";

import { useEffect, useState } from "react";
import { explorerAddr, shortAddr, utcTime } from "@/lib/format";

type ProgramState = { upgradeAuthority: string | null; asOf: string };

/** The program's upgrade authority, read live from its ProgramData account on devnet. */
export function ProgramAuthority() {
  const [data, setData] = useState<ProgramState | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/program").then(async (r) => { if (!r.ok) throw new Error(); setData(await r.json()); }).catch(() => setError(true));
  }, []);

  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-slate">Upgrade authority</dt>
      <dd className="text-right">
        {data ? (
          data.upgradeAuthority ? (
            <><a className="tap mono underline underline-offset-4" href={explorerAddr(data.upgradeAuthority, "devnet")} target="_blank" rel="noreferrer">{shortAddr(data.upgradeAuthority)}</a><span className="block text-xs text-slate">can upgrade the program, read {utcTime(data.asOf)}</span></>
          ) : (
            <>None, the program can no longer change<span className="block text-xs text-slate">read {utcTime(data.asOf)}</span></>
          )
        ) : error ? (
          <span className="text-deadline">Couldn&apos;t read devnet</span>
        ) : (
          <span className="text-slate">Reading devnet...</span>
        )}
      </dd>
    </div>
  );
}

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 flex items-center gap-2 rounded-[14px] bg-vellum p-1.5 pl-4">
      <code className="mono flex-1 text-sm">{command}</code>
      <button
        onClick={async () => { try { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}
        className="h-11 rounded-full bg-paper px-4 text-sm font-medium hover:bg-hairline lg:pointer-fine:h-9"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
