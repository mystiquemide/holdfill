import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[1200px] flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <h1 className="text-4xl tracking-[-0.02em] md:text-5xl">This page doesn&apos;t exist.</h1>
      <p className="text-lg text-slate">Holdfill is one page. Everything lives there.</p>
      <ButtonLink href="/">Back to Holdfill</ButtonLink>
    </main>
  );
}
