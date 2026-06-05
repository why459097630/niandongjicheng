"use client";

import { useEffect, useState } from "react";
import { Download, RotateCcw, History, CheckCircle2, TriangleAlert } from "lucide-react";
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
  error?: string;
};

const CHECKOUT_APP_NAME_STORAGE_KEY = "ndjc_checkout_app_name";
const CHECKOUT_MODULE_STORAGE_KEY = "ndjc_checkout_module";
const CHECKOUT_UI_PACK_STORAGE_KEY = "ndjc_checkout_ui_pack";
const CHECKOUT_PLAN_STORAGE_KEY = "ndjc_checkout_plan";
const CHECKOUT_ADMIN_NAME_STORAGE_KEY = "ndjc_checkout_admin_name";
const CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY = "ndjc_checkout_admin_password";

const RESULT_SUPPORT_MESSAGE = "Please contact support through the chat in the bottom-right corner.";

export default function ResultPage() {
  const [runId, setRunId] = useState("");
  const [appName, setAppName] = useState("Untitled Hub");
  const [moduleName, setModuleName] = useState("feature-showcase");
  const [uiPackName, setUiPackName] = useState("ui-pack-showcase-greenpink");
  const [adminName, setAdminName] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const hasError = Boolean(error);


useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const currentRunId = params.get("runId") || "";
  const isPaidResult = params.get("paid") === "1";
  const paymentProvider = params.get("provider") || "";
  const paypalOrderId = params.get("token") || "";
  const requestStartTime = Date.now();

  setRunId(currentRunId);

  if (!currentRunId) {
    setError(RESULT_SUPPORT_MESSAGE);
    setLoading(false);
    return;
  }

  const storedAppName = window.sessionStorage.getItem(CHECKOUT_APP_NAME_STORAGE_KEY) || "";
  const storedModuleName = window.sessionStorage.getItem(CHECKOUT_MODULE_STORAGE_KEY) || "";
  const storedUiPackName = window.sessionStorage.getItem(CHECKOUT_UI_PACK_STORAGE_KEY) || "";
  const storedAdminName = window.sessionStorage.getItem(CHECKOUT_ADMIN_NAME_STORAGE_KEY) || "";
  window.sessionStorage.removeItem(CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY);

  const resultOpenKey = `ndjc_result_opened_${currentRunId}`;
  const shouldLogOpen =
    typeof window !== "undefined" &&
    window.sessionStorage.getItem(resultOpenKey) !== "1";

  let cancelled = false;
  let retryTimer: number | null = null;

  const capturePayPalOrderIfNeeded = async () => {
    if (paymentProvider !== "paypal" || !paypalOrderId) {
      return;
    }

    const captureKey = `ndjc_paypal_capture_${paypalOrderId}`;

    if (window.sessionStorage.getItem(captureKey) === "1") {
      return;
    }

    window.sessionStorage.setItem(captureKey, "1");

    const response = await fetch("/api/paypal/capture-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paypalOrderId,
        expectedKind: "generate_app",
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      window.sessionStorage.removeItem(captureKey);
      throw new Error(data?.error || "Failed to capture PayPal payment.");
    }
  };

  const loadResult = async (attempt: number) => {
    try {
      const query = new URLSearchParams({
        runId: currentRunId,
      });

      if (shouldLogOpen && attempt === 0) {
        query.set("event", "result_opened");
      }

      if (isPaidResult) {
        query.set("paid", "1");
        query.set("t", String(requestStartTime));
      }

      const res = await fetch(`/api/build-status?${query.toString()}`, {
        cache: "no-store",
      });

      const data: BuildStatusResponse = await res.json();

      if (!res.ok || !data.ok) {
        if (cancelled) {
          return;
        }

        setError(RESULT_SUPPORT_MESSAGE);
        setDownloadUrl("");
        setLoading(false);
        return;
      }

      if (cancelled) {
        return;
      }

      setAppName(data.appName || storedAppName || "Untitled Hub");
      setModuleName(data.moduleName || storedModuleName || "feature-showcase");
      setUiPackName(data.uiPackName || storedUiPackName || "ui-pack-showcase-greenpink");
      setAdminName(data.adminName || storedAdminName || "");
      setDownloadUrl(data.downloadUrl || "");

      if (shouldLogOpen && attempt === 0 && typeof window !== "undefined") {
        window.sessionStorage.setItem(resultOpenKey, "1");
      }

      if (data.stage === "failed") {
        throw new Error(RESULT_SUPPORT_MESSAGE);
      }

      if (isPaidResult && data.stage !== "success" && attempt < 60) {
        retryTimer = window.setTimeout(() => {
          loadResult(attempt + 1);
        }, 2000);
        return;
      }

      setLoading(false);
    } catch {
      if (cancelled) {
        return;
      }

      setError(RESULT_SUPPORT_MESSAGE);
      setLoading(false);
    }
  };

  const startResultFlow = async () => {
    try {
      await capturePayPalOrderIfNeeded();

      if (cancelled) {
        return;
      }

      await loadResult(0);
    } catch {
      if (cancelled) {
        return;
      }

      setError(RESULT_SUPPORT_MESSAGE);
      setLoading(false);
    }
  };

  void startResultFlow();

  return () => {
    cancelled = true;

    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
    }
  };
}, []);

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader
        nextPath="/result"
      />

      <section className="relative z-10 mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="mb-6 flex justify-center">
          <div
            className={
              hasError
                ? "flex h-24 w-24 items-center justify-center rounded-full bg-white/65 shadow-[0_30px_80px_rgba(239,68,68,0.14)] backdrop-blur-xl"
                : "flex h-24 w-24 items-center justify-center rounded-full bg-white/65 shadow-[0_30px_80px_rgba(16,185,129,0.18)] backdrop-blur-xl"
            }
          >
            <div
              className={
                hasError
                  ? "flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-400 text-white shadow-[0_28px_60px_rgba(239,68,68,0.20)] ring-8 ring-red-100/70"
                  : "flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-400 text-white shadow-[0_28px_60px_rgba(16,185,129,0.22)] ring-8 ring-emerald-100/70"
              }
            >
              {hasError ? <TriangleAlert className="h-8 w-8" /> : <CheckCircle2 className="h-8 w-8" />}
            </div>
          </div>
        </div>

        <h1 className="text-5xl font-extrabold tracking-[-0.05em]">
          {hasError ? "Generation failed" : "Your customer hub is ready 🚀"}
        </h1>

        <p className="mt-3 text-lg text-[#64748b]">
          {hasError
            ? "This generation could not be completed."
            : "Your branded customer hub has been generated. Download the package to get the launch guide, live URL, and QR code."}
        </p>

        {runId ? (
          <div className="mt-4 inline-flex items-center rounded-full border border-slate-200/80 bg-white/75 px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] text-slate-400 shadow-[0_6px_16px_rgba(15,23,42,0.04)] backdrop-blur">
            RUN ID · {runId}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            Preparing your customer hub result...
          </div>
        ) : null}

        {error ? (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {error}
          </div>
        ) : null}

        <div className="mt-10 space-y-4">
          <div className="mb-2 text-sm font-medium text-[#94a3b8]">
            {hasError ? "Package unavailable" : downloadUrl ? "Package ready to download" : "Preparing your package"}
          </div>

          {downloadUrl && !hasError ? (
            <a
              href={`/api/build-status?runId=${encodeURIComponent(runId)}&download=1&event=result_download`}
              className="group relative block w-full overflow-hidden rounded-[24px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 px-6 py-5 text-lg font-semibold text-white shadow-[0_25px_60px_rgba(236,72,153,0.25)] transition hover:scale-[1.04] hover:shadow-[0_35px_90px_rgba(236,72,153,0.35)] active:scale-[0.98]"
            >
              <div className="relative flex items-center justify-center gap-2">
                <Download className="h-5 w-5" />
                Download customer hub package
              </div>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="w-full rounded-[24px] border border-slate-200 bg-slate-100 px-6 py-5 text-lg font-semibold text-slate-400"
            >
              {hasError ? "Download unavailable" : "Preparing download package..."}
            </button>
          )}

          <div className="mt-1 text-xs text-[#94a3b8]">
            The package includes your launch guide, customer hub URL, and QR code.
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
              Create another hub
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

        </div>

        <div className="mt-12 text-center">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">Customer Hub Info</div>
          <div className="text-sm text-slate-500">
            {appName} · Local Business Customer Hub · Soft Green Pink Style
          </div>
          <div className="mt-2 text-sm text-slate-500">
            Admin: {adminName || "Not set"}
          </div>
        </div>
      </section>
    </main>
  );
}
