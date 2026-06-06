import Link from "next/link";
import type { ReactNode } from "react";
import SiteHeader from "@/components/layout/SiteHeader";

type LegalPageShellProps = {
  badge: string;
  title: string;
  description: string;
  children: ReactNode;
};

export default function LegalPageShell({ badge, title, description, children }: LegalPageShellProps) {
  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.12),transparent_38%)]" />

      <SiteHeader compact navItems={[]} nextPath="/" />

      <section className="mx-auto max-w-4xl px-6 pb-20 pt-16">
        <div className="rounded-[34px] border border-white/55 bg-white/70 p-7 shadow-[0_18px_52px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-10">
          <div className="mb-4 inline-flex rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
            {badge}
          </div>
          <h1 className="text-4xl font-extrabold tracking-[-0.045em] text-[#0f172a] md:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-[1.85] text-[#475569]">
            {description}
          </p>
          <div className="mt-8 border-t border-slate-200/70 pt-8">
            {children}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm font-semibold text-[#64748b]">
          <Link href="/trust" className="transition hover:text-[#0f172a]">
            Trust &amp; Security
          </Link>
          <Link href="/privacy" className="transition hover:text-[#0f172a]">
            Privacy Policy
          </Link>
          <Link href="/terms" className="transition hover:text-[#0f172a]">
            Terms of Service
          </Link>
          <Link href="/refund" className="transition hover:text-[#0f172a]">
            Refund Policy
          </Link>
        </div>
      </section>
    </main>
  );
}