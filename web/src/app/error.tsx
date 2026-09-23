"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-[1200px] flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl tracking-[-0.02em] md:text-5xl">Something broke on our side.</h1>
      <p className="text-lg text-slate">Your tokens are untouched. Nothing moves without your signature.</p>
      <Button onClick={() => retry()}>Reload this section</Button>
    </div>
  );
}
