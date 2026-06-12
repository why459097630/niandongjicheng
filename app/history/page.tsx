"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, History, TriangleAlert, ArrowRight } from "lucide-react";
import AuthControls from "@/components/auth/AuthControls";
import SiteHeader from "@/components/layout/SiteHeader";
import { createClient } from "@/lib/supabase/client";

type PaymentOrderStatus =
  | "created"
  | "checkout_created"
  | "paid"
  | "processing"
  | "processed"
  | "failed"
  | "manual_review_required"
  | "refund_pending"
  | "refunded"
  | "canceled";

type PaymentCompensationStatus =
  | "none"
  | "pending_retry"
  | "retrying"
  | "manual_review_required"
  | "refund_pending"
  | "refunded";

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
  publicApkUrl?: string | null;

  buildOrderStatus?: PaymentOrderStatus | null;
  buildCompensationStatus?: PaymentCompensationStatus | null;
  buildCompensationNote?: string | null;
  buildNextRetryAt?: string | null;
  buildManualReviewRequiredAt?: string | null;
  buildRefundedAt?: string | null;

  renewOrderStatus?: PaymentOrderStatus | null;
  renewCompensationStatus?: PaymentCompensationStatus | null;
  renewCompensationNote?: string | null;
  renewNextRetryAt?: string | null;
  renewManualReviewRequiredAt?: string | null;
  renewRefundedAt?: string | null;
};

type FinalBuildItem = BuildItem & {
  stage: "success" | "failed";
};

type BuildListResponse = {
  ok: boolean;
  items?: BuildItem[];
  hasMore?: boolean;
  nextOffset?: number | null;
  totalCount?: number;
  error?: string;
};

const HISTORY_PAGE_SIZE = 10;

const FAILED_SUPPORT_MESSAGE = "Generation failed. Contact support for help or refund review.";

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

function getStageMeta(stage: FinalBuildItem["stage"]) {
  if (stage === "success") {
    return {
      label: "Completed",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
      chipClass: "bg-emerald-100 text-emerald-600",
      cardClass: "border-emerald-200/80 bg-emerald-50/30 shadow-[0_14px_40px_rgba(16,185,129,0.12)]",
    };
  }

  return {
    label: "Failed",
    icon: <TriangleAlert className="h-4 w-4 text-red-500" />,
    chipClass: "bg-red-100 text-red-500",
    cardClass: "border-red-200/80 bg-red-50/40 shadow-[0_14px_40px_rgba(239,68,68,0.10)]",
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

function getBuildCompensationMeta(item: BuildItem) {
  if (item.buildOrderStatus === "refunded" || item.buildRefundedAt) {
    return {
      label: item.buildRefundedAt
        ? `Build refunded · ${formatTime(item.buildRefundedAt)}`
        : "Build refunded",
      className: "border-red-200/80 bg-white/80 text-red-600 shadow-[0_6px_18px_rgba(239,68,68,0.06)]",
    };
  }

  if (
    item.buildOrderStatus === "manual_review_required" ||
    item.buildCompensationStatus === "manual_review_required"
  ) {
    return {
      label: item.buildManualReviewRequiredAt
        ? `Build manual review · ${formatTime(item.buildManualReviewRequiredAt)}`
        : "Build manual review",
      className: "border-amber-200/80 bg-white/80 text-amber-700 shadow-[0_6px_18px_rgba(245,158,11,0.08)]",
    };
  }

  if (
    item.buildCompensationStatus === "pending_retry" ||
    item.buildCompensationStatus === "retrying"
  ) {
    return {
      label: item.buildNextRetryAt
        ? `Build auto retry · ${formatTime(item.buildNextRetryAt)}`
        : "Build auto retry scheduled",
      className: "border-violet-200/80 bg-white/80 text-violet-700 shadow-[0_6px_18px_rgba(139,92,246,0.08)]",
    };
  }

  return null;
}

function getRenewCompensationMeta(item: BuildItem) {
  if (item.renewOrderStatus === "refunded" || item.renewRefundedAt) {
    return {
      label: item.renewRefundedAt
        ? `Renewal refunded · ${formatTime(item.renewRefundedAt)}`
        : "Renewal refunded",
      className: "border-red-200/80 bg-white/80 text-red-600 shadow-[0_6px_18px_rgba(239,68,68,0.06)]",
    };
  }

  if (
    item.renewOrderStatus === "manual_review_required" ||
    item.renewCompensationStatus === "manual_review_required"
  ) {
    return {
      label: item.renewManualReviewRequiredAt
        ? `Renewal manual review · ${formatTime(item.renewManualReviewRequiredAt)}`
        : "Renewal manual review",
      className: "border-amber-200/80 bg-white/80 text-amber-700 shadow-[0_6px_18px_rgba(245,158,11,0.08)]",
    };
  }

  if (
    item.renewCompensationStatus === "pending_retry" ||
    item.renewCompensationStatus === "retrying"
  ) {
    return {
      label: item.renewNextRetryAt
        ? `Renewal auto retry · ${formatTime(item.renewNextRetryAt)}`
        : "Renewal auto retry scheduled",
      className: "border-violet-200/80 bg-white/80 text-violet-700 shadow-[0_6px_18px_rgba(139,92,246,0.08)]",
    };
  }

  if (item.renewOrderStatus === "refund_pending") {
    return {
      label: "Renewal refund pending",
      className: "border-rose-200/80 bg-white/80 text-rose-600 shadow-[0_6px_18px_rgba(244,63,94,0.08)]",
    };
  }

  return null;
}

function canDownloadBuild(item: BuildItem) {
  return item.stage === "success" && Boolean(item.downloadUrl) && item.cloudStatus !== "deleted";
}

function getTemplateDisplayName(moduleName: string) {
  if (moduleName === "feature-showcase") {
    return "Showcase Hub";
  }

  return moduleName;
}

function getVisualStyleDisplayName(uiPackName: string) {
  if (uiPackName === "ui-pack-showcase-greenpink") {
    return "Clean Neutral Style";
  }

  return uiPackName;
}

async function requestBuildHistoryPage(offset: number, logOpen: boolean): Promise<BuildListResponse> {
  const params = new URLSearchParams({
    limit: String(HISTORY_PAGE_SIZE),
    offset: String(offset),
  });

  if (logOpen) {
    params.set("logOpen", "1");
  }

  const res = await fetch(`/api/build-list?${params.toString()}`, { cache: "no-store" });
  const data: BuildListResponse = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to load customer hub history.");
  }

  return data;
}

function mergeLatestHistoryItems(currentItems: BuildItem[], latestItems: BuildItem[]) {
  const latestRunIds = new Set(latestItems.map((item) => item.runId));
  const preservedItems = currentItems.filter((item) => !latestRunIds.has(item.runId));

  return [...latestItems, ...preservedItems];
}

function appendHistoryItems(currentItems: BuildItem[], nextItems: BuildItem[]) {
  const currentRunIds = new Set(currentItems.map((item) => item.runId));
  const uniqueNextItems = nextItems.filter((item) => !currentRunIds.has(item.runId));

  return [...currentItems, ...uniqueNextItems];
}

export default function HistoryPage() {
  const [items, setItems] = useState<BuildItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [error, setError] = useState("");
  const supabase = useMemo(() => createClient(), []);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item): item is FinalBuildItem => item.stage === "success" || item.stage === "failed",
      ),
    [items],
  );

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

        const data = await requestBuildHistoryPage(0, shouldLogOpen);

        if (cancelled) {
          return;
        }

        const nextItems = data.items || [];
        const nextTotalCount = typeof data.totalCount === "number" ? data.totalCount : nextItems.length;

        setTotalCount(nextTotalCount);

        if (isInitialLoad) {
          setItems(nextItems);
          setHasMore(Boolean(data.hasMore));
          setNextOffset(typeof data.nextOffset === "number" ? data.nextOffset : null);
        } else {
          setItems((currentItems) => mergeLatestHistoryItems(currentItems, nextItems));
        }

        setError("");

        if (shouldLogOpen && typeof window !== "undefined") {
          window.sessionStorage.setItem(historyOpenKey, "1");
          hasLoggedOpen = true;
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        setError(err instanceof Error ? err.message : "Failed to load customer hub history.");
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

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || nextOffset === null) {
      return;
    }

    try {
      setLoadingMore(true);

      const data = await requestBuildHistoryPage(nextOffset, false);
      const nextItems = data.items || [];
      const nextTotalCount = typeof data.totalCount === "number" ? data.totalCount : totalCount;

      setTotalCount(nextTotalCount);
      setItems((currentItems) => appendHistoryItems(currentItems, nextItems));
      setHasMore(Boolean(data.hasMore));
      setNextOffset(typeof data.nextOffset === "number" ? data.nextOffset : null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more customer hubs.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextOffset, totalCount]);

  useEffect(() => {
    const target = loadMoreSentinelRef.current;

    if (!target || !isAuthed || loading || loadingMore || !hasMore || nextOffset === null) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (entry?.isIntersecting) {
          void handleLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "240px 0px",
        threshold: 0,
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [handleLoadMore, hasMore, isAuthed, loading, loadingMore, nextOffset]);

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader nextPath="/history" />

      <section className="relative z-10 mx-auto max-w-7xl px-4 py-10 sm:px-6 md:py-16">
        <div className="mb-8 flex flex-col gap-5 md:mb-12 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/40 px-3 py-1 text-xs font-medium tracking-[0.06em] text-[#64748b] backdrop-blur">
              <History className="h-3.5 w-3.5" />
              Customer hub history
            </div>
            <h1 className="text-[36px] font-extrabold leading-[1.02] tracking-[-0.05em] sm:text-5xl md:text-7xl md:leading-[1]">Your customer hubs</h1>
<p className="mt-4 max-w-2xl text-base leading-[1.8] text-[#475569] md:text-lg md:leading-[1.9]">
  Review your generated customer hubs, download launch packages, or renew cloud service.
</p>
          </div>

          <div className="rounded-[24px] border border-white/50 bg-white/60 px-4 py-3 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl md:rounded-[28px] md:px-5 md:py-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Total hubs</div>
            <div className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[#0f172a] md:text-3xl">{totalCount}</div>
          </div>
        </div>

        {authLoading ? (
          <div className="rounded-[26px] border border-white/50 bg-white/60 p-6 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl md:rounded-[32px] md:p-10">
            <div className="text-sm text-slate-500">Checking login status...</div>
          </div>
        ) : null}

        {!authLoading && !isAuthed ? (
          <div className="rounded-[26px] border border-white/50 bg-white/60 p-6 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl md:rounded-[32px] md:p-10">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
              <History className="h-6 w-6" />
            </div>
            <div className="mt-5 text-xl font-bold tracking-[-0.03em] text-[#0f172a] md:text-2xl">
              Sign in to view your customer hub history
            </div>
            <div className="mt-3 text-sm leading-7 text-[#64748b]">
              Your Think it Done customer hub history is available after Google login.
            </div>
            <div className="mt-6 flex justify-center">
              <AuthControls nextPath="/history" />
            </div>
          </div>
        ) : null}

        {isAuthed && loading ? (
          <div className="rounded-[26px] border border-white/50 bg-white/60 p-6 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl md:rounded-[32px] md:p-10">
            <div className="text-sm text-slate-500">Loading customer hub history...</div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

{isAuthed && !loading && visibleItems.length === 0 ? (
  <div className="rounded-[26px] border border-white/50 bg-white/60 p-6 text-center shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl md:rounded-[32px] md:p-10">
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
      <History className="h-6 w-6" />
    </div>
    <div className="mt-5 text-xl font-bold tracking-[-0.03em] text-[#0f172a] md:text-2xl">No customer hubs yet</div>
    <div className="mt-3 text-sm leading-7 text-[#64748b]">
      Start from the builder, create your first customer hub, and it will appear here.
    </div>
  </div>
) : null}

{isAuthed && !loading && visibleItems.length > 0 ? (
  <div className="mx-auto grid w-full max-w-7xl gap-5">
    {visibleItems.map((item) => {
              const meta = getStageMeta(item.stage);
              const cloudMeta = item.stage === "success" ? getCloudStatusMeta(item) : null;
              const buildCompensationMeta = getBuildCompensationMeta(item);
              const renewCompensationMeta = getRenewCompensationMeta(item);
              const showFailedSupportMessage = item.stage === "failed";
              const showInlineCompletedTime = item.stage === "success" && item.completedAt;
              const isCloudDeleted = item.cloudStatus === "deleted";
              const canDownload = canDownloadBuild(item);

              const isPaidSuccess = item.stage === "success" && item.mode === "Paid Purchase";
              const isRenewOrderBlocked =
                item.renewCompensationStatus === "pending_retry" ||
                item.renewCompensationStatus === "retrying" ||
                item.renewCompensationStatus === "manual_review_required" ||
                item.renewOrderStatus === "refund_pending";

              const isRenewableCloudStatus =
                item.cloudStatus === "active" || item.cloudStatus === "read_only";

              const canStartRenewCloud =
                isPaidSuccess &&
                Boolean(item.storeId) &&
                isRenewableCloudStatus &&
                !isRenewOrderBlocked;

              const showRenewUnavailable =
                isPaidSuccess && (!item.storeId || !isRenewableCloudStatus);

              const renewUnavailableLabel =
                item.cloudStatus === "deleted" ? "Cloud deleted" : "Cloud unavailable";

              return (
                <div
                  key={item.runId}
                  className={`mx-auto w-full max-w-7xl rounded-[24px] border p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(15,23,42,0.07)] md:rounded-[28px] md:p-6 ${meta.cardClass}`}
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="overflow-visible md:overflow-x-auto md:overflow-y-hidden">
                        <div className="flex flex-wrap items-center gap-2 md:min-w-max md:flex-nowrap">
                          <div className="min-w-0 break-words text-xl font-bold tracking-[-0.03em] text-[#0f172a] md:shrink-0">{item.appName}</div>
                          <div className={`inline-flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${meta.chipClass}`}>
                            {meta.icon}
                            {meta.label}
                          </div>
                          <div className="inline-flex max-w-full shrink-0 items-center break-all rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-[0_6px_18px_rgba(15,23,42,0.04)] md:whitespace-nowrap">
                            Run ID · {item.runId}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 overflow-visible md:overflow-x-auto md:overflow-y-hidden">
                        <div className="flex flex-wrap items-center gap-2 md:min-w-max md:flex-nowrap">
                          {showInlineCompletedTime ? (
                            <div className="inline-flex shrink-0 items-center rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-emerald-600 shadow-[0_6px_18px_rgba(16,185,129,0.06)] whitespace-nowrap">
                              Completed · {formatTime(item.completedAt!)}
                            </div>
                          ) : null}
                          {showFailedSupportMessage ? (
                            <div className="max-w-full shrink-0 rounded-2xl border border-red-200 bg-white/80 px-3 py-1 text-[11px] font-semibold leading-5 text-red-600 shadow-[0_6px_18px_rgba(239,68,68,0.06)] md:rounded-full md:whitespace-nowrap">
                              {FAILED_SUPPORT_MESSAGE}{" "}
                              <a className="underline underline-offset-4" href="mailto:support@thinkitdoneapp.com">
                                Email support
                              </a>{" "}
                              ·{" "}
                              <a className="underline underline-offset-4" href="/refund">
                                Refund Policy
                              </a>
                            </div>
                          ) : null}
                          {buildCompensationMeta ? (
                            <div className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[11px] font-semibold whitespace-nowrap ${buildCompensationMeta.className}`}>
                              {buildCompensationMeta.label}
                            </div>
                          ) : null}
                          {renewCompensationMeta ? (
                            <div className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[11px] font-semibold whitespace-nowrap ${renewCompensationMeta.className}`}>
                              {renewCompensationMeta.label}
                            </div>
                          ) : null}
                          {cloudMeta ? (
                            <div className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[11px] font-semibold whitespace-nowrap ${cloudMeta.className}`}>
                              {cloudMeta.label}
                            </div>
                          ) : null}
                          {item.stage === "success" && item.storeId ? (
                            <div className="inline-flex max-w-full shrink-0 items-center break-all rounded-full border border-sky-200/60 bg-white/70 px-3 py-1 text-[11px] font-semibold text-sky-600/80 shadow-[0_6px_18px_rgba(14,165,233,0.04)] md:whitespace-nowrap">
                              Store ID · {item.storeId}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2.5 xl:mt-5 xl:gap-3 xl:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2.5 xl:px-4 xl:py-3">
                          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 xl:text-[11px]">Template</div>
                          <div className="mt-1.5 break-words text-[13px] font-semibold text-[#0f172a] xl:mt-2 xl:text-sm">{getTemplateDisplayName(item.moduleName)}</div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2.5 xl:px-4 xl:py-3">
                          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 xl:text-[11px]">Visual Style</div>
                          <div className="mt-1.5 break-words text-[13px] font-semibold text-[#0f172a] xl:mt-2 xl:text-sm">{getVisualStyleDisplayName(item.uiPackName)}</div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2.5 xl:px-4 xl:py-3">
                          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 xl:text-[11px]">Generation mode</div>
                          <div className="mt-1.5 break-words text-[13px] font-semibold text-[#0f172a] xl:mt-2 xl:text-sm">{item.mode}</div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2.5 xl:px-4 xl:py-3">
                          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 xl:text-[11px]">Created</div>
                          <div className="mt-1.5 break-words text-[13px] font-semibold text-[#0f172a] xl:mt-2 xl:text-sm">{formatTime(item.createdAt)}</div>
                        </div>
                      </div>

                      {item.buildCompensationNote || item.renewCompensationNote ? (
                        <div className="mt-3 break-words rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-600">
                          <div>
                            {item.buildCompensationNote ? `Build: ${item.buildCompensationNote}` : ""}
                            {item.buildCompensationNote && item.renewCompensationNote ? " · " : ""}
                            {item.renewCompensationNote ? `Renewal: ${item.renewCompensationNote}` : ""}
                          </div>
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            For billing, refund, or manual review questions, contact{" "}
                            <a className="font-semibold text-[#0f172a] underline underline-offset-4" href="mailto:support@thinkitdoneapp.com">
                              support@thinkitdoneapp.com
                            </a>{" "}
                            or review the{" "}
                            <a className="font-semibold text-[#0f172a] underline underline-offset-4" href="/refund">
                              Refund Policy
                            </a>
                            .
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex w-full flex-wrap gap-3 lg:w-[164px] lg:shrink-0 lg:justify-end">


{item.stage === "success" ? (
  <div className="flex w-full flex-col items-stretch gap-2 lg:items-end">
    {canDownload ? (
      <a
        href={`/api/build-status?runId=${encodeURIComponent(item.runId)}&download=1&event=history_download`}
        className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(217,70,239,0.20)] transition hover:-translate-y-0.5 hover:opacity-90 lg:h-[40px] lg:w-[164px]"
      >
        <Download className="h-4 w-4" />
        Download
      </a>
    ) : (
      <div
        aria-disabled="true"
        className="inline-flex h-[42px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-5 text-sm font-semibold text-slate-400 shadow-[0_6px_14px_rgba(148,163,184,0.06)] lg:h-[40px] lg:w-[164px]"
      >
        <Download className="h-4 w-4" />
        Unavailable
      </div>
    )}

    {isPaidSuccess ? (
      canStartRenewCloud ? (
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
          className="inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-full border border-sky-200 bg-gradient-to-r from-sky-100 to-sky-50 px-5 text-sm font-semibold text-sky-700 shadow-[0_8px_18px_rgba(14,165,233,0.10)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_22px_rgba(14,165,233,0.14)] lg:h-[40px] lg:w-[164px]"
        >
          <ArrowRight className="h-4 w-4 rotate-[-45deg]" />
          Renew cloud
        </button>
      ) : showRenewUnavailable ? (
        <div
          aria-disabled="true"
          className="inline-flex h-[42px] w-full cursor-not-allowed items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-5 text-sm font-semibold text-slate-400 shadow-[0_6px_14px_rgba(148,163,184,0.06)] lg:h-[40px] lg:w-[164px]"
        >
          {renewUnavailableLabel}
        </div>
      ) : (
        <div className="inline-flex h-[42px] w-full items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-5 text-sm font-semibold text-amber-700 shadow-[0_6px_14px_rgba(245,158,11,0.08)] lg:h-[40px] lg:w-[164px]">
          Renewal processing
        </div>
      )
    ) : null}
  </div>
) : null}


                    </div>
                  </div>
                </div>
              );
            })}

            {hasMore ? (
              <div ref={loadMoreSentinelRef} className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="inline-flex h-[42px] min-w-[150px] items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-[#0f172a] shadow-[0_8px_20px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(15,23,42,0.08)] disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:translate-y-0 disabled:hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
                >
                  {loadingMore ? "Loading more..." : "Load more"}
                </button>
              </div>
            ) : (
              <div className="pt-2 text-center text-sm font-medium text-slate-400">
                No more customer hubs.
              </div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
