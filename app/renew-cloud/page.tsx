"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/components/layout/SiteHeader";
import { ArrowLeft, ArrowRight, CheckCircle2, Info } from "lucide-react";

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
  { id: "30d", label: "30 days", priceLabel: "$39", days: 30 },
  { id: "90d", label: "90 days", priceLabel: "$117", days: 90 },
  { id: "180d", label: "180 days", priceLabel: "$234", days: 180 },
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
  const paypalSuccess = params.get("paypalSuccess");
  const paypalOrderId = params.get("token") || "";
  const paypalRenewId = params.get("renewId") || "";

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const redirectAfterRenewal = (input: {
    finalStoreId: string;
    finalRenewId: string;
  }) => {
    window.location.href = `/history?renewed=1&storeId=${encodeURIComponent(input.finalStoreId)}&renewPlan=${encodeURIComponent(input.finalRenewId)}`;
  };

  if (paypalSuccess === "1") {
    if (!paypalOrderId) {
      setSubmitError("Missing PayPal order token in return URL.");
      return;
    }

    const capturePayPalRenewal = async () => {
      try {
        setIsVerifyingPayment(true);
        setSubmitError("");

        const captureKey = `ndjc_paypal_capture_${paypalOrderId}`;

        if (window.sessionStorage.getItem(captureKey) !== "1") {
          window.sessionStorage.setItem(captureKey, "1");

          const response = await fetch("/api/paypal/capture-order", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              paypalOrderId,
              expectedKind: "renew_cloud",
            }),
          });

          const data = await response.json().catch(() => null);

          if (cancelled) return;

          if (!response.ok || !data?.ok) {
            window.sessionStorage.removeItem(captureKey);
            throw new Error(data?.error || "Failed to capture PayPal renewal payment.");
          }

          const finalStoreId =
            typeof data?.storeId === "string" && data.storeId.trim()
              ? data.storeId.trim()
              : storeId;

          const finalRenewId =
            data?.renewId === "30d" ||
            data?.renewId === "90d" ||
            data?.renewId === "180d"
              ? data.renewId
              : paypalRenewId === "30d" ||
                  paypalRenewId === "90d" ||
                  paypalRenewId === "180d"
                ? paypalRenewId
                : selectedRenewId;

          if (finalStoreId) {
            redirectAfterRenewal({
              finalStoreId,
              finalRenewId,
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          setSubmitError(error instanceof Error ? error.message : "Failed to renew cloud access.");
        }
      } finally {
        if (!cancelled) {
          setIsVerifyingPayment(false);
        }
      }
    };

    void capturePayPalRenewal();

    return () => {
      cancelled = true;
    };
  }

  if (stripeSuccess !== "1") {
    return;
  }

  if (!sessionId) {
    setSubmitError("Missing Stripe session_id in return URL.");
    return;
  }

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

        redirectAfterRenewal({
          finalStoreId,
          finalRenewId,
        });
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
    : Math.max(0, Math.floor((currentExpiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  const expiryCountdownLabel =
    daysUntilExpiry === null
      ? null
      : daysUntilExpiry === 0
        ? "Less than 1 day left"
        : `${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"} left`;
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
    cloudStatus === "active"
      ? "rounded-[22px] border border-emerald-200/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.92),rgba(255,255,255,0.96))] px-4 py-4 shadow-[0_10px_26px_rgba(16,185,129,0.06),0_0_26px_rgba(16,185,129,0.10)]"
      : cloudStatus === "read_only"
        ? "rounded-[22px] border border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,251,235,0.92),rgba(255,255,255,0.96))] px-4 py-4 shadow-[0_10px_26px_rgba(245,158,11,0.06),0_0_26px_rgba(245,158,11,0.10)]"
        : cloudStatus === "deleted"
          ? "rounded-[22px] border border-red-200/80 bg-[linear-gradient(180deg,rgba(254,242,242,0.92),rgba(255,255,255,0.96))] px-4 py-4 shadow-[0_10px_26px_rgba(239,68,68,0.06),0_0_26px_rgba(248,113,113,0.10)]"
          : "rounded-[22px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.96))] px-4 py-4 shadow-[0_10px_26px_rgba(148,163,184,0.06),0_0_26px_rgba(148,163,184,0.10)]";

  const cloudStatusHintLabel =
    cloudStatus === "active"
      ? "Active"
      : cloudStatus === "read_only"
        ? "Read-only"
        : cloudStatus === "deleted"
          ? "Deleted"
          : "Unknown";

  const canRenewCloud =
    Boolean(storeId) && (cloudStatus === "active" || cloudStatus === "read_only");

  if (!isPageReady) {
    return (
      <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />
      <SiteHeader compact={isHeaderCompact} navItems={[]} nextPath="/" />
        <section className="relative z-10 mx-auto max-w-5xl px-6 pb-20 pt-16">
          <div className="text-center">
            <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">Renew cloud service</h1>
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
          <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">Renew cloud service</h1>
          <p className="mt-4 text-base text-[#64748b]">
            Extend cloud service to keep bookings, chats, updates, and push notifications active.
          </p>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-12">
          <section className="relative space-y-6">
            <div className="space-y-6">
              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Customer hub info
                </div>

                <div className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(248,250,252,0.84)_42%,rgba(239,246,255,0.72)_100%)] px-6 py-6 shadow-[0_24px_70px_rgba(15,23,42,0.08),0_0_46px_rgba(99,102,241,0.10)] backdrop-blur-xl">
                  <div className="pointer-events-none absolute -left-16 -top-20 h-48 w-48 rounded-full bg-sky-200/28 blur-3xl" />
                  <div className="pointer-events-none absolute -right-20 top-10 h-52 w-52 rounded-full bg-fuchsia-200/20 blur-3xl" />
                  <div className="pointer-events-none absolute bottom-0 left-1/2 h-28 w-72 -translate-x-1/2 rounded-full bg-emerald-100/24 blur-3xl" />
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 104 72"
                    className="pointer-events-none absolute right-6 top-5 h-24 w-28 text-sky-100/70"
                    fill="none"
                  >
                    <path
                      d="M29.5 57H75.5C87.5 57 96 48.8 96 38.5C96 28.2 87.6 20 76.8 20C72.7 9.8 62.6 4 50.8 4C36.7 4 25.2 14.1 23.8 27.7C15.1 28.5 8 35.2 8 43.3C8 51.1 14.2 57 22.6 57H29.5Z"
                      stroke="currentColor"
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>

                  <div className="relative z-10 flex flex-wrap items-start justify-between gap-4 pr-24">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Customer hub
                      </div>
                      <div className="mt-2 text-[28px] font-bold leading-none tracking-[-0.04em] text-[#0f172a]">
                        {appName}
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 mt-5">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Store ID
                    </div>
                    <div className="mt-1 break-all text-sm font-semibold text-sky-700">
                      {storeId}
                    </div>
                    <div className="mt-2 text-[13px] leading-6 text-slate-500">
                      This renewal applies only to this customer hub.
                    </div>
                  </div>

                  <div className="relative z-10 my-6 h-px bg-slate-200/70" />

                  <div className="relative z-10">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Current cloud service
                    </div>

                    <div className="mt-3">
                      {expiryCountdownLabel && cloudStatus !== "deleted" ? (
                        <div className="text-[30px] font-extrabold leading-none tracking-[-0.05em] text-[#0f172a]">
                          {cloudStatus === "active" ? expiryCountdownLabel : `⚠ ${expiryCountdownLabel}`}
                        </div>
                      ) : (
                        <div className="text-[30px] font-extrabold leading-none tracking-[-0.05em] text-[#0f172a]">
                          Status pending
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <div className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusBadgeClassName}`}>
                          {cloudStatusHintLabel}
                        </div>
                        <div className="text-sm leading-6 text-slate-500">
                          {cloudStatusLine}
                        </div>
                      </div>

                      <div className="mt-3 text-[13px] leading-6 text-slate-600">
                        Renewal extends this cloud service from the current expiry date.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  After this renewal
                </div>
                <div>
                  <div className="relative overflow-hidden rounded-[28px] border border-fuchsia-100/90 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(253,244,255,0.74)_46%,rgba(255,241,242,0.58)_100%)] px-6 py-5 text-sm text-fuchsia-700 shadow-[0_24px_70px_rgba(217,70,239,0.10),0_0_42px_rgba(244,114,182,0.12)] backdrop-blur-xl">
                    <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-fuchsia-200/24 blur-3xl" />
                    <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-rose-100/28 blur-3xl" />

                    <div className="relative z-10 text-[13px] text-slate-500">
                      Cloud service extended
                    </div>

                    <div className="relative z-10 mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] sm:items-center">
                      <div className="text-center">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                          Current expiry
                        </div>
                        <div className="mt-2 text-[15px] font-semibold tracking-tight text-[#0f172a]">
                          {cloudExpiresAt ? formatTime(cloudExpiresAt) : "Unknown"}
                        </div>
                      </div>

                      <div className="flex items-center justify-center">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-fuchsia-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.92)_0%,rgba(252,231,243,0.96)_100%)] shadow-[0_12px_30px_rgba(217,70,239,0.14)]">
                          <ArrowRight className="h-5 w-5 rotate-90 text-fuchsia-500 sm:rotate-0" />
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-500">
                          New expiry
                        </div>
                        <div className="mt-2 text-[15px] font-semibold tracking-tight text-fuchsia-700">
                          {nextExpiry ? formatTime(nextExpiry) : "Pending calculation"}
                        </div>
                      </div>
                    </div>

                    <div className="relative z-10 mt-4 h-px bg-fuchsia-100/80" />

                    <div className="relative z-10 mt-3 text-[13px] leading-6 text-slate-500">
                      Your cloud service will be extended from the current expiry date.
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      What stays active
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center gap-3 rounded-[22px] border border-slate-200/70 bg-white/80 px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] backdrop-blur-xl">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        <div>
                          <div className="text-sm font-semibold text-[#0f172a]">Bookings</div>
                          <div className="mt-0.5 text-xs leading-5 text-slate-500">Booking requests stay active.</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-[22px] border border-slate-200/70 bg-white/80 px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] backdrop-blur-xl">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        <div>
                          <div className="text-sm font-semibold text-[#0f172a]">Chats</div>
                          <div className="mt-0.5 text-xs leading-5 text-slate-500">Customer conversations stay active.</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-[22px] border border-slate-200/70 bg-white/80 px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] backdrop-blur-xl">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        <div>
                          <div className="text-sm font-semibold text-[#0f172a]">Updates</div>
                          <div className="mt-0.5 text-xs leading-5 text-slate-500">Content updates stay available.</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-[22px] border border-slate-200/70 bg-white/80 px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] backdrop-blur-xl">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        <div>
                          <div className="text-sm font-semibold text-[#0f172a]">Push notifications</div>
                          <div className="mt-0.5 text-xs leading-5 text-slate-500">Push notifications stay active.</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-slate-400">
                      <div className="relative group shrink-0">
                        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                          <Info className="h-3 w-3" />
                        </div>
                        <div className="pointer-events-none absolute left-6 top-0 z-10 w-[260px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-600 shadow-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          Cloud stores customer hub data such as bookings, chats, updates, items, and interactions.
                          <br />
                          Without active cloud service, new bookings, chats, updates, and push notifications are disabled.
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div>Cloud data stays available while the service is active.</div>
                        <div>Renewal extends the current cloud service for this customer hub.</div>
                      </div>
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
            <div className="border-b border-slate-200/70 px-6 py-5">
              <h2 className="text-2xl font-bold tracking-[-0.03em] text-[#0f172a]">Choose renewal period</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Applies to this customer hub only. No new hub will be generated.</p>
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
                      onClick={() => setSelectedRenewId(option.id)}
                      className={`rounded-[22px] border px-5 py-4 text-left transition-all ${
                        isSelected
                          ? "scale-[1.015] border-fuchsia-400 bg-[linear-gradient(135deg,rgba(250,245,255,0.98),rgba(253,242,248,0.98))] shadow-[0_16px_34px_rgba(217,70,239,0.13)]"
                          : "border-slate-200/70 bg-white/92 shadow-[0_10px_24px_rgba(15,23,42,0.04)] hover:border-fuchsia-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-[23px] font-extrabold leading-none tracking-[-0.03em] text-[#0f172a]">{option.priceLabel}</div>
                            {isBestValue ? (
                              <div className="inline-flex items-center rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600">
                                Best value
                              </div>
                            ) : null}
                          </div>

                          <div className="mt-1.5 text-sm font-semibold text-[#0f172a]">
                            {option.label} renewal
                          </div>

                          <div className="mt-2 space-y-1 text-[12px] leading-4 text-slate-500">
                            <div>
                              {option.id === "30d"
                                ? "Short extension"
                                : option.id === "90d"
                                  ? "Fewer renewals"
                                  : "Best value"}
                            </div>
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
                Keep your customer hub active
              </div>

              <button
                type="button"
                disabled={isSubmitting || isVerifyingPayment || !canRenewCloud}
                onClick={async () => {
                  if (!canRenewCloud) {
                    setSubmitError("This cloud store is no longer renewable.");
                    return;
                  }

                  try {
                    setIsSubmitting(true);
                    setSubmitError("");

const response = await fetch("/api/paypal/create-renew-order", {
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
  throw new Error(data?.error || "Failed to create PayPal renewal order.");
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
                    {!canRenewCloud
                      ? "Cloud not renewable"
                      : isVerifyingPayment
                        ? "Verifying payment..."
: isSubmitting
  ? "Redirecting to PayPal..."
  : `Confirm and pay ${renewPrice}`}
                  </span>
                  <ArrowRight className="h-[15px] w-[15px] text-white/80 transition-transform duration-300 group-hover:translate-x-0.5" />
                </div>
              </button>

              <div className="text-center text-[12px] text-slate-500">
                Secure payment · Instant activation · Keep cloud features active
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
