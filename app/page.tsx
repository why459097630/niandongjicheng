"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Download, DollarSign, Eye, HelpCircle, Smartphone, Sparkles, Wand2, Zap } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";

const ACQUISITION_SESSION_KEY = "ndjc_acquisition_session_id";

export default function Home() {
  const previewScreens = ["home", "services", "chat", "announcement"] as const;
  const navItems = [
    { id: "features", label: "Customer Hub" },
    { id: "how-it-works", label: "How it works" },
    { id: "faq", label: "FAQ" },
    { id: "trust", label: "Trust" },
  ] as const;

  const [activePreview, setActivePreview] = useState<(typeof previewScreens)[number]>("home");
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const [activeSection, setActiveSection] = useState<(typeof navItems)[number]["id"] | null>(null);
  
    useEffect(() => {
    try {
      let sessionId = window.localStorage.getItem(ACQUISITION_SESSION_KEY);

      if (!sessionId) {
        sessionId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `ndjc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        window.localStorage.setItem(ACQUISITION_SESSION_KEY, sessionId);
      }

      const url = new URL(window.location.href);

      void fetch("/api/track-acquisition", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          landingPath: `${url.pathname}${url.search}`,
          referrer: document.referrer || null,
          utmSource: url.searchParams.get("utm_source"),
          utmMedium: url.searchParams.get("utm_medium"),
          utmCampaign: url.searchParams.get("utm_campaign"),
        }),
      });
    } catch (error) {
      console.error("NDJC home: failed to track acquisition", error);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActivePreview((current) => {
        const currentIndex = previewScreens.indexOf(current);
        return previewScreens[(currentIndex + 1) % previewScreens.length];
      });
    }, 2600);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setIsHeaderCompact(currentScrollY > 24);

      const probeY = currentScrollY + 140;
      let nextActiveSection: (typeof navItems)[number]["id"] | null = null;

      for (const item of navItems) {
        const element = document.getElementById(item.id);
        if (!element) continue;

        const sectionTop = element.offsetTop;
        const sectionBottom = sectionTop + element.offsetHeight;

        if (probeY >= sectionTop && probeY < sectionBottom) {
          nextActiveSection = item.id;
          break;
        }
      }

      setActiveSection((prev) => (prev === nextActiveSection ? prev : nextActiveSection));
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [navItems]);

  const handleNavClick = (sectionId: (typeof navItems)[number]["id"]) => {
    const element = document.getElementById(sectionId);
    if (!element) return;

    const headerOffset = 104;
    const targetTop = element.getBoundingClientRect().top + window.scrollY - headerOffset;

    window.scrollTo({
      top: targetTop,
      behavior: "smooth",
    });
  };

  const headerNavItems = useMemo(
    () =>
      navItems.map((item) => ({
        label: item.label,
        isActive: activeSection === item.id,
        onClick: () => handleNavClick(item.id),
      })),
    [activeSection]
  );

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader
        compact={isHeaderCompact}
        navItems={headerNavItems}
        nextPath="/"
      />

      <div className="relative">
        <section className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 px-5 pb-14 pt-10 sm:px-6 md:min-h-[78vh] md:grid-cols-[minmax(0,640px)_1fr] md:gap-12 md:py-16">
          <div className="max-w-[640px]">
            <div className="mb-4 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium tracking-[0.06em] text-[#64748b]">
              Built for local businesses
            </div>

            <h1 className="mb-6 text-[38px] font-extrabold leading-[0.98] tracking-[-0.045em] sm:text-5xl md:mb-8 md:text-7xl md:leading-[0.96]">
              Create a branded customer hub
              <br />
              <span className="text-[28px] text-[#0f172a]/60 sm:text-4xl md:text-6xl">for your local business — ready to share</span>
            </h1>

            
            <p className="mb-8 max-w-[600px] text-base leading-[1.8] text-[#475569] md:mb-10 md:text-lg md:leading-[1.9]">
              A mobile-friendly customer hub that opens from a link or QR code, no app store required. Customers can browse, book, chat, and receive updates — all in one branded hub for your local business.
            </p>

            <div className="max-w-[560px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300 bg-gradient-to-r from-fuchsia-50 to-pink-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-fuchsia-600 shadow-[0_6px_16px_rgba(217,70,239,0.15)]">
                Builder
              </div>

              <h3 className="mt-5 max-w-[520px] text-[31px] font-bold tracking-[-0.055em] leading-[0.98] text-[#0f172a] sm:text-[40px]">
                Build your customer hub
              </h3>

              <p className="mt-4 max-w-[460px] text-[13px] font-medium tracking-[0.01em] text-[#64748b]">
                No coding required · Create a branded customer entry for your local business
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
<button
  type="button"
  onClick={() => {
    window.location.href = "/builder";
  }}
  className="group relative inline-flex w-full justify-center overflow-hidden rounded-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(236,72,153,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_52px_rgba(236,72,153,0.30)] active:scale-[0.985] sm:w-auto"
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
                  <span>Launch</span>
                </div>
              </div>


            </div>
          </div>

          <div className="relative hidden md:flex items-center justify-center">
            <div className="relative h-[520px] w-full max-w-[470px]">
              <div className="pointer-events-none absolute inset-0 rounded-[56px] bg-[radial-gradient(circle_at_50%_35%,rgba(236,72,153,0.16),rgba(168,85,247,0.10),transparent_68%)] blur-3xl" />

              <div className="absolute left-6 top-8 w-[220px] rounded-[30px] border border-white/60 bg-white/80 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-xl transition-all duration-700">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-500">Home</div>
                    <div className="mt-1 text-sm font-semibold text-[#0f172a]">Store preview</div>
                  </div>
                  <div className="rounded-full bg-fuchsia-100 px-2 py-1 text-[10px] font-medium text-fuchsia-600">Live</div>
                </div>
                <div className="space-y-3">
                  <div className="h-24 rounded-[22px] bg-[linear-gradient(135deg,rgba(236,72,153,0.20),rgba(168,85,247,0.14))]" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-20 rounded-[18px] bg-slate-100" />
                    <div className="h-20 rounded-[18px] bg-slate-100" />
                  </div>
                  <div className="h-12 rounded-[18px] bg-slate-100" />
                </div>
              </div>

              <div className="absolute right-4 top-16 w-[240px] rounded-[30px] border border-white/60 bg-white/82 p-4 shadow-[0_18px_42px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all duration-700">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500">Services</div>
                    <div className="mt-1 text-sm font-semibold text-[#0f172a]">Product list</div>
                  </div>
                  <div className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-medium text-indigo-600">Demo</div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-[20px] bg-slate-100 p-3">
                    <div className="h-12 w-12 rounded-[16px] bg-[linear-gradient(135deg,rgba(99,102,241,0.35),rgba(168,85,247,0.28))]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-24 rounded-full bg-slate-200" />
                      <div className="h-3 w-16 rounded-full bg-slate-200" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-[20px] bg-slate-100 p-3">
                    <div className="h-12 w-12 rounded-[16px] bg-[linear-gradient(135deg,rgba(236,72,153,0.28),rgba(249,115,22,0.24))]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-24 rounded-full bg-slate-200" />
                      <div className="h-3 w-20 rounded-full bg-slate-200" />
                    </div>
                  </div>
                  <div className="h-10 rounded-[18px] bg-slate-100" />
                </div>
              </div>

              <div className="absolute bottom-14 left-12 w-[210px] rounded-[28px] border border-white/60 bg-white/84 p-4 shadow-[0_18px_38px_rgba(15,23,42,0.10)] backdrop-blur-xl transition-all duration-700">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-500">Chat</div>
                    <div className="mt-1 text-sm font-semibold text-[#0f172a]">Customer messages</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="ml-auto h-10 w-[72%] rounded-[18px] rounded-br-md bg-[linear-gradient(135deg,rgba(236,72,153,0.85),rgba(168,85,247,0.82))]" />
                  <div className="h-10 w-[78%] rounded-[18px] rounded-bl-md bg-slate-100" />
                  <div className="ml-auto h-10 w-[60%] rounded-[18px] rounded-br-md bg-[linear-gradient(135deg,rgba(99,102,241,0.78),rgba(168,85,247,0.72))]" />
                </div>
              </div>

              <div className="absolute bottom-6 right-10 w-[230px] rounded-[28px] border border-white/60 bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl transition-all duration-700">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-500">Updates</div>
                    <div className="mt-1 text-sm font-semibold text-[#0f172a]">Announcement card</div>
                  </div>
                  <div className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-600">Push</div>
                </div>
                <div className="space-y-3">
                  <div className="h-24 rounded-[20px] bg-[linear-gradient(135deg,rgba(251,191,36,0.24),rgba(249,115,22,0.18))]" />
                  <div className="h-3 w-[88%] rounded-full bg-slate-200" />
                  <div className="h-3 w-[70%] rounded-full bg-slate-200" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section id="features" className="scroll-mt-28 mx-auto max-w-7xl px-5 py-14 sm:px-6 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 text-sm font-semibold tracking-[0.14em] text-indigo-400">
            Customer hub system
          </div>
          <h2 className="text-[34px] font-extrabold leading-[1.06] tracking-[-0.045em] text-[#0f172a] sm:text-4xl md:text-[54px] md:leading-[1.04]">
            Everything customers need in one branded place
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-[1.8] text-[#64748b] md:mt-6 md:text-[17px] md:leading-[1.9]">
            Give customers one branded place to browse services, book appointments, ask questions, and receive updates — all under your own name and icon.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:mt-14 md:gap-5 lg:grid-cols-3">
          <div className="group relative overflow-hidden rounded-[26px] border border-indigo-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(246,248,255,0.92)_100%)] p-6 shadow-[0_24px_70px_rgba(99,102,241,0.12)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_30px_82px_rgba(99,102,241,0.16)] md:rounded-[34px] md:p-8">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-indigo-100/70 blur-3xl" />
            <div className="absolute -bottom-20 left-8 h-48 w-48 rounded-full bg-fuchsia-100/50 blur-3xl" />
            <div className="absolute right-8 top-7 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/80">01</div>

            <div className="relative z-10">
              <div className="flex items-start justify-between gap-4">
                <div className="inline-flex rounded-full border border-indigo-100 bg-white/82 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-indigo-500 shadow-[0_10px_26px_rgba(99,102,241,0.08)]">
                  Brand
                </div>
              </div>

              <h3 className="mt-8 text-3xl font-extrabold tracking-[-0.04em] leading-[1.06] text-[#0f172a]">
                Build your branded entry
              </h3>

              <p className="mt-4 text-[15px] leading-[1.85] text-[#64748b]">
                Give customers a recognizable entry that carries your business name, icon, and identity.
              </p>

              <div className="mt-8 flex flex-wrap gap-2">
                <span className="rounded-full border border-indigo-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-indigo-500">
                  Custom name
                </span>
                <span className="rounded-full border border-indigo-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-indigo-500">
                  Custom icon
                </span>
                <span className="rounded-full border border-indigo-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-indigo-500">
                  Link or QR code
                </span>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-[26px] border border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(240,249,255,0.90)_100%)] p-6 shadow-[0_24px_70px_rgba(14,165,233,0.10)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_30px_82px_rgba(14,165,233,0.14)] md:rounded-[34px] md:p-8">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-sky-100/70 blur-3xl" />
            <div className="absolute -bottom-20 left-8 h-48 w-48 rounded-full bg-cyan-100/50 blur-3xl" />
            <div className="absolute right-8 top-7 text-6xl font-semibold tracking-[-0.06em] text-sky-100/90">02</div>

            <div className="relative z-10">
              <div className="flex items-start justify-between gap-4">
                <div className="inline-flex rounded-full border border-sky-100 bg-white/82 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-sky-500 shadow-[0_10px_26px_rgba(14,165,233,0.08)]">
                  Operate
                </div>
              </div>

              <h3 className="mt-8 text-3xl font-extrabold tracking-[-0.04em] leading-[1.06] text-[#0f172a]">
                Manage customer actions in one place
              </h3>

              <p className="mt-4 text-[15px] leading-[1.85] text-[#64748b]">
                Customers browse, book, chat, and receive updates from the shared hub. You manage content, bookings, conversations, and announcements from the built-in admin area.
              </p>

              <div className="mt-8 flex flex-wrap gap-2">
                <span className="rounded-full border border-sky-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-sky-500">
                  Services
                </span>
                <span className="rounded-full border border-sky-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-sky-500">
                  Bookings
                </span>
                <span className="rounded-full border border-sky-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-sky-500">
                  Chat
                </span>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-[26px] border border-fuchsia-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(253,244,255,0.90)_100%)] p-6 shadow-[0_24px_70px_rgba(217,70,239,0.10)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_30px_82px_rgba(217,70,239,0.14)] md:rounded-[34px] md:p-8">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-fuchsia-100/70 blur-3xl" />
            <div className="absolute -bottom-20 left-8 h-48 w-48 rounded-full bg-rose-100/50 blur-3xl" />
            <div className="absolute right-8 top-7 text-6xl font-semibold tracking-[-0.06em] text-fuchsia-100/90">03</div>

            <div className="relative z-10">
              <div className="flex items-start justify-between gap-4">
                <div className="inline-flex rounded-full border border-fuchsia-100 bg-white/82 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-500 shadow-[0_10px_26px_rgba(217,70,239,0.08)]">
                  Retention
                </div>
              </div>

              <h3 className="mt-7 text-[24px] font-extrabold leading-[1.08] tracking-[-0.04em] text-[#0f172a] md:mt-8 md:text-3xl md:leading-[1.06]">
                Keep customers engaged
              </h3>

              <p className="mt-4 text-[15px] leading-[1.85] text-[#64748b]">
                Share announcements, send reminders, and keep your business visible after the first visit.
              </p>

              <div className="mt-8 flex flex-wrap gap-2">
                <span className="rounded-full border border-fuchsia-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-fuchsia-500">
                  Updates
                </span>
                <span className="rounded-full border border-fuchsia-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-fuchsia-500">
                  Promotions
                </span>
                <span className="rounded-full border border-fuchsia-100 bg-white/82 px-3 py-1.5 text-xs font-semibold text-fuchsia-500">
                  Repeat visits
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6 md:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-3 text-sm font-semibold tracking-[0.14em] text-indigo-400">
            Customer hub advantage
          </div>
          <h2 className="text-3xl font-extrabold tracking-[-0.04em] leading-[1.08] text-[#0f172a] md:text-4xl">
            Built for easier local business promotion
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-[1.9] text-[#64748b]">
            Regular websites are easy to open, but customers often leave. Native apps feel complete, but downloads create friction. Your customer hub combines both advantages: easy to open, easy to save, and easier to bring customers back.
          </p>
        </div>

        <div className="mt-8 overflow-hidden rounded-[24px] border border-white/50 bg-white/62 shadow-[0_20px_62px_rgba(15,23,42,0.07)] backdrop-blur-xl md:mt-10 md:rounded-[32px]">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200/80">
                  <th className="w-[42%] px-5 py-4 text-[13px] font-extrabold tracking-[-0.01em] text-[#0f172a]">
                    Promotion Advantage
                  </th>
                  <th className="px-5 py-4 text-center text-[13px] font-extrabold tracking-[-0.01em] text-[#0f172a]">
                    Regular Web
                  </th>
                  <th className="px-5 py-4 text-center text-[13px] font-extrabold tracking-[-0.01em] text-[#0f172a]">
                    Native App
                  </th>
                  <th className="px-5 py-4 text-center text-[13px] font-extrabold tracking-[-0.01em] text-[#0f172a]">
                    Customer Hub
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100/90">
                  <td className="px-5 py-4 text-[14px] font-bold tracking-[-0.015em] text-[#0f172a]">
                    Instant link access
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="text-[25px] font-black leading-none text-rose-500">
                      ×
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                </tr>

                <tr className="border-b border-slate-100/90">
                  <td className="px-5 py-4 text-[14px] font-bold tracking-[-0.015em] text-[#0f172a]">
                    No download friction
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="text-[25px] font-black leading-none text-rose-500">
                      ×
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                </tr>

                <tr className="border-b border-slate-100/90">
                  <td className="px-5 py-4 text-[14px] font-bold tracking-[-0.015em] text-[#0f172a]">
                    App-like home screen entry
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="text-[25px] font-black leading-none text-rose-500">
                      ×
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                </tr>

                <tr className="border-b border-slate-100/90">
                  <td className="px-5 py-4 text-[14px] font-bold tracking-[-0.015em] text-[#0f172a]">
                    Easier customer return
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="text-[25px] font-black leading-none text-rose-500">
                      ×
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                </tr>

                <tr className="border-b border-slate-100/90">
                  <td className="px-5 py-4 text-[14px] font-bold tracking-[-0.015em] text-[#0f172a]">
                    Push updates to customers
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="text-[25px] font-black leading-none text-rose-500">
                      ×
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                </tr>

                <tr>
                  <td className="px-5 py-4 text-[14px] font-bold tracking-[-0.015em] text-[#0f172a]">
                    Lower-cost app-like experience
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="text-[25px] font-black leading-none text-rose-500">
                      ×
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="text-[25px] font-black leading-none text-rose-500">
                      ×
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-[13px] font-black leading-none text-white">
                      ✓
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-12 sm:px-6 md:py-14">
        <div className="text-center">
          <div className="mb-3 text-sm font-medium tracking-[0.08em] text-indigo-400">Use cases</div>
          <h2 className="text-2xl font-extrabold tracking-[-0.03em] md:text-3xl">
            Made for local businesses that serve real customers
          </h2>
          <p className="mt-4 text-[17px] leading-[1.9] text-[#475569]">
            Ideal for restaurants, salons, local shops, studios, fitness services, and appointment-based businesses.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-3 py-1.5 text-sm font-medium text-indigo-600">Restaurants</div>
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-3 py-1.5 text-sm font-medium text-indigo-600">Salons & Beauty</div>
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-3 py-1.5 text-sm font-medium text-indigo-600">Local Shops</div>
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-3 py-1.5 text-sm font-medium text-indigo-600">Fitness & Studios</div>
          <div className="rounded-full border border-indigo-200/60 bg-indigo-50/60 px-3 py-1.5 text-sm font-medium text-indigo-600">Services</div>
        </div>
      </section>



      <section id="how-it-works" className="scroll-mt-28 mx-auto max-w-7xl px-5 py-14 sm:px-6 md:py-20">
        <div className="mb-9 md:mb-12">
          <div className="mb-3 text-sm font-medium tracking-[0.08em] text-indigo-400">How it works</div>
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Launch in 3 simple steps</h2>
          <div className="mt-6 h-px w-10 bg-gradient-to-r from-indigo-300/22 via-indigo-200/16 to-transparent" />
        </div>

        <div className="relative grid gap-6 md:grid-cols-3">

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.07)]">
            <div className="absolute right-5 top-4 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/70">01</div>
            <div className="relative z-10 mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.13)]">
              <Wand2 className="h-5 w-5" />
            </div>
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Configure</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Set up your customer hub</h3>
            <p className="relative z-10 mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Add your app name, upload your icon, and create your admin account.
            </p>
            <div className="relative z-10 text-sm text-[#94a3b8]">Define your business identity before launch.</div>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.07)]">
            <div className="absolute right-5 top-4 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/70">02</div>
            <div className="relative z-10 mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.13)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Generate</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Create your live link</h3>
            <p className="relative z-10 mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Generate your branded customer hub and get a live link or QR code customers can open in their browser.
            </p>
            <div className="relative z-10 text-sm text-[#94a3b8]">No app store review or custom development required.</div>
          </div>

          <div className="group relative overflow-hidden rounded-[28px] border border-white/40 bg-white/50 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-indigo-200/60 hover:shadow-[0_20px_48px_rgba(99,102,241,0.07)]">
            <div className="absolute right-5 top-4 text-6xl font-semibold tracking-[-0.06em] text-indigo-100/70">03</div>
            <div className="relative z-10 mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.13)]">
              <Download className="h-5 w-5" />
            </div>
            <div className="relative z-10 mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-indigo-400">Manage</div>
            <h3 className="relative z-10 mb-3 text-xl font-semibold tracking-tight text-[#0f172a]">Run your hub after launch</h3>
            <p className="relative z-10 mb-5 text-[17px] leading-[1.85] text-[#475569]">
              Use the built-in admin area to keep your content, appointments, conversations, and updates running after launch.
            </p>
            <div className="relative z-10 text-sm text-[#94a3b8]">Keep your customer entry active and useful for your business.</div>
          </div>
        </div>
      </section>

            <section id="faq" className="scroll-mt-28 mx-auto max-w-4xl px-5 py-14 sm:px-6 md:py-20">
        <div className="mb-9 text-center md:mb-12">
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
                <h3 className="text-[20px] font-semibold leading-[1.18] tracking-[-0.03em] text-[#0f172a] md:text-[30px] md:leading-[1.12]">Can I create a customer hub without coding?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Yes. Think it Done is built for non-technical business owners. Just follow a guided setup to configure your brand, content, and customer tools.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Speed
                </div>
                <h3 className="text-[20px] font-semibold leading-[1.18] tracking-[-0.03em] text-[#0f172a] md:text-[30px] md:leading-[1.12]">How long does it take to launch?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Most customer hubs can be generated in minutes. Once ready, you get a live link you can open and share with customers.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Pricing
                </div>
                <h3 className="text-[20px] font-semibold leading-[1.18] tracking-[-0.03em] text-[#0f172a] md:text-[30px] md:leading-[1.12]">How much does it cost?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              The setup price is $99. It includes your generated customer hub and 30 days of cloud service. That is far lower than hiring developers to build a custom app from scratch. Cloud renewal is available after that: 30 days for $49, 90 days for $139, or 180 days for $269.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  App Type
                </div>
                <h3 className="text-[20px] font-semibold leading-[1.18] tracking-[-0.03em] text-[#0f172a] md:text-[30px] md:leading-[1.12]">Do customers need to install it from an app store?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              No. It is a branded customer hub built as a PWA, so customers can scan a QR code or open a link in their browser, save it to their home screen, and use it like a lightweight app — without going through an app store. It works on iPhone, Android, and desktop browsers.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Use Case
                </div>
                <h3 className="text-[20px] font-semibold leading-[1.18] tracking-[-0.03em] text-[#0f172a] md:text-[30px] md:leading-[1.12]">Can I use this for my local business?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Yes. It works best for local businesses that need customers to browse services, request bookings, ask questions, and receive updates from one branded place.
            </p>
          </div>

          <div className="group rounded-[30px] border border-white/40 bg-white/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Data
                </div>
                <h3 className="text-[20px] font-semibold leading-[1.18] tracking-[-0.03em] text-[#0f172a] md:text-[30px] md:leading-[1.12]">How is my business data handled?</h3>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_8px_18px_rgba(99,102,241,0.11)]">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
            </div>
            <p className="text-[17px] leading-[1.85] text-[#475569]">
              Store data is separated by business account. Uploaded content, customer messages, appointments, announcements, and related records are used to generate and operate your customer hub. Think it Done does not sell customer data.
            </p>

          </div>
        </div>
      </section>

      <section id="trust" className="scroll-mt-28 mx-auto max-w-4xl px-5 pb-12 pt-2 sm:px-6">
        <div className="mb-10 text-center">
          <div className="mb-3 text-sm font-medium tracking-[0.08em] text-indigo-400">
            Trust &amp; Security
          </div>
          <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-[#0f172a] md:text-4xl">
            Review the essentials before you launch
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-[1.9] text-[#475569]">
            Before starting, you can review how payment, support, refund review, cloud service, and business data handling work.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <div className="group rounded-[24px] border border-white/40 bg-white/55 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:rounded-[30px] md:p-6">
            <div className="mb-3 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
              Payment
            </div>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[#0f172a]">
              Clear payment path
            </h3>
            <p className="mt-3 text-sm leading-7 text-[#64748b]">
              Review setup payment, cloud renewal, and refund review rules before using the builder.
            </p>
          </div>

          <div className="group rounded-[24px] border border-white/40 bg-white/55 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:rounded-[30px] md:p-6">
            <div className="mb-3 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
              Data
            </div>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[#0f172a]">
              Business data handling
            </h3>
            <p className="mt-3 text-sm leading-7 text-[#64748b]">
              Store data is separated by business account. Customer data is not sold.
            </p>
          </div>

          <div className="group rounded-[24px] border border-white/40 bg-white/55 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-200/60 hover:shadow-[0_18px_40px_rgba(99,102,241,0.06)] md:rounded-[30px] md:p-6">
            <div className="mb-3 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
              Support
            </div>
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-[#0f172a]">
              Support and issue review
            </h3>
            <p className="mt-3 text-sm leading-7 text-[#64748b]">
              Bugs, payment issues, generation issues, and feature suggestions can be reviewed through support.
            </p>
          </div>
        </div>

      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16 pt-4 sm:px-6 md:pb-20">
        <div className="px-0 py-8 text-center md:px-12 md:py-12">
          <div className="text-sm font-medium tracking-[0.08em] text-indigo-400">Ready to start?</div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.03em] text-[#0f172a] md:text-4xl">
            Ready to launch your branded customer hub?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-[1.9] text-[#475569]">
            Set up your business name, icon, and admin account — then get a live customer hub ready to share.
          </p>
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/builder";
              }}
              className="group relative inline-flex w-full justify-center overflow-hidden rounded-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(236,72,153,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_52px_rgba(236,72,153,0.30)] active:scale-[0.985] sm:w-auto"
            >
              <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.16)_40%,transparent_72%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="relative flex items-center justify-center gap-2">
                <span className="text-[15px] font-bold tracking-[-0.01em]">Enter Builder</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </div>
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-5 py-8 text-center text-sm font-medium tracking-[0.02em] text-[#94a3b8] sm:px-6">
        <div>© 2026 Think it Done. Launch your customer hub faster.</div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <a className="transition hover:text-[#0f172a]" href="/trust">
            Trust &amp; Security
          </a>
          <a className="transition hover:text-[#0f172a]" href="/privacy">
            Privacy Policy
          </a>
          <a className="transition hover:text-[#0f172a]" href="/terms">
            Terms of Service
          </a>
          <a className="transition hover:text-[#0f172a]" href="/refund">
            Refund Policy
          </a>
        </div>

        <div className="mt-3">
          Need help, found a bug, or have a feature suggestion? Contact{" "}
          <a className="transition hover:text-[#0f172a]" href="mailto:support@thinkitdoneapp.com">
            support@thinkitdoneapp.com
          </a>
          .
        </div>
      </footer>
    </main>
  );
}
