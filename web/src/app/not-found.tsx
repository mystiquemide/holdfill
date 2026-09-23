import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-[1200px] flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl tracking-[-0.02em] md:text-5xl">This page doesn&apos;t exist.</h1>
      <p className="text-lg text-slate">Return home, or explore the evidence and proof.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <ButtonLink href="/">Back to Holdfill</ButtonLink>
        <ButtonLink href="/evidence" variant="secondary">Evidence</ButtonLink>
      </div>
    </div>
  );
}
