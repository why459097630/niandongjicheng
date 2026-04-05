"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Sparkles } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";

const ICON_DATA_URL_STORAGE_KEY = "ndjc_builder_icon_data_url";
const ICON_FILE_NAME_STORAGE_KEY = "ndjc_builder_icon_file_name";

export default function CheckoutPage() {
  const [appName, setAppName] = useState("Untitled App");
  const [moduleName, setModuleName] = useState("feature-showcase");
  const [uiPackName, setUiPackName] = useState("ui-pack-showcase-greenpink");
  const [plan, setPlan] = useState("pro");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [iconFileName, setIconFileName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAppName(params.get("appName") || "Untitled App");
    setModuleName(params.get("module") || "feature-showcase");
    setUiPackName(params.get("uiPack") || "ui-pack-showcase-greenpink");
    setPlan((params.get("plan") || "pro").toLowerCase());
    setAdminName(params.get("adminName") || "");
    setAdminPassword(params.get("adminPassword") || "");

    const storedIconDataUrl = sessionStorage.getItem(ICON_DATA_URL_STORAGE_KEY);
    const storedIconFileName = sessionStorage.getItem(ICON_FILE_NAME_STORAGE_KEY) || "";

    if (storedIconDataUrl) {
      setIconDataUrl(storedIconDataUrl);
      setIconFileName(storedIconFileName);
    }
  }, []);

  const modeLabel = plan === "free" ? "Free Trial" : "Paid Purchase";
  const planLabel = plan === "free" ? "Free" : "Pro";

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader
        nextPath="/checkout"
        navItems={[
          { label: "Home", href: "/" },
          { label: "Builder", href: "/builder" },
          { label: "Checkout", href: "/checkout", isActive: true },
        ]}
      />

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-10">
        <div className="mb-10 text-center">
          <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">
            Complete your purchase
          </h1>
          <p className="mt-4 text-base text-[#64748b]">
            Review your selected build package before continuing to payment
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 shadow backdrop-blur">
            <span>Builder</span>
            <span>→</span>
            <span className="text-fuchsia-600">Checkout</span>
            <span>→</span>
            <span>Build</span>
            <span>→</span>
            <span>Download</span>
          </div>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
          <div className="p-2 md:p-4">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Order Summary
                </div>
                <h2 className="text-2xl font-bold tracking-[-0.03em] text-[#0f172a]">Your selected build</h2>
                <p className="mt-2 text-sm leading-7 text-[#64748b]">
                  This payment unlocks one full NDJC Pro build package for the configuration below.
                </p>
              </div>
              <div className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)] md:flex">
                <Sparkles className="h-5 w-5" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[24px] bg-[linear-gradient(135deg,rgba(99,102,241,0.98),rgba(217,70,239,0.98))] p-5 text-white shadow-[0_18px_40px_rgba(124,58,237,0.20)]">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/75">Selected app</div>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{appName}</div>
                <div className="mt-2 text-sm leading-7 text-white/82">
                  {moduleName} logic with {uiPackName}, prepared for full APK output.
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">App Name</div>
                  <div className="mt-2 text-sm font-semibold text-[#0f172a]">{appName}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Plan</div>
                  <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600">
                    <Check className="h-3.5 w-3.5" />
                    {planLabel}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Logic Module</div>
                  <div className="mt-2 text-sm font-semibold text-[#0f172a]">{moduleName}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">UI Pack</div>
                  <div className="mt-2 text-sm font-semibold text-[#0f172a]">{uiPackName}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)] sm:col-span-2">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">App Icon</div>
                  <div className="mt-2 text-sm font-semibold text-[#0f172a]">
                    {iconFileName || "No custom icon selected"}
                  </div>
                </div>
              </div>

              <div className="my-6 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <ShieldCheck className="h-4.5 w-4.5 text-fuchsia-500" />
                  <div className="text-sm font-semibold text-[#0f172a]">Included in {planLabel} build</div>
                </div>
                <div className="space-y-3 text-sm text-[#475569]">
                  <div className="flex items-center justify-between gap-3">
                    <span>Full APK build output</span>
                    <Check className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Downloadable build package</span>
                    <Check className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Commercial-ready starter package</span>
                    <Check className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Build mode</span>
                    <span className="text-sm font-semibold text-[#0f172a]">{modeLabel}</span>
                  </div>
                </div>
              </div>

              {submitError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {submitError}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-8 scale-[1.04]">
            <section className="overflow-hidden rounded-[32px] bg-white/50 shadow-[0_18px_50px_rgba(236,72,153,0.14)] backdrop-blur-xl">
              <div className="border-b border-slate-200/70 px-6 py-5">
                <div className="mb-3 inline-flex rounded-full border border-fuchsia-200/70 bg-fuchsia-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-fuchsia-600">
                  Payment
                </div>
                <h2 className="text-2xl font-bold tracking-[-0.03em] text-[#0f172a]">Pay and build</h2>
              </div>

              <div className="space-y-5 px-6 py-6">
                <div className="rounded-[24px] border border-slate-200/70 bg-white/90 p-5 shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
                  <div className="text-3xl font-extrabold tracking-[-0.03em] text-[#0f172a]">
                    {plan === "free" ? "$0.00" : "$9.90"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">One-time payment</div>
                  <div className="mt-2 text-[11px] text-slate-400">No subscription · No hidden fees</div>
                </div>

                <div className="rounded-[24px] bg-[linear-gradient(135deg,rgba(250,245,255,0.98),rgba(253,242,248,0.98))] p-5 shadow-[0_18px_40px_rgba(217,70,239,0.10)]">
                  <div className="mb-2 inline-flex rounded-full border border-fuchsia-200/80 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600">
                    Most popular
                  </div>
                  <div className="text-sm font-semibold text-fuchsia-700">One payment, one {planLabel} build</div>
                  <div className="mt-2 text-sm leading-7 text-fuchsia-700/72">
                    After payment, the flow continues directly into the NDJC build pipeline.
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={async () => {
                      try {
                        setIsSubmitting(true);
                        setSubmitError("");

                        const response = await fetch("/api/start-build", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            appName,
                            module: moduleName,
                            uiPack: uiPackName,
                            plan,
                            adminName,
                            adminPassword,
                            iconDataUrl,
                          }),
                        });

                        const data = await response.json();

                        if (!response.ok || !data.ok || !data.runId) {
                          throw new Error(data.error || "Failed to start build.");
                        }

                        window.location.href = `/generating?runId=${encodeURIComponent(data.runId)}`;
                      } catch (error) {
                        setSubmitError(error instanceof Error ? error.message : "Failed to start build.");
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                    className="group relative w-full overflow-hidden rounded-[22px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 px-6 py-4 text-sm font-semibold text-white shadow-[0_28px_60px_rgba(236,72,153,0.32)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_35px_80px_rgba(236,72,153,0.45)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.16)_40%,transparent_72%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="relative flex items-center justify-center gap-2">
                      <span className="text-[15px]">{isSubmitting ? "Starting build..." : "Pay & Build"}</span>
                      <ArrowRight className="h-[15px] w-[15px] text-white/80 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams({
                        appName,
                        module: moduleName,
                        uiPack: uiPackName,
                        plan,
                        adminName,
                        adminPassword,
                      });
                      window.location.href = `/builder?${params.toString()}`;
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-[20px] border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#475569] transition hover:border-indigo-300 hover:text-indigo-600"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Builder
                  </button>
                </div>

                <div className="text-center text-[11px] leading-6 text-[#94a3b8]">
                  🔒 Secure checkout · Instant build after payment
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
