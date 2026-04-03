"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Download, Eye, HelpCircle, Sparkles, Wand2 } from "lucide-react";
import AuthControls from "@/components/auth/AuthControls";

export default function Home() {
  const previewScreens = ["home", "services", "chat", "announcement"] as const;
  const [activePreview, setActivePreview] = useState<(typeof previewScreens)[number]>("home");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActivePreview((current) => {
        const currentIndex = previewScreens.indexOf(current);
        return previewScreens[(currentIndex + 1) % previewScreens.length];
      });
    }, 2600);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="relative">
        <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />
        

<header className="relative z-20 mx-auto max-w-7xl px-6 pt-6">
  <div className="flex items-center justify-between rounded-full border border-white/60 bg-white/70 px-6 py-3 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-bold text-white shadow-[0_8px_18px_rgba(99,102,241,0.22)]">
        N
      </div>
      <div className="leading-none">
        <div className="text-sm font-semibold tracking-[0.06em] text-[#0f172a]">NDJC</div>
        <div className="mt-1 text-[10px] font-medium text-[#94a3b8]">Native App Builder</div>
      </div>
    </div>

    <nav className="hidden items-center gap-2 rounded-full bg-white/60 px-3 py-1.5 text-sm font-medium text-[#64748b] backdrop-blur md:flex">
      <a
        href="#features"
        className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-[#0f172a]"
      >
        Features
      </a>
      <a
        href="#how-it-works"
        className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-[#0f172a]"
      >
        How it works
      </a>
      <a
        href="#faq"
        className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-[#0f172a]"
      >
        FAQ
      </a>
    </nav>

    <div className="flex items-center gap-3">
      <AuthControls nextPath="/builder" />
    </div>
  </div>
</header>

        <section className="relative z-10 mx-auto grid min-h-[78vh] max-w-7xl items-center gap-12 px-6 py-16 md:grid-cols-[minmax(0,640px)_1fr]">
          <div className="max-w-[640px]">
            <div className="mb-4 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium tracking-[0.06em] text-[#64748b]">
              Built for local service businesses
            </div>

            <h1 className="mb-8 text-5xl font-extrabold tracking-[-0.04em] leading-[0.96] md:text-7xl">
              Build your own real Android app
              <br />
              <span className="text-4xl md:text-6xl text-[#0f172a]/60">For your local business — no code needed</span>
            </h1>

            
            <p className="mb-10 max-w-[600px] text-lg leading-[1.9] text-[#475569]">
              Give your customers a dedicated app — show services, chat instantly, and send updates.
            </p>

            <div className="max-w-[560px] rounded-[28px] border border-white/40 bg-white/38 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300 bg-gradient-to-r from-fuchsia-50 to-pink-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-fuchsia-600 shadow-[0_6px_16px_rgba(217,70,239,0.15)]">
                Builder
              </div>

              <h3 className="mt-5 max-w-[520px] text-[31px] font-bold tracking-[-0.055em] leading-[0.98] text-[#0f172a] sm:text-[40px]">
                Start building your app now
              </h3>

              <p className="mt-4 max-w-[460px] text-[13px] font-medium tracking-[0.01em] text-[#64748b]">
                No coding required · Generate a native Android APK
              </p>

              <div className="mt-8 flex items-center gap-4">
<button
  type="button"
  onClick={() => {
    window.location.href = "/builder";
  }}
  className="group relative inline-flex overflow-hidden rounded-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(236,72,153,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_52px_rgba(236,72,153,0.30)] active:scale-[0.985]"
>
  <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.16)_40%,transparent_72%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
  <div className="relative flex items-center justify-center gap-2">
    <span className="text-[15px] font-bold tracking-[-0.01em]">Enter Builder</span>
    <ArrowRight className="h-[15px] w-[15px] text-white/80 transition-transform duration-300 group-hover:translate-x-0.5" />
  </div>
</button>

                <div className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8] sm:flex items-center gap-1.5">
                  <span className="text-indigo-500">Configure</span>
                  <span className="opacity-40">→</span>
                  <span>Generate</span>
                  <span className="opacity-40">→</span>
                  <span>Download</span>
                </div>
              </div>
            </div>
          </div>

          <div className="relative hidden md:flex items-center justify-center">
            <img
              src="/ndjc-logo.png"
              alt="NDJC logo"
              className="w-[420px] opacity-80 mix-blend-multiply"
            />
          </div>
        </section>
      </div>

      <section id="features" className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-12">
          <div className="mb-3 text-sm font-medium tracking-[0.08em] text-indigo-400">Features</div>
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">
            A faster way to launch simple business apps
          </h2>
          <div className="mt-6 h-px w-10 bg-gradient-to-r from-indigo-300/22 via-indigo-200/16 to-transparent" />
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.08)]">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                AI Flow
              </div>
            </div>
            <h3 className="mb-3 text-[22px] font-semibold tracking-[-0.03em] text-[#0f172a]">Prompt to app</h3>
            <p className="mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Describe what you want in plain language and generate the first version fast.
            </p>
            <div className="text-sm text-[#94a3b8]">From idea input to usable app structure in one step.</div>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.08)]">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
                <Eye className="h-5 w-5" />
              </div>
              <div className="rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                Preview
              </div>
            </div>
            <h3 className="mb-3 text-[22px] font-semibold tracking-[-0.03em] text-[#0f172a]">Online preview</h3>
            <p className="mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Review the generated structure and experience the app before packaging.
            </p>
            <div className="text-sm text-[#94a3b8]">Validate the output before you send it into the build pipeline.</div>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.08)]">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
                <Download className="h-5 w-5" />
              </div>
              <div className="rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                Delivery
              </div>
            </div>
            <h3 className="mb-3 text-[22px] font-semibold tracking-[-0.03em] text-[#0f172a]">APK download</h3>
            <p className="mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Push to build pipeline, package automatically, and download the APK.
            </p>
            <div className="text-sm text-[#94a3b8]">A cleaner handoff from generated app to installable build artifact.</div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-12">
          <div className="mb-3 text-sm font-medium tracking-[0.08em] text-indigo-400">How it works</div>
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Simple 3-step flow</h2>
          <div className="mt-6 h-px w-10 bg-gradient-to-r from-indigo-300/22 via-indigo-200/16 to-transparent" />
        </div>

        <div className="relative grid gap-6 md:grid-cols-3">

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.07)]">
            <div className="absolute right-5 top-4 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/70">01</div>
            <div className="relative z-10 mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.13)]">
              <Wand2 className="h-5 w-5" />
            </div>
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Describe</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Describe your app</h3>
            <p className="relative z-10 text-[17px] leading-[1.85] text-[#475569]">
              Enter your idea, business type, or app feature requirements.
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.07)]">
            <div className="absolute right-5 top-4 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/70">02</div>
            <div className="relative z-10 mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.13)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Generate</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Generate the structure</h3>
            <p className="relative z-10 text-[17px] leading-[1.85] text-[#475569]">
              NDJC creates the app structure and prepares the packaging flow.
            </p>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.07)]">
            <div className="absolute right-5 top-4 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/70">03</div>
            <div className="relative z-10 mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.13)]">
              <Download className="h-5 w-5" />
            </div>
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Download</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Download the APK</h3>
            <p className="relative z-10 text-[17px] leading-[1.85] text-[#475569]">
              Build the APK and get a downloadable result for installation and testing.
            </p>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-6 py-20">
        <div className="mb-12 text-center">
          <div className="mb-3 text-sm font-medium tracking-[0.08em] text-indigo-400">FAQ</div>
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Common questions</h2>
          <div className="mx-auto mt-6 h-px w-10 bg-gradient-to-r from-indigo-300/22 via-indigo-200/16 to-transparent" />
        </div>

        <div className="space-y-5">
          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Build Output
                </div>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em] text-[#0f172a] md:text-[30px]">Can I generate an APK directly?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Yes. NDJC is designed around prompt input, code generation, packaging, and APK output.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Product Scope
                </div>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em] text-[#0f172a] md:text-[30px]">Is this for full custom enterprise apps?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              No. It is better for MVPs, startup validation, and simple small-business apps.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  No-code Friendly
                </div>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em] text-[#0f172a] md:text-[30px]">Do I need coding skills?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              No. The product is meant to reduce the technical barrier for early-stage app creation.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-8 text-center text-sm font-medium tracking-[0.02em] text-[#94a3b8]">
        © 2026 NDJC. Build faster, launch earlier.
      </footer>
    </main>
  );
}
