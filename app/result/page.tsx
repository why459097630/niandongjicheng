"use client";

import { useEffect, useState } from "react";
import { Download, RotateCcw, History, Share2, CheckCircle2 } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";

type BuildStatusResponse = {
  ok: boolean;
  runId?: string;
  stage?: string;
  message?: string;
  artifactUrl?: string | null;
  downloadUrl?: string | null;
  appName?: string;
  moduleName?: string;
  uiPackName?: string;
  adminName?: string;
  adminPassword?: string;
  error?: string;
};

export default function ResultPage() {
  const [runId, setRunId] = useState("");
  const [appName, setAppName] = useState("Untitled App");
  const [moduleName, setModuleName] = useState("feature-showcase");
  const [uiPackName, setUiPackName] = useState("ui-pack-showcase-greenpink");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentRunId = params.get("runId") || "";

    setRunId(currentRunId);

    if (!currentRunId) {
      setError("Missing runId.");
      setLoading(false);
      return;
    }

    const resultOpenKey = `ndjc_result_opened_${currentRunId}`;
    const shouldLogOpen =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(resultOpenKey) !== "1";

    const requestUrl = shouldLogOpen
      ? `/api/build-status?runId=${encodeURIComponent(currentRunId)}&event=result_opened`
      : `/api/build-status?runId=${encodeURIComponent(currentRunId)}`;

    fetch(requestUrl, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data: BuildStatusResponse = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Failed to load build result.");
        }

        setAppName(data.appName || "Untitled App");
        setModuleName(data.moduleName || "feature-showcase");
        setUiPackName(data.uiPackName || "ui-pack-showcase-greenpink");
        setAdminName(data.adminName || "");
        setAdminPassword(data.adminPassword || "");
        setDownloadUrl(data.downloadUrl || "");

        if (shouldLogOpen && typeof window !== "undefined") {
          window.sessionStorage.setItem(resultOpenKey, "1");
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load build result.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader
        showAuthControls={false}
        navItems={[
          { label: "Home", href: "/" },
          { label: "History", href: "/history" },
        ]}
        rightSlot={
          <div className="rounded-full border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs font-medium text-emerald-600 shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
            Build Completed
          </div>
        }
      />

      <section className="relative z-10 mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/65 shadow-[0_30px_80px_rgba(16,185,129,0.18)] backdrop-blur-xl">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-400 text-white shadow-[0_28px_60px_rgba(16,185,129,0.22)] ring-8 ring-emerald-100/70">
              <CheckCircle2 className="h-8 w-8" />
            </div>
          </div>
        </div>

        <h1 className="text-5xl font-extrabold tracking-[-0.05em]">
          Your app is ready 🚀
        </h1>

        <p className="mt-3 text-lg text-[#64748b]">
          You just built a real Android app in seconds. Ready to install and use.
        </p>

        {runId ? (
          <div className="mt-4 inline-flex items-center rounded-full border border-slate-200/80 bg-white/75 px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] text-slate-400 shadow-[0_6px_16px_rgba(15,23,42,0.04)] backdrop-blur">
            RUN ID · {runId}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            Loading build result...
          </div>
        ) : null}

        {error ? (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        <div className="mt-10 space-y-4">
          <div className="mb-2 text-sm font-medium text-[#94a3b8]">Ready for Android install</div>

          {downloadUrl ? (
            <a
              href={`/api/build-status?runId=${encodeURIComponent(runId)}&download=1&event=result_download`}
              className="group relative block w-full overflow-hidden rounded-[24px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 px-6 py-5 text-lg font-semibold text-white shadow-[0_25px_60px_rgba(236,72,153,0.25)] transition hover:scale-[1.04] hover:shadow-[0_35px_90px_rgba(236,72,153,0.35)] active:scale-[0.98]"
            >
              <div className="relative flex items-center justify-center gap-2">
                <Download className="h-5 w-5" />
                Download & install your app
              </div>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="w-full rounded-[24px] border border-slate-200 bg-slate-100 px-6 py-5 text-lg font-semibold text-slate-400"
            >
              Download not available
            </button>
          )}

          <div className="mt-1 text-xs text-[#94a3b8]">
            After download, open the APK file on your Android device to install
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/builder";
              }}
              className="flex items-center justify-center gap-2 rounded-2xl border border-fuchsia-200 bg-[linear-gradient(135deg,rgba(250,245,255,0.98),rgba(253,242,248,0.98))] px-4 py-3 text-sm font-semibold text-fuchsia-700 shadow-[0_10px_28px_rgba(217,70,239,0.10)] hover:border-fuchsia-300 hover:shadow-[0_14px_32px_rgba(217,70,239,0.14)]"
            >
              <RotateCcw className="h-4 w-4" />
              Generate another
            </button>

            <button
              type="button"
              onClick={() => {
                window.location.href = "/history";
              }}
              className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#475569] hover:border-indigo-300 hover:text-indigo-600"
            >
              <History className="h-4 w-4" />
              View history
            </button>
          </div>

          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-3 text-sm text-slate-400 hover:border-indigo-300 hover:text-indigo-600"
          >
            <Share2 className="h-4 w-4" />
            Show what you just built
          </button>
        </div>

        <div className="mt-12 text-center">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">App Info</div>
          <div className="text-sm text-slate-500">
            {appName} · {moduleName} · {uiPackName}
          </div>
          <div className="mt-2 text-sm text-slate-500">
            Admin: {adminName || "Not set"}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            Password: {adminPassword || "Not set"}
          </div>
        </div>
      </section>
    </main>
  );
}
