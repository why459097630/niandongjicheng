"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Download, History, LoaderCircle, TriangleAlert, ArrowRight } from "lucide-react";
import AuthControls from "@/components/auth/AuthControls";
import SiteHeader from "@/components/layout/SiteHeader";
import { createClient } from "@/lib/supabase/client";

type BuildItem = {
  storeId?: string;
  runId: string;
  appName: string;
  stage: "success" | "failed" | "running" | "queued";
  createdAt: string;
  completedAt?: string;
  failedStep?:
    | "preparing_request"
    | "processing_identity"
    | "matching_logic_module"
    | "applying_ui_pack"
    | "preparing_services"
    | "building_apk";
  cloudStatus?: "active" | "read_only" | "deleted";
  cloudExpiresAt?: string;
  cloudDeletesAt?: string;
  isWriteAllowed?: boolean;
  moduleName: string;
  uiPackName: string;
  mode: string;
  downloadUrl?: string | null;
};

type BuildListResponse = {
  ok: boolean;
  items?: BuildItem[];
  error?: string;
};

const FAILED_STEP_LABELS: Record<NonNullable<BuildItem["failedStep"]>, string> = {
  preparing_request: "Preparing build request failed",
  processing_identity: "Processing app identity failed",
  matching_logic_module: "Matching logic module failed",
  applying_ui_pack: "Applying UI pack failed",
  preparing_services: "Preparing app services and signing failed",
  building_apk: "Building and packaging APK failed",
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getStageMeta(stage: BuildItem["stage"]) {
  if (stage === "success") {
    return {
      label: "Completed",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
      chipClass: "bg-emerald-100 text-emerald-600",
      cardClass: "border-emerald-200/80 bg-emerald-50/30 shadow-[0_14px_40px_rgba(16,185,129,0.12)]",
    };
  }

  if (stage === "failed") {
    return {
      label: "Failed",
      icon: <TriangleAlert className="h-4 w-4 text-red-500" />,
      chipClass: "bg-red-100 text-red-500",
      cardClass: "border-red-200/80 bg-red-50/40 shadow-[0_14px_40px_rgba(239,68,68,0.10)]",
    };
  }

  if (stage === "running") {
    return {
      label: "Running",
      icon: <LoaderCircle className="h-4 w-4 animate-spin text-fuchsia-500" />,
      chipClass: "bg-fuchsia-100 text-fuchsia-600",
      cardClass:
        "border-fuchsia-200/80 bg-[linear-gradient(135deg,rgba(250,245,255,0.98),rgba(255,255,255,0.98))] shadow-[0_14px_40px_rgba(217,70,239,0.16)] animate-pulse",
    };
  }

  return {
    label: "Queued",
    icon: <Clock3 className="h-4 w-4 text-slate-400" />,
    chipClass: "bg-slate-100 text-slate-500",
    cardClass: "border-slate-200/80 bg-white/70 shadow-[0_10px_24px_rgba(148,163,184,0.05)]",
  };
}

function getCloudStatusMeta(item: BuildItem) {
  if (item.cloudStatus === "deleted") {
    return {
      label: "Cloud deleted",
      className: "border-red-200/80 bg-white/80 text-red-600 shadow-[0_6px_18px_rgba(239,68,68,0.06)]",
    };
  }

  if (item.cloudStatus === "read_only" || item.isWriteAllowed === false) {
    const detail = item.cloudDeletesAt
      ? `Deletes ${formatTime(item.cloudDeletesAt)}`
      : "Writes disabled";

    return {
      label: `Cloud read-only · ${detail}`,
      className: "border-amber-200/80 bg-white/80 text-amber-700 shadow-[0_6px_18px_rgba(245,158,11,0.08)]",
    };
  }

  if (item.cloudStatus === "active") {
    const detail = item.cloudExpiresAt
      ? `Expires ${formatTime(item.cloudExpiresAt)}`
      : "Cloud active";

    return {
      label: `Cloud active · ${detail}`,
      className: "border-sky-200/80 bg-white/80 text-sky-700 shadow-[0_6px_18px_rgba(14,165,233,0.06)]",
    };
  }

  return null;
}

function canDownloadBuild(item: BuildItem) {
  if (item.stage !== "success" || !item.downloadUrl) return false;

  const baseTime = item.completedAt ?? item.createdAt;
  const completedTime = new Date(baseTime).getTime();

  if (Number.isNaN(completedTime)) return true;

  const expiresAt = completedTime + 90 * 24 * 60 * 60 * 1000;
  return Date.now() < expiresAt;
}

export default function HistoryPage() {
  const [items, setItems] = useState<BuildItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [error, setError] = useState("");
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      setIsAuthed(!error && !!data.user);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session?.user);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (authLoading || !isAuthed) {
      return;
    }

    let cancelled = false;
    let hasLoggedOpen = false;

    const fetchHistory = async (isInitialLoad: boolean) => {
      try {
        if (isInitialLoad) {
          setLoading(true);
        }

        const historyOpenKey = "ndjc_history_opened_logged";
        const shouldLogOpen =
          !hasLoggedOpen &&
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(historyOpenKey) !== "1";

        const requestUrl = shouldLogOpen ? "/api/build-list?logOpen=1" : "/api/build-list";

        const res = await fetch(requestUrl, { cache: "no-store" });
        const data: BuildListResponse = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Failed to load build history.");
        }

        if (cancelled) {
          return;
        }

        setItems(data.items || []);
        setError("");

        if (shouldLogOpen && typeof window !== "undefined") {
          window.sessionStorage.setItem(historyOpenKey, "1");
          hasLoggedOpen = true;
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        setError(err instanceof Error ? err.message : "Failed to load build history.");
      } finally {
        if (cancelled) {
          return;
        }

        if (isInitialLoad) {
          setLoading(false);
        }
      }
    };

    void fetchHistory(true);

    const timer = window.setInterval(() => {
      void fetchHistory(false);
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authLoading, isAuthed]);

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader nextPath="/history" />

      <section className="relative z-10 mx-auto max-w-7xl px-6 py-16">
        <div className="mb-12 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/40 px-3 py-1 text-xs font-medium tracking-[0.06em] text-[#64748b] backdrop-blur">
              <History className="h-3.5 w-3.5" />
              Build archive
            </div>
            <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-7xl">Your builds</h1>
            <p className="mt-4 max-w-2xl text-lg leading-[1.9] text-[#475569]">
              Review previous Think it Done build runs, re-open an in-progress generation, or download completed build packages again.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/50 bg-white/60 px-5 py-4 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Total builds</div>
            <div className="mt-2 text-3xl font-bold tracking-[-0.04em] text-[#0f172a]">{items.length}</div>
          </div>
        </div>

        {authLoading ? (
          <div className="rounded-[32px] border border-white/50 bg-white/60 p-10 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl">
            <div className="text-sm text-slate-500">Checking login status...</div>
          </div>
        ) : null}

        {!authLoading && !isAuthed ? (
          <div className="rounded-[32px] border border-white/50 bg-white/60 p-10 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
              <History className="h-6 w-6" />
            </div>
            <div className="mt-5 text-2xl font-bold tracking-[-0.03em] text-[#0f172a]">
              Sign in to view your build history
            </div>
            <div className="mt-3 text-sm leading-7 text-[#64748b]">
              Your NDJC build history is only available after Google login.
            </div>
            <div className="mt-6 flex justify-center">
              <AuthControls nextPath="/history" />
            </div>
          </div>
        ) : null}

        {isAuthed && loading ? (
          <div className="rounded-[32px] border border-white/50 bg-white/60 p-10 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl">
            <div className="text-sm text-slate-500">Loading build history...</div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {isAuthed && !loading && items.length === 0 ? (
          <div className="rounded-[32px] border border-white/50 bg-white/60 p-10 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
              <History className="h-6 w-6" />
            </div>
            <div className="mt-5 text-2xl font-bold tracking-[-0.03em] text-[#0f172a]">No builds yet</div>
            <div className="mt-3 text-sm leading-7 text-[#64748b]">
              Start from the home page, generate your first app, and your build history will appear here.
            </div>
          </div>
        ) : null}

        {isAuthed && !loading && items.length > 0 ? (
          <div className="mx-auto grid w-full max-w-7xl gap-5">
            {items.map((item) => {
              const meta = getStageMeta(item.stage);
              const cloudMeta = item.stage === "success" ? getCloudStatusMeta(item) : null;
              const showInlineFailedReason = item.stage === "failed" && item.failedStep;
              const showInlineCompletedTime = item.stage === "success" && item.completedAt;
              const showDownloadButton = canDownloadBuild(item);

              return (
                <div
                  key={item.runId}
                  className={`mx-auto w-full max-w-7xl rounded-[28px] border p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(15,23,42,0.07)] ${meta.cardClass}`}
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="overflow-x-auto overflow-y-hidden">
                        <div className="flex min-w-max flex-nowrap items-center gap-2">
                          <div className="shrink-0 text-xl font-bold tracking-[-0.03em] text-[#0f172a]">{item.appName}</div>
                          <div className={`inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${meta.chipClass}`}>
                            {meta.icon}
                            {meta.label}
                          </div>
                          <div className="inline-flex shrink-0 items-center rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-[0_6px_18px_rgba(15,23,42,0.04)] whitespace-nowrap">
                            Run ID · {item.runId}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 overflow-x-auto overflow-y-hidden">
                        <div className="flex min-w-max flex-nowrap items-center gap-2">
                          {showInlineCompletedTime ? (
                            <div className="inline-flex shrink-0 items-center rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-emerald-600 shadow-[0_6px_18px_rgba(16,185,129,0.06)] whitespace-nowrap">
                              Completed · {formatTime(item.completedAt!)}
                            </div>
                          ) : null}
                          {showInlineFailedReason ? (
                            <div className="inline-flex shrink-0 items-center rounded-full border border-red-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-red-600 shadow-[0_6px_18px_rgba(239,68,68,0.06)] whitespace-nowrap">
                              {FAILED_STEP_LABELS[item.failedStep!]}
                            </div>
                          ) : null}
                          {cloudMeta ? (
                            <div className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[11px] font-semibold whitespace-nowrap ${cloudMeta.className}`}>
                              {cloudMeta.label}
                            </div>
                          ) : null}
                          {item.stage === "success" && item.storeId ? (
                            <div className="inline-flex shrink-0 items-center rounded-full border border-sky-200/60 bg-white/70 px-3 py-1 text-[11px] font-semibold text-sky-600/80 shadow-[0_6px_18px_rgba(14,165,233,0.04)] whitespace-nowrap">
                              Store ID · {item.storeId}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Module</div>
                          <div className="mt-2 text-sm font-semibold text-[#0f172a]">{item.moduleName}</div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">UI Pack</div>
                          <div className="mt-2 text-sm font-semibold text-[#0f172a]">{item.uiPackName}</div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Mode</div>
                          <div className="mt-2 text-sm font-semibold text-[#0f172a]">{item.mode}</div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Created</div>
                          <div className="mt-2 text-sm font-semibold text-[#0f172a]">{formatTime(item.createdAt)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 lg:justify-end">
                      {item.stage === "running" ? (
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href = `/generating?runId=${encodeURIComponent(item.runId)}`;
                          }}
                          className="inline-flex h-[40px] w-[164px] items-center justify-center gap-2 rounded-full border border-fuchsia-300/60 bg-gradient-to-r from-fuchsia-100 to-purple-100 px-5 text-sm font-semibold text-fuchsia-700 shadow-[0_8px_18px_rgba(217,70,239,0.10)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_22px_rgba(217,70,239,0.14)]"
                        >
                          <ArrowRight className="h-4 w-4" />
                          Continue
                        </button>
                      ) : item.stage === "queued" ? (
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href = `/generating?runId=${encodeURIComponent(item.runId)}`;
                          }}
                          className="inline-flex h-[40px] w-[164px] items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-5 text-sm font-semibold text-slate-500 shadow-[0_6px_14px_rgba(148,163,184,0.06)] transition hover:bg-slate-100"
                        >
                          <ArrowRight className="h-4 w-4" />
                          Continue
                        </button>
                      ) : null}

                      {showDownloadButton ? (
                        <div className="flex flex-col items-end gap-2">
                          <a
                            href={`/api/build-status?runId=${encodeURIComponent(item.runId)}&download=1&event=history_download`}
                            className="inline-flex h-[40px] w-[164px] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(217,70,239,0.20)] transition hover:-translate-y-0.5 hover:opacity-90"
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </a>
                          {item.stage === "success" && item.mode === "Paid Purchase" ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (typeof window !== "undefined") {
                                  window.sessionStorage.setItem("ndjc_renew_app_name", item.appName || "");
                                  window.sessionStorage.setItem("ndjc_renew_store_id", item.storeId || "");
                                  window.sessionStorage.setItem("ndjc_renew_cloud_status", item.cloudStatus || "");
                                  window.sessionStorage.setItem("ndjc_renew_cloud_expires_at", item.cloudExpiresAt || "");
                                }

                                const params = new URLSearchParams({
                                  appName: item.appName || "",
                                  storeId: item.storeId || "",
                                  cloudStatus: item.cloudStatus || "",
                                  cloudExpiresAt: item.cloudExpiresAt || "",
                                });

                                window.location.href = `/renew-cloud?${params.toString()}`;
                              }}
                              className="inline-flex h-[40px] w-[164px] items-center justify-center gap-2 rounded-full border border-sky-200 bg-gradient-to-r from-sky-100 to-sky-50 px-5 text-sm font-semibold text-sky-700 shadow-[0_8px_18px_rgba(14,165,233,0.10)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_22px_rgba(14,165,233,0.14)]"
                            >
                              <ArrowRight className="h-4 w-4 rotate-[-45deg]" />
                              Renew Cloud
                            </button>
                          ) : null}
                          <div className="w-[164px] text-center text-[11px] text-slate-400">
                            Download available for 90 days
                          </div>
                        </div>
                      ) : null}

                      {item.stage === "failed" ? (
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href = `/generating?runId=${encodeURIComponent(item.runId)}`;
                          }}
                          className="inline-flex h-[40px] w-[164px] items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-5 text-sm font-semibold text-red-600 shadow-[0_6px_14px_rgba(239,68,68,0.06)] transition hover:bg-red-100"
                        >
                          <ArrowRight className="h-4 w-4" />
                          Continue
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </main>
  );
}
