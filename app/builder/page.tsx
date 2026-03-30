"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

export default function BuilderPage() {
  const [appName, setAppName] = useState("");
  const [moduleName, setModuleName] = useState("feature-showcase");
  const [uiPackName, setUiPackName] = useState("ui-pack-showcase-greenpink");
  const [plan, setPlan] = useState("pro");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const planRef = useRef("pro");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextPlan = (params.get("plan") || "pro").toLowerCase();

    setAppName(params.get("appName") || "");
    setModuleName(params.get("module") || "feature-showcase");
    setUiPackName(params.get("uiPack") || "ui-pack-showcase-greenpink");
    setPlan(nextPlan);
    planRef.current = nextPlan;
    setAdminName(params.get("adminName") || "");
    setAdminPassword(params.get("adminPassword") || "");
  }, []);

  const selectedModuleClass =
    "rounded-full border border-indigo-400 bg-[linear-gradient(135deg,rgba(224,231,255,0.95),rgba(238,242,255,0.98))] px-4 py-2 text-indigo-700 shadow-[0_0_0_2px_rgba(99,102,241,0.12),0_10px_24px_rgba(99,102,241,0.12)] transition hover:-translate-y-0.5";
  const unselectedModuleClass =
    "rounded-full border border-slate-200 bg-white px-4 py-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700";

  const buildParams = {
    appName: appName.trim() || "Untitled App",
    module: moduleName,
    uiPack: uiPackName,
    plan: planRef.current,
    adminName: adminName.trim(),
    adminPassword,
  };

  const handleGenerate = async () => {
    if (isSubmitting) return;

    const currentPlan = planRef.current;

    if (currentPlan === "free") {
      try {
        setIsSubmitting(true);

        const response = await fetch("/api/start-build", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildParams),
        });

        const data = await response.json();

        if (!response.ok || !data?.ok || !data?.runId) {
          throw new Error(data?.error || "Failed to start build.");
        }

        window.location.href = `/generating?runId=${encodeURIComponent(data.runId)}`;
      } catch (error) {
        alert(error instanceof Error ? error.message : "Failed to start build.");
        setIsSubmitting(false);
      }

      return;
    }

    const params = new URLSearchParams(buildParams);
    window.location.href = `/checkout?${params.toString()}`;
  };

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
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
            <a href="/" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-[#0f172a]">
              Home
            </a>
            <a href="/builder" className="rounded-full bg-white px-3 py-1.5 text-[#0f172a] shadow-[0_6px_16px_rgba(15,23,42,0.06)]">
              Builder
            </a>
            <a href="/result" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-[#0f172a]">
              Result
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="hidden rounded-full border border-slate-200 bg-white/60 px-4 py-2 text-sm font-medium tracking-[0.01em] text-[#475569] backdrop-blur transition hover:bg-white md:inline-flex"
            >
              Save Draft
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isSubmitting}
              className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold tracking-[0.01em] text-white shadow-[0_10px_24px_rgba(217,70,239,0.25)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Starting Build..." : "Continue"}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-10">
        <div className="mb-10 text-center">
          <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">
            Build your native app in seconds
          </h1>
          <p className="mt-4 text-base text-[#64748b]">
            Configure your app and generate a native APK instantly
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 shadow backdrop-blur">
            <span className="text-indigo-500">Name</span>
            <span>→</span>
            <span>Icon</span>
            <span>→</span>
            <span>Module</span>
            <span>→</span>
            <span>UI</span>
            <span>→</span>
            <span>Admin</span>
            <span>→</span>
            <span>Plan</span>
            <span>→</span>
            <span>Build</span>
          </div>
        </div>

        <div className="max-w-xl mx-auto">
          <section className="relative p-2 md:p-4">
            <div className="space-y-7">
              <div className="space-y-2">
                <label className="text-sm font-semibold">App Name</label>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_24px_rgba(15,23,42,0.04)] transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100/80">
                  <input
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    placeholder="Enter app name"
                    className="w-full bg-transparent outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">App Icon</label>
                <div className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:border-indigo-300 hover:shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-[11px] font-semibold text-slate-500">
                    Icon
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#0f172a]">Upload app icon</div>
                    <div className="mt-0.5 text-xs text-slate-400">PNG / JPG / SVG · 1024×1024 recommended</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 bg-slate-100/80 px-3 py-1.5 text-xs font-medium text-[#0f172a] transition group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                  >
                    Choose
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Logic Module</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModuleName("basic-module")}
                    className={moduleName === "basic-module" ? selectedModuleClass : unselectedModuleClass}
                  >
                    basic-module
                  </button>
                  <button
                    type="button"
                    onClick={() => setModuleName("feature-showcase")}
                    className={moduleName === "feature-showcase" ? selectedModuleClass : unselectedModuleClass}
                  >
                    feature-showcase
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">UI Pack</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setUiPackName("ui-pack-basic")}
                    className={uiPackName === "ui-pack-basic" ? selectedModuleClass : unselectedModuleClass}
                  >
                    ui-pack-basic
                  </button>
                  <button
                    type="button"
                    onClick={() => setUiPackName("ui-pack-showcase-greenpink")}
                    className={uiPackName === "ui-pack-showcase-greenpink" ? selectedModuleClass : unselectedModuleClass}
                  >
                    ui-pack-showcase-greenpink
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Admin Name</label>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_24px_rgba(15,23,42,0.04)] transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100/80">
                  <input
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder="Enter admin name"
                    className="w-full bg-transparent outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Admin Password</label>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_24px_rgba(15,23,42,0.04)] transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100/80">
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="w-full bg-transparent outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

              <div>
                <div className="mb-3 flex justify-between text-xs text-slate-400">
                  <span>Choose plan</span>
                  <span>REQUIRED</span>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      planRef.current = "free";
                      setPlan("free");
                    }}
                    className={
                      plan === "free"
                        ? "rounded-xl border border-indigo-400 bg-[linear-gradient(135deg,rgba(224,231,255,0.95),rgba(238,242,255,0.98))] p-4 text-left text-indigo-700 shadow-[0_0_0_2px_rgba(99,102,241,0.12),0_10px_24px_rgba(99,102,241,0.12)] transition hover:-translate-y-0.5"
                        : "rounded-xl border border-slate-200 bg-white/80 p-4 text-left opacity-90 transition hover:border-slate-300 hover:bg-white"
                    }
                  >
                    <div className="font-semibold text-[#0f172a]">Free</div>
                    <div className="text-xs text-slate-400">Limited</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      planRef.current = "pro";
                      setPlan("pro");
                    }}
                    className={
                      plan === "pro"
                        ? "relative rounded-xl border border-fuchsia-400 bg-gradient-to-br from-fuchsia-50 to-pink-50 p-4 text-left shadow-[0_0_0_1px_rgba(217,70,239,0.18),0_18px_38px_rgba(217,70,239,0.14)] transition hover:-translate-y-0.5"
                        : "relative rounded-xl border border-slate-200 bg-white/80 p-4 text-left opacity-90 transition hover:border-slate-300 hover:bg-white"
                    }
                  >
                    <div className="mb-2 inline-flex rounded-full border border-fuchsia-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600">
                      Recommended
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-fuchsia-700">Pro</div>
                        <div className="mt-1 text-xs text-fuchsia-600">Full APK</div>
                      </div>
                      {plan === "pro" ? (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-600 text-xs text-white">
                          ✓
                        </div>
                      ) : null}
                    </div>
                  </button>
                </div>

                <div className="mb-3 text-center text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                  Ready to build
                </div>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isSubmitting}
                  className="group relative w-full overflow-hidden rounded-[22px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 py-5 text-lg font-semibold text-white shadow-[0_25px_60px_rgba(236,72,153,0.3)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <div className="absolute inset-0 rounded-[22px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 opacity-30 blur-xl" />
                  <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.18)_40%,transparent_72%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="relative flex items-center justify-center gap-2">
                    {isSubmitting ? "Starting Build..." : "Generate APK"}
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </button>

                <div className="mt-3 text-center text-xs text-slate-400">~30s build time</div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
