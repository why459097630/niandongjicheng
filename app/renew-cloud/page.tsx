"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/components/layout/SiteHeader";
import { ArrowLeft, ArrowRight, CheckCircle2, RefreshCcw, Info, DollarSign } from "lucide-react";

const RENEW_APP_NAME_STORAGE_KEY = "ndjc_renew_app_name";
const RENEW_STORE_ID_STORAGE_KEY = "ndjc_renew_store_id";
const RENEW_CLOUD_STATUS_STORAGE_KEY = "ndjc_renew_cloud_status";
const RENEW_CLOUD_EXPIRES_AT_STORAGE_KEY = "ndjc_renew_cloud_expires_at";

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

function addDays(value: string, days: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export default function CloudRenewPage() {
  const RENEW_OPTIONS = [
    { id: "30d", label: "30 days", priceLabel: "$29", days: 30 },
    { id: "90d", label: "90 days", priceLabel: "$79", days: 90 },
    { id: "180d", label: "180 days", priceLabel: "$149", days: 180 },
  ] as const;

  const [appName, setAppName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [cloudStatus, setCloudStatus] = useState("");
  const [cloudExpiresAt, setCloudExpiresAt] = useState("");
  const [isPageReady, setIsPageReady] = useState(false);
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const [selectedRenewId, setSelectedRenewId] = useState<(typeof RENEW_OPTIONS)[number]["id"]>("180d");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    const handleScroll = () => {
      setIsHeaderCompact(window.scrollY > 24);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);

  const nextAppName =
    params.get("appName") ||
    sessionStorage.getItem(RENEW_APP_NAME_STORAGE_KEY) ||
    "";

  const nextStoreId =
    params.get("storeId") ||
    sessionStorage.getItem(RENEW_STORE_ID_STORAGE_KEY) ||
    "";

  const nextCloudStatus =
    params.get("cloudStatus") ||
    sessionStorage.getItem(RENEW_CLOUD_STATUS_STORAGE_KEY) ||
    "";

  const nextCloudExpiresAt =
    params.get("cloudExpiresAt") ||
    sessionStorage.getItem(RENEW_CLOUD_EXPIRES_AT_STORAGE_KEY) ||
    "";

  const nextRenewId = params.get("renewId");
  if (nextRenewId === "30d" || nextRenewId === "90d" || nextRenewId === "180d") {
    setSelectedRenewId(nextRenewId);
  }

  setAppName(nextAppName);
  setStoreId(nextStoreId);
  setCloudStatus(nextCloudStatus);
  setCloudExpiresAt(nextCloudExpiresAt);
  setIsPageReady(true);
}, []);

useEffect(() => {
  if (!isPageReady) return;

  const params = new URLSearchParams(window.location.search);
  const stripeSuccess = params.get("stripeSuccess");
  const sessionId = params.get("session_id") || "";

  if (stripeSuccess !== "1") {
    return;
  }

  if (!sessionId) {
    setSubmitError("Missing Stripe session_id in return URL.");
    return;
  }

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const scheduleNextPoll = (delayMs: number) => {
    if (cancelled) return;

    timer = setTimeout(() => {
      void pollRenewStatus();
    }, delayMs);
  };

  const pollRenewStatus = async () => {
    if (inFlight || cancelled) {
      return;
    }

    inFlight = true;

    try {
      setIsVerifyingPayment(true);
      setSubmitError("");

      const response = await fetch("/api/stripe/verify-renew-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
        }),
      });

      const data = await response.json();

      if (cancelled) return;

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to check cloud renewal payment.");
      }

      if (typeof data?.storeId === "string" && data.storeId.trim()) {
        setStoreId(data.storeId.trim());
      }

      if (
        data?.renewId === "30d" ||
        data?.renewId === "90d" ||
        data?.renewId === "180d"
      ) {
        setSelectedRenewId(data.renewId);
      }

      if (data.processed) {
        const finalStoreId =
          typeof data?.storeId === "string" && data.storeId.trim()
            ? data.storeId.trim()
            : storeId;

        const finalRenewId =
          data?.renewId === "30d" ||
          data?.renewId === "90d" ||
          data?.renewId === "180d"
            ? data.renewId
            : selectedRenewId;

        window.location.href = `/history?renewed=1&storeId=${encodeURIComponent(finalStoreId)}&renewPlan=${encodeURIComponent(finalRenewId)}`;
        return;
      }

      if (data.status === "rate_limited") {
        const retryAfterMs =
          typeof data?.retryAfterMs === "number" && data.retryAfterMs > 0
            ? data.retryAfterMs
            : 1500;

        scheduleNextPoll(retryAfterMs);
        return;
      }

      scheduleNextPoll(2000);
    } catch (error) {
      if (!cancelled) {
        setSubmitError(error instanceof Error ? error.message : "Failed to renew cloud access.");
      }
    } finally {
      inFlight = false;

      if (!cancelled) {
        setIsVerifyingPayment(false);
      }
    }
  };

  void pollRenewStatus();

  return () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}, [isPageReady, selectedRenewId, storeId]);

  const selectedRenewOption =
    RENEW_OPTIONS.find((option) => option.id === selectedRenewId) ?? RENEW_OPTIONS[0];
  const renewDays = selectedRenewOption.days;
  const renewPrice = selectedRenewOption.priceLabel;
  const nextExpiry = addDays(cloudExpiresAt, renewDays);
  const currentExpiryDate = new Date(cloudExpiresAt);
  const daysUntilExpiry = Number.isNaN(currentExpiryDate.getTime())
    ? null
    : Math.max(0, Math.ceil((currentExpiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  const expiryCountdownLabel =
    daysUntilExpiry === null
      ? null
      : daysUntilExpiry === 0
        ? "Expires today"
        : `Expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}`;
  const statusBadgeLabel =
    cloudStatus === "active"
      ? "Cloud Active"
      : cloudStatus === "read_only"
        ? "Cloud Read-only"
        : cloudStatus === "deleted"
          ? "Cloud Deleted"
          : "Cloud Status Unknown";

  const cloudStatusLine =
    cloudStatus === "active"
      ? `Cloud Active · Expires ${formatTime(cloudExpiresAt)}`
      : cloudStatus === "read_only"
        ? `Cloud Read-only · Expires ${formatTime(cloudExpiresAt)}`
        : cloudStatus === "deleted"
          ? `Cloud Deleted · Last known expiry ${formatTime(cloudExpiresAt)}`
          : cloudExpiresAt
            ? `Cloud Status Unknown · ${formatTime(cloudExpiresAt)}`
            : "Cloud status is unavailable";

  const statusBadgeClassName =
    cloudStatus === "active"
      ? "border-sky-200/80 bg-sky-50/90 text-sky-700 shadow-[0_10px_24px_rgba(14,165,233,0.08)]"
      : cloudStatus === "read_only"
        ? "border-amber-200/80 bg-amber-50/90 text-amber-700 shadow-[0_10px_24px_rgba(245,158,11,0.08)]"
        : cloudStatus === "deleted"
          ? "border-red-200/80 bg-red-50/90 text-red-600 shadow-[0_10px_24px_rgba(239,68,68,0.08)]"
          : "border-slate-200/80 bg-slate-50/90 text-slate-600 shadow-[0_10px_24px_rgba(148,163,184,0.08)]";

    const cloudStatusCardClassName =
    "rounded-[22px] border border-red-200/80 bg-[linear-gradient(180deg,rgba(254,242,242,0.92),rgba(255,255,255,0.96))] px-4 py-4 shadow-[0_10px_26px_rgba(239,68,68,0.06),0_0_26px_rgba(248,113,113,0.10)]";

  const cloudStatusHintLabel =
    cloudStatus === "active"
      ? "Active"
      : cloudStatus === "read_only"
        ? "Read-only"
        : cloudStatus === "deleted"
          ? "Deleted"
          : "Unknown";

  if (!isPageReady) {
    return (
      <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />
      <SiteHeader compact={isHeaderCompact} navItems={[]} nextPath="/" />
        <section className="relative z-10 mx-auto max-w-5xl px-6 pb-20 pt-16">
          <div className="text-center">
            <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">Renew cloud</h1>
            <p className="mt-4 text-base text-[#64748b]">Loading renewal details...</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />
      <SiteHeader compact={isHeaderCompact} navItems={[]} nextPath="/" />

      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-20 pt-16">
        <div className="mb-10 text-center">
          <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">Renew cloud</h1>
          <p className="mt-4 text-base text-[#64748b]">
            Extend your cloud access to keep your app running without interruption.
          </p>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <section className="relative rounded-[32px] border border-slate-200/60 bg-white/70 p-8 shadow-[0_20px_52px_rgba(16,185,129,0.10),0_0_38px_rgba(99,102,241,0.08)] backdrop-blur-xl md:p-10">
            <div className="absolute top-4 right-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-[0_10px_22px_rgba(59,130,246,0.18)]">
              <RefreshCcw className="h-5 w-5" />
            </div>
            <div className="space-y-6">
              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  App info
                </div>

                <div className="rounded-[26px] border border-transparent bg-transparent px-0 py-6 shadow-none backdrop-blur-0">
                  <div className="flex flex-wrap items-start gap-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="mr-3 text-[28px] font-bold text-slate-800 tracking-[-0.04em] leading-none text-[#0f172a]">{appName}</div>
                      </div>
                      <div className="mt-6 space-y-4">
                        <div>
                        <div
                          className="inline-flex max-w-full items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 shadow-[0_6px_18px_rgba(56,189,248,0.08),0_0_18px_rgba(56,189,248,0.10)]"
                          translate="no"
                        >
                          Store ID · {storeId}
                        </div>
                        <div
                          className="mt-2 border-l-2 border-amber-300 pl-4 pr-2 py-1 text-[13px] leading-6 text-slate-500 whitespace-nowrap"
                          translate="no"
                        >
                          Please confirm that this Store ID matches the build history entry you want to renew.
                        </div>
                      </div>

                        <div className="space-y-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                            Cloud status
                          </div>

                          <div
                            className={cloudStatusCardClassName}
                            translate="no"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <div className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusBadgeClassName}`}>
                                {cloudStatusHintLabel}
                              </div>
                              <div className="text-sm text-slate-500">
                                {cloudStatusLine}
                              </div>
                            </div>

                            {expiryCountdownLabel && cloudStatus !== "deleted" ? (
                              <div className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-slate-900">
                                {cloudStatus === "active" ? expiryCountdownLabel : `⚠ ${expiryCountdownLabel}`}
                              </div>
                            ) : null}

                            <div className="mt-3 space-y-1.5 text-[13px] leading-6 text-slate-600">
                              <div>Current status: {statusBadgeLabel}</div>
                              <div>• Store ID is bound to this exact cloud service record</div>
                              <div>• Renewal extends the current cloud service for this paid build</div>
                            </div>
                          </div>
                        </div>

                        
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  After renewal
                </div>
                <div>
                  <div
                    key={`${selectedRenewId}-${nextExpiry}-${cloudExpiresAt}`}
                    className="notranslate rounded-2xl border border-fuchsia-200 bg-fuchsia-50/80 px-5 py-4 text-sm text-fuchsia-700 shadow-[0_12px_28px_rgba(217,70,239,0.10),0_0_26px_rgba(217,70,239,0.12)]"
                    translate="no"
                  >
                    <div className="text-[13px] text-slate-500">
                      Full access restored
                    </div>
                    <div className="mt-1.5 text-[15px] font-semibold tracking-tight">
                      Next expiry: {nextExpiry ? formatTime(nextExpiry) : "Pending calculation"}
                    </div>
                  </div>
                  <div className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-slate-400">
                    <div className="relative group shrink-0">
                      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                        <Info className="h-3 w-3" />
                      </div>
                      <div className="pointer-events-none absolute left-6 top-0 z-10 w-[260px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-600 shadow-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        Cloud stores your app data (messages, items, announcements and interactions).
                        <br />
                        Without it, your app cannot update content or receive user activity.
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div>Cloud saves your app data online.</div>
                      <div>Without it, your app can't update or receive messages.</div>
                    </div>
                  </div>
                </div>
              </div>

            {submitError ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {submitError}
              </div>
            ) : null}
            </div>
          </section>

          <aside className="relative overflow-hidden rounded-[34px] bg-white/78 shadow-[0_24px_60px_rgba(236,72,153,0.14)] ring-1 ring-white/60 backdrop-blur-xl">
            <div className="absolute top-4 right-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white shadow-[0_10px_22px_rgba(217,70,239,0.18)]">
              <DollarSign className="h-5 w-5" />
            </div>
            <div className="border-b border-slate-200/70 px-6 py-5 pr-24">
              
              <h2 className="text-2xl font-bold tracking-[-0.03em] text-[#0f172a]">Confirm and pay</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Applies to this app only. No new build will be created.</p>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div className="grid gap-3">
                {RENEW_OPTIONS.map((option) => {
                  const isSelected = option.id === selectedRenewId;
                  const dailyPrice = (Number(option.priceLabel.replace("$", "")) / option.days).toFixed(2);
                  const isBestValue = option.id === "180d";

                  return (
                    <button
                      key={option.id}
                      type="button"
                      translate="no"
                      onClick={() => setSelectedRenewId(option.id)}
                      className={`rounded-[24px] border p-5 text-left transition-all ${
                        isSelected
                          ? "scale-[1.02] border-fuchsia-400 bg-[linear-gradient(135deg,rgba(250,245,255,0.98),rgba(253,242,248,0.98))] shadow-[0_18px_38px_rgba(217,70,239,0.14)]"
                          : "border-slate-200/70 bg-white/92 shadow-[0_12px_28px_rgba(15,23,42,0.04)] hover:border-fuchsia-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-2xl font-extrabold tracking-[-0.03em] text-[#0f172a]">{option.priceLabel}</div>
                            {isBestValue ? (
                              <div className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600">
                                Best value · Save more
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-[#0f172a]">{option.label} cloud renewal</div>
                          <div className="mt-2 space-y-1.5 text-[12px] leading-5 text-slate-500">
                            <div>Restore full cloud access.</div>
                            <div>Extend service for {option.days} days from the current expiry date.</div>
                            <div>${dailyPrice} / day</div>
                          </div>
                        </div>

                        <div
                          className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border ${
                            isSelected
                              ? "border-fuchsia-500 bg-fuchsia-500 text-white"
                              : "border-slate-300 bg-white text-transparent"
                          }`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="text-center text-[12px] font-medium text-slate-500">
                Keep your app running and avoid downtime
              </div>

              <button
                type="button"
                translate="no"
                disabled={isSubmitting || isVerifyingPayment}
                onClick={async () => {
                  try {
                    setIsSubmitting(true);
                    setSubmitError("");

                    const response = await fetch("/api/stripe/create-renew-session", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        storeId,
                        renewId: selectedRenewId,
                      }),
                    });

                    const data = await response.json();

                    if (!response.ok || !data?.ok || !data?.url) {
                      throw new Error(data?.error || "Failed to create Stripe renewal session.");
                    }

                    window.location.href = data.url;
                  } catch (error) {
                    setSubmitError(error instanceof Error ? error.message : "Failed to renew cloud access.");
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="group relative w-full overflow-hidden rounded-[22px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 px-6 py-4 text-sm font-semibold text-white shadow-[0_28px_60px_rgba(236,72,153,0.32)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_35px_80px_rgba(236,72,153,0.45)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.16)_40%,transparent_72%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="relative flex items-center justify-center gap-2">
                  <span className="text-[15px]">
                    {isVerifyingPayment
                      ? "Verifying payment..."
                      : isSubmitting
                        ? "Redirecting to Stripe..."
                        : `Confirm and pay ${renewPrice}`}
                  </span>
                  <ArrowRight className="h-[15px] w-[15px] text-white/80 transition-transform duration-300 group-hover:translate-x-0.5" />
                </div>
              </button>

              <div className="text-center text-[12px] text-slate-500">
                Secure payment · Instant activation · Keep your app live and fully functional
              </div>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/history";
                }}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#475569] transition hover:border-indigo-300 hover:text-indigo-600"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to History
              </button>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
