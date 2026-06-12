"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Sparkles } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";
import { createClient } from "@/lib/supabase/client";

const ICON_DATA_URL_STORAGE_KEY = "ndjc_builder_icon_data_url";
const ICON_URL_STORAGE_KEY = "ndjc_builder_icon_url";
const ICON_FILE_NAME_STORAGE_KEY = "ndjc_builder_icon_file_name";
const CHECKOUT_APP_NAME_STORAGE_KEY = "ndjc_checkout_app_name";
const CHECKOUT_MODULE_STORAGE_KEY = "ndjc_checkout_module";
const CHECKOUT_UI_PACK_STORAGE_KEY = "ndjc_checkout_ui_pack";
const CHECKOUT_PLAN_STORAGE_KEY = "ndjc_checkout_plan";
const CHECKOUT_ADMIN_NAME_STORAGE_KEY = "ndjc_checkout_admin_name";
const CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY = "ndjc_checkout_admin_password";

export default function CheckoutPage() {
  const [appName, setAppName] = useState("Untitled Hub");
  const [moduleName, setModuleName] = useState("feature-showcase");
  const [uiPackName, setUiPackName] = useState("ui-pack-showcase-greenpink");
  const [plan, setPlan] = useState("pro");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconFileName, setIconFileName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isPageReady, setIsPageReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const nextAppName =
      params.get("appName") ||
      sessionStorage.getItem(CHECKOUT_APP_NAME_STORAGE_KEY) ||
      "Untitled Hub";

    const nextModuleName =
      params.get("module") ||
      sessionStorage.getItem(CHECKOUT_MODULE_STORAGE_KEY) ||
      "feature-showcase";

    const nextUiPackName =
      params.get("uiPack") ||
      sessionStorage.getItem(CHECKOUT_UI_PACK_STORAGE_KEY) ||
      "ui-pack-showcase-greenpink";

    const nextPlan =
      (params.get("plan") ||
        sessionStorage.getItem(CHECKOUT_PLAN_STORAGE_KEY) ||
        "pro").toLowerCase();

    const nextAdminName =
      params.get("adminName") ||
      sessionStorage.getItem(CHECKOUT_ADMIN_NAME_STORAGE_KEY) ||
      "";

    const nextAdminPassword =
      sessionStorage.getItem(CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY) ||
      "";

    sessionStorage.removeItem(CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY);

    setAppName(nextAppName);
    setModuleName(nextModuleName);
    setUiPackName(nextUiPackName);
    setPlan(nextPlan);
    setAdminName(nextAdminName);
    setAdminPassword(nextAdminPassword);

    const storedIconDataUrl = sessionStorage.getItem(ICON_DATA_URL_STORAGE_KEY);
    const storedIconUrl = sessionStorage.getItem(ICON_URL_STORAGE_KEY);
    const storedIconFileName = sessionStorage.getItem(ICON_FILE_NAME_STORAGE_KEY) || "";

    if (!storedIconUrl) {
      setIconDataUrl(null);
      setIconUrl(null);
      setIconFileName("");
      setSubmitError("App icon is missing. Please go back to Builder and upload the icon again.");
    } else {
      setIconDataUrl(storedIconDataUrl || storedIconUrl);
      setIconUrl(storedIconUrl);
      setIconFileName(storedIconFileName);
    }

    setIsPageReady(true);
  }, []);

  useEffect(() => {
    if (!isPageReady) return;

    let cancelled = false;

    async function logCheckoutOpened() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user || cancelled) return;

        const { error } = await supabase.from("user_operation_logs").insert({
          user_id: user.id,
          build_id: null,
          run_id: null,
          event_name: "checkout_opened",
          page_path: "/checkout",
          metadata: {
            appName,
            module: moduleName,
            uiPack: uiPackName,
            plan,
          },
        });

        if (error) {
          console.error("NDJC checkout: failed to write checkout_opened log", error);
        }
      } catch (error) {
        console.error("NDJC checkout: failed to log checkout_opened", error);
      }
    }

    void logCheckoutOpened();

    return () => {
      cancelled = true;
    };
  }, [isPageReady, appName, moduleName, uiPackName, plan]);

  const modeLabel = plan === "free" ? "Free Trial" : "Paid Purchase";
  const planLabel = plan === "free" ? "Free" : "Pro";

  if (!isPageReady) {
    return (
      <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
        <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

        <SiteHeader
          nextPath="/checkout"
        />

        <section className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 md:pb-20 md:pt-10">
          <div className="mb-8 text-left md:mb-10 md:text-center">
            <h1 className="text-[34px] font-extrabold leading-[1.04] tracking-[-0.05em] sm:text-5xl md:text-6xl">
              Review your customer hub
            </h1>
            <p className="mt-4 text-sm leading-7 text-[#64748b] md:text-base">
              Loading customer hub details...
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader
        nextPath="/checkout"
      />

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-10">
        <div className="mb-8 text-left md:mb-10 md:text-center">
          <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">
            Review your customer hub
          </h1>
          <p className="mt-4 text-sm leading-7 text-[#64748b] md:text-base">
            Confirm your plan, cloud access, and customer hub package before continuing
          </p>

          <div className="mt-6 hidden items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 shadow backdrop-blur md:inline-flex">
            <span>Builder</span>
            <span>→</span>
            <span className="text-fuchsia-600">Checkout</span>
            <span>→</span>
            <span>Generate</span>
            <span>→</span>
            <span>Download</span>
          </div>
        </div>

        <div className="grid gap-6 md:gap-8 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
          <div className="p-0 md:p-4">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex rounded-full border border-indigo-200/55 bg-indigo-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-indigo-500">
                  Order Summary
                </div>
                <h2 className="text-xl font-bold tracking-[-0.03em] text-[#0f172a] md:text-2xl">Your selected customer hub</h2>
                <p className="mt-2 text-sm leading-7 text-[#64748b]">
                  {plan === "free"
                    ? "This checkout confirms your Think it Done free trial customer hub package, including cloud backend lifecycle management: active during the included period, read-only after expiry, and permanently deleted on day 60 after expiry."
                    : "Review your customer hub setup and the Pro plan benefits before payment."}
                </p>
              </div>
<div className="hidden md:flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-[#6172d6] to-[#7c88e8] text-white shadow-[0_10px_22px_rgba(99,102,241,0.14)]">
  <Sparkles className="h-5 w-5 shrink-0" />
</div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[22px] bg-[linear-gradient(135deg,rgba(99,102,241,0.98),rgba(217,70,239,0.98))] p-4 text-white shadow-[0_18px_40px_rgba(124,58,237,0.20)] md:rounded-[24px] md:p-5">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/75">Selected customer hub</div>
                <div className="mt-2 break-words text-xl font-semibold tracking-[-0.03em] md:text-2xl">{appName}</div>
                <div className="mt-2 text-sm leading-7 text-white/82">
                  Showcase Hub with Clean Neutral Style, prepared as a shareable PWA package.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.03)] sm:px-4 sm:py-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">App Name</div>
                  <div className="mt-1.5 break-words text-[13px] font-semibold text-[#0f172a] sm:mt-2 sm:text-sm">{appName}</div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.03)] sm:px-4 sm:py-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">Plan</div>
                  <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600 sm:mt-2 sm:gap-2">
                    <Check className="h-3.5 w-3.5" />
                    {planLabel}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.03)] sm:px-4 sm:py-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">Template</div>
                  <div className="mt-1.5 break-words text-[13px] font-semibold text-[#0f172a] sm:mt-2 sm:text-sm">Showcase Hub</div>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.03)] sm:px-4 sm:py-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">Visual Style</div>
                  <div className="mt-1.5 break-words text-[13px] font-semibold text-[#0f172a] sm:mt-2 sm:text-sm">Clean Neutral Style</div>
                </div>
                <div className="col-span-2 rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.03)] sm:px-4 sm:py-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">App Icon</div>

                  {iconDataUrl ? (
                    <div className="mt-3 flex items-center gap-4">
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                        <img
                          src={iconDataUrl}
                          alt={iconFileName || "App icon preview"}
                          className="h-full w-full object-cover"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-semibold text-[#0f172a] sm:truncate">
                          {iconFileName || "Custom icon selected"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Uploaded from Builder
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm font-semibold text-[#0f172a]">
                      No custom icon selected
                    </div>
                  )}
                </div>
              </div>

              <div className="my-6 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <ShieldCheck className="h-4.5 w-4.5 text-fuchsia-500" />
                  <div className="text-sm font-semibold text-[#0f172a]">Included in {planLabel} plan</div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-500">
                      Download package
                    </div>
                    <div className="mt-2 text-sm font-semibold leading-6 text-[#0f172a]">
                      Guide, URL, and QR code
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[#64748b]">
                      Includes the launch guide, customer hub URL, and QR code.
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-500">
                      Cloud service
                    </div>
                    <div className="mt-2 text-sm font-semibold leading-6 text-[#0f172a]">
                      {plan === "free" ? "7 days included" : "30 days included"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[#64748b]">
                      Cloud backend and push notifications.
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-500">
                      {plan === "free" ? "Upgrade" : "Renewal"}
                    </div>
                    <div className="mt-2 text-sm font-semibold leading-6 text-[#0f172a]">
                      {plan === "free" ? "Generate a Pro hub later" : "Renew cloud after 30 days"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[#64748b]">
                      {plan === "free"
                        ? "Generate a Pro hub for long-term cloud use."
                        : "Renew cloud service after the included period."}
                    </div>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    After the included period
                  </div>

                  <div className="space-y-3 text-sm text-[#475569]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-[#0f172a]">After expiry</span>
                        <span className="text-xs leading-5 text-slate-500">
                          Customers can still view your hub, but new bookings, chats, and updates are disabled.
                        </span>
                      </div>
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-[#0f172a]">Data deletion</span>
                        <span className="text-xs leading-5 text-slate-500">
                          Cloud data is permanently deleted on day 60 after expiry if not renewed.
                        </span>
                      </div>
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-[#0f172a]">Cloud status</span>
                        <span className="text-xs leading-5 text-slate-500">
                          Cloud status is visible inside your customer hub.
                        </span>
                      </div>
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span>Generation mode</span>
                      <span className="text-sm font-semibold text-[#0f172a]">{modeLabel}</span>
                    </div>
                  </div>
                </div>
              </div>

              {submitError ? (
                <div className="break-words rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-600">
                  {submitError}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-8 xl:scale-[1.04]">
            <section className="overflow-hidden rounded-[26px] bg-white/50 shadow-[0_18px_50px_rgba(236,72,153,0.14)] backdrop-blur-xl md:rounded-[32px]">
              <div className="border-b border-slate-200/70 px-5 py-4 md:px-6 md:py-5">
                <div className="mb-3 inline-flex rounded-full border border-fuchsia-200/70 bg-fuchsia-50/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-fuchsia-600">
                  Payment
                </div>
                <h2 className="text-xl font-bold tracking-[-0.03em] text-[#0f172a] md:text-2xl">Confirm and generate</h2>
              </div>

              <div className="space-y-5 px-5 py-5 md:px-6 md:py-6">
                <div className="rounded-[22px] border border-slate-200/70 bg-white/90 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.03)] md:rounded-[24px] md:p-5">
<div className="text-2xl font-extrabold tracking-[-0.03em] text-[#0f172a] md:text-3xl">
  {plan === "free" ? "$0.00" : "$99.00"}
</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {plan === "free" ? "Free trial customer hub" : "One-time customer hub generation payment"}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    {plan === "free"
                      ? "7-day cloud backend included"
                      : "30-day cloud backend included · Renewal required for continued full cloud access"}
                  </div>
                </div>

                <div className="rounded-[22px] bg-[linear-gradient(135deg,rgba(250,245,255,0.98),rgba(253,242,248,0.98))] p-4 shadow-[0_18px_40px_rgba(217,70,239,0.10)] md:rounded-[24px] md:p-5">
                  <div className="mb-2 inline-flex rounded-full border border-fuchsia-200/80 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600">
                    Most popular
                  </div>
                  <div className="text-sm font-semibold text-fuchsia-700">
                    {plan === "free"
                      ? "Free trial customer hub with 7-day cloud backend"
                      : "One payment, one Pro customer hub package with 30-day cloud backend"}
                  </div>
<div className="mt-2 text-sm leading-7 text-fuchsia-700/72">
  {plan === "free"
    ? "After generation, cloud service and push notifications are active for 7 days. After expiry, customers can still view your hub, but bookings, chats, and updates are disabled."
    : "After payment, generation starts automatically. Pro includes 30 days of cloud service and push notifications. Renew to keep bookings, chats, and updates active after expiry."}
</div>

{plan === "free" ? null : (
  <div className="mt-4 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 px-4 py-4">
    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600">
      CLOUD RENEWAL
    </div>
    <div className="mt-2 break-words text-sm font-medium leading-7 text-fuchsia-700">
      Sign in → Account → History → Select your hub → Renew cloud
    </div>
  </div>
)}
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={async () => {
                      try {
                        setIsSubmitting(true);
                        setSubmitError("");

                        if (!adminPassword) {
                          throw new Error("Admin password has expired for security reasons. Please go back to Builder and enter it again.");
                        }

                        if (!iconUrl) {
                          throw new Error("App icon is missing. Please go back to Builder and upload the icon again.");
                        }

                        if (plan === "free") {
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
                              iconUrl,
                            }),
                          });

                          const data = await response.json();

                          if (!response.ok || !data.ok || !data.runId) {
                            throw new Error(data.error || "Failed to start build.");
                          }

                          sessionStorage.removeItem(ICON_DATA_URL_STORAGE_KEY);
                          sessionStorage.removeItem(ICON_URL_STORAGE_KEY);
                          sessionStorage.removeItem(ICON_FILE_NAME_STORAGE_KEY);
                          window.location.href = `/result?runId=${encodeURIComponent(data.runId)}`;
                          return;
                        }

const response = await fetch("/api/paypal/create-generate-order", {
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
    iconUrl,
  }),
});

const data = await response.json().catch(() => null);

if (!response.ok || !data?.ok || !data?.url) {
  throw new Error(data?.error || `Failed to create PayPal checkout order. Status=${response.status}`);
}

sessionStorage.removeItem(CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY);
sessionStorage.removeItem(ICON_DATA_URL_STORAGE_KEY);
sessionStorage.removeItem(ICON_URL_STORAGE_KEY);
sessionStorage.removeItem(ICON_FILE_NAME_STORAGE_KEY);
window.location.href = data.url;
                      } catch (error) {
                        setSubmitError(error instanceof Error ? error.message : "Failed to continue to payment.");
                        setIsSubmitting(false);
                      }
                    }}
                    className="group relative w-full overflow-hidden rounded-[22px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 px-6 py-4 text-sm font-semibold text-white shadow-[0_28px_60px_rgba(236,72,153,0.32)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_35px_80px_rgba(236,72,153,0.45)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.16)_40%,transparent_72%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="relative flex items-center justify-center gap-2">
                      <span className="text-[15px]">
{isSubmitting
  ? plan === "free"
    ? "Generating..."
    : "Redirecting to PayPal..."
  : plan === "free"
    ? "Generate Free Hub"
    : "Pay $99 & Create Hub"}
                      </span>
                      <ArrowRight className="h-[15px] w-[15px] text-white/80 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </div>
                  </button>

                  <p className="break-words text-center text-xs leading-5 text-slate-500">
                    By continuing, you agree to the{" "}
                    <a className="font-semibold text-[#0f172a] underline underline-offset-4" href="/terms">
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a className="font-semibold text-[#0f172a] underline underline-offset-4" href="/refund">
                      Refund Policy
                    </a>
                    . Cloud access is included for the selected period. After expiry, your customer hub may become read-only or write-disabled depending on the plan, and cloud data will be permanently deleted on day 60 after expiry if not renewed.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams({
                        appName,
                        module: moduleName,
                        uiPack: uiPackName,
                        plan,
                        adminName,
                      });
                      window.location.href = `/builder?${params.toString()}`;
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-[20px] border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#475569] transition hover:border-indigo-300 hover:text-indigo-600"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Builder
                  </button>
                </div>

                <div className="break-words text-center text-[11px] leading-6 text-[#94a3b8]">
                  🔒 Secure PayPal checkout · Support:{" "}
                  <a className="font-semibold underline underline-offset-4" href="mailto:support@thinkitdoneapp.com">
                    support@thinkitdoneapp.com
                  </a>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
