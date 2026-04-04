"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Download, DollarSign, Eye, HelpCircle, Smartphone, Sparkles, Wand2, Zap } from "lucide-react";
function AuthControls({ nextPath = "/builder" }: { nextPath?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = nextPath;
      }}
      className="inline-flex items-center rounded-full border border-white/60 bg-white px-4 py-2 text-sm font-semibold text-[#0f172a] shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition hover:bg-white/90"
    >
      Sign in
    </button>
  );
}

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
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-[0_8px_18px_rgba(99,102,241,0.22)] overflow-hidden">
        <img
          src="/ndjc-logo.png"
          alt="Think it Done logo"
          className="h-8 w-8 object-contain scale-125"
        />
      </div>
      <div className="leading-none">
        <div className="text-sm font-semibold tracking-[0.02em] text-[#0f172a]">Think it Done</div>
        <div className="mt-1 text-[10px] font-medium text-[#94a3b8]">Build native Android apps in minutes</div>
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

            <div className="max-w-[560px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300 bg-gradient-to-r from-fuchsia-50 to-pink-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-fuchsia-600 shadow-[0_6px_16px_rgba(217,70,239,0.15)]">
                Builder
              </div>

              <h3 className="mt-5 max-w-[520px] text-[31px] font-bold tracking-[-0.055em] leading-[0.98] text-[#0f172a] sm:text-[40px]">
                Start building your app now
              </h3>

              <p className="mt-4 max-w-[460px] text-[13px] font-medium tracking-[0.01em] text-[#64748b]">
                No coding required · Generate a real native Android APK
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
              alt="Think it Done logo"
              className="w-[420px] opacity-80 mix-blend-multiply"
            />
          </div>
        </section>
      </div>

      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:items-start">
          <div className="rounded-[28px] border border-rose-200/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.78)_0%,rgba(249,250,251,0.98)_100%)] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_12px_30px_rgba(15,23,42,0.03)] md:p-9">
            <div className="mb-4 text-sm font-semibold tracking-[0.12em] text-rose-400">The problem</div>
            <h2 className="max-w-[520px] text-3xl font-extrabold tracking-[-0.04em] leading-[1.06] text-[#0f172a] md:text-[34px]">
              Running your business on platforms alone makes growth harder
            </h2>
            <p className="mt-5 max-w-[560px] text-[16px] leading-[1.9] text-[#64748b]">
              Many small businesses still rely on social platforms, chat groups, or marketplace pages to present products and talk to customers. That works at first, but it becomes hard to build your own brand, retain customers, and keep communication organized.
            </p>

            <div className="mt-9 grid gap-3">
              <div className="rounded-2xl border border-rose-200/60 bg-white px-4 py-3.5 text-[14px] font-medium text-[#475569] shadow-[0_6px_16px_rgba(15,23,42,0.03)]">
                No dedicated place to showcase products and services professionally
              </div>
              <div className="rounded-2xl border border-rose-200/55 bg-white px-4 py-3.5 text-[14px] text-[#475569] shadow-[0_6px_16px_rgba(15,23,42,0.025)]">
                Customer communication is scattered across different channels
              </div>
              <div className="rounded-2xl border border-rose-200/55 bg-white px-4 py-3.5 text-[14px] text-[#475569] shadow-[0_6px_16px_rgba(15,23,42,0.025)]">
                Promotions and updates do not reach customers in a direct, branded way
              </div>
              <div className="rounded-2xl border border-rose-200/55 bg-white px-4 py-3.5 text-[14px] text-[#475569] shadow-[0_6px_16px_rgba(15,23,42,0.025)]">
                It is difficult to build a stronger brand presence and private customer channel
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[32px] border border-indigo-100/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,248,255,0.94)_100%)] p-8 shadow-[0_24px_70px_rgba(99,102,241,0.16)] md:p-10">
            <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.16),transparent_68%)]" />
            <div className="absolute left-1/2 top-3 -translate-x-1/2 text-[20px] text-amber-400">✨</div>
            <div className="relative z-10 mb-4 text-sm font-semibold tracking-[0.12em] text-indigo-400">The solution</div>
            <h2 className="relative z-10 max-w-[560px] text-[36px] font-extrabold tracking-[-0.045em] leading-[1.04] text-[#0f172a] md:text-[38px]">
              Give your business its own app
            </h2>
            <p className="relative z-10 mt-5 max-w-[580px] text-[17px] leading-[1.95] text-[#64748b]">
              Create a simple native app to showcase products, talk with customers, publish updates, and present your business — all in one place.
            </p>

            <div className="relative z-10 mt-10 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[22px] border border-indigo-200/70 bg-white/88 p-5 shadow-[0_10px_24px_rgba(99,102,241,0.08)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_34px_rgba(99,102,241,0.12)] sm:col-span-2">
                <div className="text-sm font-semibold tracking-[0.06em] text-indigo-500">Products</div>
                <h3 className="mt-2 text-[21px] font-semibold tracking-[-0.02em] text-[#0f172a]">Show what you sell</h3>
                <p className="mt-2 max-w-[440px] text-[14px] leading-[1.8] text-[#64748b]">
                  Display products and services in your own app space.
                </p>
              </div>

              <div className="rounded-[22px] border border-indigo-200/65 bg-white/82 p-5 shadow-[0_8px_20px_rgba(99,102,241,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(99,102,241,0.10)]">
                <div className="text-sm font-semibold tracking-[0.06em] text-indigo-500">Chat</div>
                <h3 className="mt-2 text-lg font-semibold text-[#0f172a]">Talk with customers</h3>
                <p className="mt-2 text-[14px] leading-[1.8] text-[#64748b]">
                  Communicate directly inside your own channel.
                </p>
              </div>

              <div className="rounded-[22px] border border-indigo-200/65 bg-white/82 p-5 shadow-[0_8px_20px_rgba(99,102,241,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(99,102,241,0.10)]">
                <div className="text-sm font-semibold tracking-[0.06em] text-indigo-500">Updates</div>
                <h3 className="mt-2 text-lg font-semibold text-[#0f172a]">Send promotions</h3>
                <p className="mt-2 text-[14px] leading-[1.8] text-[#64748b]">
                  Share news and offers directly with customers.
                </p>
              </div>

              <div className="rounded-[22px] border border-indigo-200/65 bg-white/82 p-5 shadow-[0_8px_20px_rgba(99,102,241,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(99,102,241,0.10)] sm:col-span-2">
                <div className="text-sm font-semibold tracking-[0.06em] text-indigo-500">Brand</div>
                <h3 className="mt-2 text-lg font-semibold text-[#0f172a]">Build your brand</h3>
                <p className="mt-2 max-w-[460px] text-[14px] leading-[1.8] text-[#64748b]">
                  Create a more professional, branded experience.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <div className="text-center">
          <div className="mb-3 text-sm font-medium tracking-[0.08em] text-indigo-400">Use cases</div>
          <h2 className="text-2xl font-extrabold tracking-[-0.03em] md:text-3xl">
            Built for real-world local businesses
          </h2>
          <p className="mt-4 text-[17px] leading-[1.9] text-[#475569]">
            Perfect for restaurants, salons, local shops, and service-based businesses.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-4 py-2 text-sm font-medium text-indigo-600">Restaurants</div>
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-4 py-2 text-sm font-medium text-indigo-600">Salons & Beauty</div>
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-4 py-2 text-sm font-medium text-indigo-600">Local Shops</div>
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-4 py-2 text-sm font-medium text-indigo-600">Fitness & Studios</div>
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-4 py-2 text-sm font-medium text-indigo-600">Services</div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-12">
          <div className="mb-3 text-sm font-medium tracking-[0.08em] text-indigo-400">Features</div>
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">
            Build your own app — faster, cheaper, and fully in your control
          </h2>
          <div className="mt-6 h-px w-10 bg-gradient-to-r from-indigo-300/22 via-indigo-200/16 to-transparent" />
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.08)]">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
                <DollarSign className="h-5 w-5" />
              </div>
              <div className="rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                Cost
              </div>
            </div>
            <h3 className="mb-3 text-[22px] font-semibold tracking-[-0.03em] text-[#0f172a]">Get your own app without spending thousands</h3>
            <p className="mb-5 text-[17px] leading-[1.85] text-[#475569]">
              No developers, no complexity — just build it yourself.
            </p>
            <div className="text-sm text-[#94a3b8]">Start building right away without setup or hidden costs.</div>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.08)]">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
                <Zap className="h-5 w-5" />
              </div>
              <div className="rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                Speed
              </div>
            </div>
            <h3 className="mb-3 text-[22px] font-semibold tracking-[-0.03em] text-[#0f172a]">Launch your app in minutes</h3>
            <p className="mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Set it up in minutes with a simple, guided flow.
            </p>
            <div className="text-sm text-[#94a3b8]">From idea to working app, without delays or back-and-forth.</div>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.08)]">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
                <Smartphone className="h-5 w-5" />
              </div>
              <div className="rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                Ownership
              </div>
            </div>
            <h3 className="mb-3 text-[22px] font-semibold tracking-[-0.03em] text-[#0f172a]">Own your native app & customers</h3>
            <p className="mb-5 text-[17px] leading-[1.85] text-[#475569]">
              A real Android app, ready to connect directly with your customers.
            </p>
            <div className="text-sm text-[#94a3b8]">Own your brand, your users, and your communication channel.</div>
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
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Configure</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Configure your app</h3>
            <p className="relative z-10 mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Set app name, upload icon, and create your admin account.
            </p>
            <div className="relative z-10 text-sm text-[#94a3b8]">Define your app identity before building.</div>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.07)]">
            <div className="absolute right-5 top-4 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/70">02</div>
            <div className="relative z-10 mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.13)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Selection</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Select features & UI</h3>
            <p className="relative z-10 mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Choose a logic module and match it with a UI pack.
            </p>
            <div className="relative z-10 text-sm text-[#94a3b8]">Mix functionality and design without coding.</div>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.07)]">
            <div className="absolute right-5 top-4 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/70">03</div>
            <div className="relative z-10 mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.13)]">
              <Download className="h-5 w-5" />
            </div>
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Build</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Build & download APK</h3>
            <p className="relative z-10 mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Start build, track progress, and download your app.
            </p>
            <div className="relative z-10 text-sm text-[#94a3b8]">From configuration to installable APK in one flow.</div>
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
                  No Code
                </div>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em] text-[#0f172a] md:text-[30px]">Can I build an app without coding?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Yes. Think it Done is designed for non-technical users — just follow a simple setup process.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Speed
                </div>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em] text-[#0f172a] md:text-[30px]">How long does it take to get my app?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Most apps can be built and ready to download in minutes.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Pricing
                </div>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em] text-[#0f172a] md:text-[30px]">How much does it cost?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Much lower than hiring developers, with a free trial available.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  App Type
                </div>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em] text-[#0f172a] md:text-[30px]">Is this a real app or a web app?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              It’s a real Android app, not a web wrapper.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Use Case
                </div>
                <h3 className="text-[26px] font-semibold tracking-[-0.03em] text-[#0f172a] md:text-[30px]">Can I use this for my business?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Yes. It’s built for small businesses to manage customers and promotions.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20 pt-4">
        <div className="px-8 py-10 text-center md:px-12 md:py-12">
          <div className="text-sm font-medium tracking-[0.08em] text-indigo-400">Ready to start?</div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.03em] text-[#0f172a] md:text-4xl">
            Build your native Android app and download your APK
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-[1.9] text-[#475569]">
            Set up your app, choose your module and UI pack, and start building in just a few steps.
          </p>
          <div className="mt-8 flex justify-center">
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
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-8 text-center text-sm font-medium tracking-[0.02em] text-[#94a3b8]">
        © 2026 Think it Done. Build faster, launch earlier.
      </footer>
    </main>
  );
}
