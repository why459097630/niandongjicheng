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

      <button
        type="button"
        onClick={() => {
          window.location.href = "/builder";
        }}
        className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold tracking-[0.01em] text-white shadow-[0_10px_24px_rgba(217,70,239,0.25)] transition hover:opacity-90"
      >
        Get Started
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  </div>
</header>

        <section className="relative z-10 mx-auto grid min-h-[78vh] max-w-7xl items-center gap-14 px-6 py-12 md:grid-cols-2">
          <div>
            <div className="mb-4 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium tracking-[0.06em] text-[#64748b]">
              One sentence to native Android app
            </div>

            <h1 className="mb-6 text-5xl font-extrabold tracking-[-0.04em] leading-[0.98] md:text-7xl">
              Build your app
              <br />
              from a single prompt
            </h1>

            <p className="mb-8 max-w-xl text-lg leading-[1.9] text-[#475569]">
              NDJC turns your idea into a real Android app flow:
              prompt in, app generated, packaged, and ready to download.
            </p>

            <div className="mb-6 max-w-[560px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300 bg-gradient-to-r from-fuchsia-50 to-pink-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-fuchsia-600 shadow-[0_6px_16px_rgba(217,70,239,0.15)]">
                Builder
              </div>

              <h3 className="mt-5 max-w-[520px] text-[31px] font-bold tracking-[-0.055em] leading-[0.98] text-[#0f172a] sm:text-[40px]">
                Start your first app in seconds
              </h3>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                <span className="text-indigo-500">Define</span>
                <span className="opacity-35">→</span>
                <span>Configure</span>
                <span className="opacity-35">→</span>
                <span>Customize</span>
                <span className="opacity-35">→</span>
                <span>Checkout</span>
                <span className="opacity-35">→</span>
                <span>Generate</span>
              </div>

              <p className="mt-4 max-w-[460px] text-[13px] font-medium tracking-[0.01em] text-[#64748b]">
                ~30 seconds · No code required
              </p>
              <p className="mt-2 max-w-[460px] text-[12px] font-medium tracking-[0.01em] text-[#94a3b8]">
                Real-time preview as you build
              </p>

              <div className="mt-7 flex items-center gap-4">
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
                  <span>Builder</span>
                  <span className="opacity-40">→</span>
                  <span>Checkout</span>
                  <span className="opacity-40">→</span>
                  <span>Generate</span>
                  <span className="opacity-40">→</span>
                  <span>Download</span>
                </div>
              </div>
            </div>
          </div>

          <div className="relative flex justify-center md:justify-end">
            <div className="relative w-full max-w-[420px] md:translate-x-6">
              <div className="absolute inset-x-8 top-6 h-24 rounded-full bg-[radial-gradient(circle,rgba(244,114,182,0.22),transparent_68%)] blur-3xl" />

              <div className="relative mx-auto aspect-[9/19.5] w-[320px] rounded-[38px] border border-white/40 bg-white/30 p-3 shadow-[0_28px_90px_rgba(15,23,42,0.16)] backdrop-blur-2xl">
                <div className="flex h-full flex-col rounded-[32px] border border-black/10 bg-[#10131c] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] bg-[#0f1118] text-white">
                    <div className="absolute left-1/2 top-3 z-20 h-1.5 w-20 -translate-x-1/2 rounded-full bg-white/12" />

                    <div className="flex items-center justify-between border-b border-white/8 px-4 pb-3 pt-6">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Preview</div>
                        <div className="mt-1 text-sm font-medium text-white/90">ui-pack-showcase-greenpink</div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/65">
                        Auto demo
                      </div>
                    </div>

                    <div className="flex-1 overflow-hidden px-4 py-4">
                      {activePreview === "home" && (
                        <div className="space-y-4">
                          <div className="rounded-[24px] bg-gradient-to-r from-fuchsia-500 to-pink-500 p-4 text-white shadow-[0_18px_40px_rgba(236,72,153,0.28)]">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-white/75">Store home</div>
                            <div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Beauty Studio</div>
                            <div className="mt-1 text-sm text-white/80">Storefront · Products · Announcements</div>
                            <div className="mt-4 flex items-center gap-2">
                              <div className="rounded-full bg-white/18 px-3 py-1 text-xs text-white/90">Open today</div>
                              <div className="rounded-full bg-white/18 px-3 py-1 text-xs text-white/90">24 services</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Top card</div>
                              <div className="mt-2 text-sm font-medium text-white">Featured services</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Live chat</div>
                              <div className="mt-2 text-sm font-medium text-white">Customer support</div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <div>
                                <div className="text-sm font-medium text-white">Popular services</div>
                                <div className="text-xs text-white/45">What customers see first</div>
                              </div>
                              <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">3 cards</div>
                            </div>
                            <div className="space-y-3">
                              <div className="rounded-xl bg-white/6 p-3">
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-pink-400 to-fuchsia-500" />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-white">Skin Care Package</div>
                                    <div className="text-xs text-white/45">Popular card component preview</div>
                                  </div>
                                  <div className="text-xs text-white/75">$29</div>
                                </div>
                              </div>
                              <div className="rounded-xl bg-white/6 p-3">
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-400 to-indigo-500" />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-white">Hair Styling</div>
                                    <div className="text-xs text-white/45">List row and detail entry preview</div>
                                  </div>
                                  <div className="text-xs text-white/75">$18</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {activePreview === "services" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Services</div>
                              <div className="mt-1 text-xl font-semibold tracking-[-0.03em] text-white">Browse treatments</div>
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-white/70">12 items</div>
                          </div>

                          <div className="space-y-3">
                            <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                              <div className="flex items-center gap-3">
                                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-pink-400 to-fuchsia-500" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-medium text-white">Glow Facial</div>
                                      <div className="mt-1 text-xs text-white/45">Hydrating treatment · 45 mins</div>
                                    </div>
                                    <div className="text-sm font-semibold text-white">$42</div>
                                  </div>
                                  <div className="mt-3 flex items-center gap-2">
                                    <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">Popular</div>
                                    <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">New</div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                              <div className="flex items-center gap-3">
                                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-medium text-white">Hair Styling Set</div>
                                      <div className="mt-1 text-xs text-white/45">Styling + wash · 30 mins</div>
                                    </div>
                                    <div className="text-sm font-semibold text-white">$26</div>
                                  </div>
                                  <div className="mt-3 flex items-center gap-2">
                                    <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">Fast booking</div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-center text-xs text-white/45">
                              More cards continue below in the generated app
                            </div>
                          </div>
                        </div>
                      )}

                      {activePreview === "chat" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Chat</div>
                              <div className="mt-1 text-sm font-medium text-white">Beauty Studio Support</div>
                            </div>
                            <div className="rounded-full bg-fuchsia-500/18 px-2 py-1 text-[10px] font-medium text-fuchsia-200">2 unread</div>
                          </div>

                          <div className="space-y-3 rounded-[24px] border border-white/10 bg-white/5 p-4">
                            <div className="flex justify-start">
                              <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white/8 px-3 py-2 text-sm text-white/85">
                                Hi, do you have an opening this afternoon?
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <div className="max-w-[78%] rounded-2xl rounded-br-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-2 text-sm text-white shadow-[0_10px_24px_rgba(236,72,153,0.22)]">
                                Yes, we have a 3:30 slot available.
                              </div>
                            </div>
                            <div className="flex justify-start">
                              <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white/8 px-3 py-2 text-sm text-white/85">
                                Great, please reserve it for me.
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                            <div className="h-9 flex-1 rounded-xl bg-white/6 px-3 py-2 text-sm text-white/35">Type a message...</div>
                            <div className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-2 text-xs font-medium text-white">Send</div>
                          </div>
                        </div>
                      )}

                      {activePreview === "announcement" && (
                        <div className="space-y-4">
                          <div className="rounded-[24px] border border-white/10 bg-gradient-to-br from-white/8 to-white/4 p-4">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Announcement</div>
                            <div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">Summer sale banner</div>
                            <div className="mt-2 text-sm leading-7 text-white/70">
                              New seasonal promotion now live. Push this update to customers from the merchant console.
                            </div>
                          </div>

                          <div className="rounded-[24px] bg-gradient-to-r from-fuchsia-500 to-pink-500 p-4 text-white shadow-[0_18px_40px_rgba(236,72,153,0.25)]">
                            <div className="text-xs uppercase tracking-[0.16em] text-white/75">Featured update</div>
                            <div className="mt-2 text-lg font-semibold">Book this week and get 15% off</div>
                            <div className="mt-2 text-sm text-white/80">Perfect for promos, banners, and store-wide updates.</div>
                          </div>

                          <div className="space-y-3">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="text-sm font-medium text-white">Push notification ready</div>
                              <div className="mt-1 text-xs text-white/45">Customers can receive updates directly from the generated app.</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="text-sm font-medium text-white">Designed to match the UI pack</div>
                              <div className="mt-1 text-xs text-white/45">Brand styling, card rhythm, and content hierarchy stay consistent.</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-white/8 px-4 py-3">
                      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                        <div className="flex items-center gap-2">
                          {previewScreens.map((screen) => (
                            <div
                              key={screen}
                              className={`h-2 rounded-full transition-all duration-500 ${
                                activePreview === screen ? "w-6 bg-fuchsia-400" : "w-2 bg-white/18"
                              }`}
                            />
                          ))}
                        </div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                          {activePreview === "home" && "Home screen"}
                          {activePreview === "services" && "Services list"}
                          {activePreview === "chat" && "Chat flow"}
                          {activePreview === "announcement" && "Announcement"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
