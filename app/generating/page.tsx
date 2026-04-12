"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { CheckCircle2, Circle, Clock3, House, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";

type BuildStage =
  | "queued"
  | "preparing_request"
  | "processing_identity"
  | "matching_logic_module"
  | "applying_ui_pack"
  | "preparing_services"
  | "building_apk"
  | "success"
  | "failed";

type BuildStatusResponse = {
  ok: boolean;
  runId?: string;
  stage?: BuildStage;
  failedStep?: StepKey;
  message?: string;
  artifactUrl?: string | null;
  downloadUrl?: string | null;
  queueAheadCount?: number;
  runningCount?: number;
  concurrencyLimit?: number;
  error?: string;
};

type StepKey =
  | "preparing_request"
  | "processing_identity"
  | "matching_logic_module"
  | "applying_ui_pack"
  | "preparing_services"
  | "building_apk";

type StepStatus = "done" | "active" | "pending" | "failed";

const STEP_ORDER: { key: StepKey; title: string }[] = [
  { key: "preparing_request", title: "Preparing build request" },
  { key: "processing_identity", title: "Processing app identity" },
  { key: "matching_logic_module", title: "Matching logic module" },
  { key: "applying_ui_pack", title: "Applying UI pack" },
  { key: "preparing_services", title: "Preparing app services and signing" },
  { key: "building_apk", title: "Building and packaging APK" },
];

const ACTIVE_LABEL: Record<StepKey, string> = {
  preparing_request: "Preparing build request",
  processing_identity: "Processing app identity",
  matching_logic_module: "Matching logic module",
  applying_ui_pack: "Applying UI pack",
  preparing_services: "Preparing app services and signing",
  building_apk: "Building and packaging APK",
};

function mapStageToSteps(stage: BuildStage | undefined, failedStep?: StepKey) {
  const currentIndexMap: Record<StepKey, number> = {
    preparing_request: 0,
    processing_identity: 1,
    matching_logic_module: 2,
    applying_ui_pack: 3,
    preparing_services: 4,
    building_apk: 5,
  };

  if (!stage || stage === "queued") {
    return STEP_ORDER.map((step) => ({
      ...step,
      status: "pending" as StepStatus,
    }));
  }

  if (stage === "failed") {
    const failedIndex = typeof failedStep === "string" ? currentIndexMap[failedStep] : undefined;

    if (typeof failedIndex === "number") {
      return STEP_ORDER.map((step, index) => ({
        ...step,
        status:
          index < failedIndex
            ? ("done" as StepStatus)
            : index === failedIndex
              ? ("failed" as StepStatus)
              : ("pending" as StepStatus),
      }));
    }

    return STEP_ORDER.map((step, index) => ({
      ...step,
      status: index === 0 ? ("failed" as StepStatus) : ("pending" as StepStatus),
    }));
  }

  if (stage === "success") {
    return STEP_ORDER.map((step) => ({ ...step, status: "done" as StepStatus }));
  }

  const currentIndex = currentIndexMap[stage];

  return STEP_ORDER.map((step, index) => ({
    ...step,
    status:
      index < currentIndex
        ? ("done" as StepStatus)
        : index === currentIndex
          ? ("active" as StepStatus)
          : ("pending" as StepStatus),
  }));
}

export default function GeneratingPage() {
  const previewMode = false;
  const previewStage = "queued" as BuildStage;

  function getPreviewMessage(stage: BuildStage) {
    if (stage === "success") {
      return "Your app package has been generated successfully.";
    }
    if (stage === "failed") {
      return "Build stopped because one of the packaging steps did not complete.";
    }
    return "Your request has been received and is waiting for an available build slot.";
  }

  const previewMessage = getPreviewMessage(previewStage);
  const previewDownloadUrl = "/result?demo=1";
  const previewQueueAheadCount = 3;
  const [runId, setRunId] = useState("");
  const [stage, setStage] = useState<BuildStage | undefined>(undefined);
  const [message, setMessage] = useState("Waiting for live build status...");
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [queueAheadCount, setQueueAheadCount] = useState<number | null>(null);
  const [failedStep, setFailedStep] = useState<StepKey | undefined>(undefined);
const [hasLoggedPollOpen, setHasLoggedPollOpen] = useState(false);
const startTimeRef = useRef(Date.now());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryRunId = params.get("runId") || "";
    setRunId(queryRunId);
  }, []);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const pollEvent = hasLoggedPollOpen ? "" : "&event=poll";
const params = new URLSearchParams(window.location.search);
const paid = params.get("paid") === "1";

const response = await fetch(
  `/api/build-status?runId=${encodeURIComponent(runId)}${pollEvent}&paid=${paid ? "1" : "0"}&t=${startTimeRef.current}`,
  {
    cache: "no-store",
  },
);

        const data: BuildStatusResponse = await response.json();

        if (cancelled) return;

        if (!response.ok || !data.ok) {
          setError(data.error || "Failed to load build status.");
          setDownloadUrl("");
          setQueueAheadCount(null);
          setFailedStep(undefined);
          return;
        }

        setStage(data.stage);
        setMessage(data.message || "Generating...");
        setError("");
        setDownloadUrl(data.downloadUrl || "");
        setQueueAheadCount(typeof data.queueAheadCount === "number" ? data.queueAheadCount : null);
        setFailedStep(data.failedStep);

        if (!hasLoggedPollOpen) {
          setHasLoggedPollOpen(true);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load build status.");
        setDownloadUrl("");
        setQueueAheadCount(null);
        setFailedStep(undefined);
      }
    };

    fetchStatus();
    const timer = window.setInterval(fetchStatus, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runId, hasLoggedPollOpen]);

  const effectiveStage = previewMode ? previewStage : stage;
  const effectiveMessage = previewMode ? previewMessage : message;
  const effectiveError = previewMode && previewStage === "failed" ? previewMessage : error;
  const effectiveDownloadUrl = previewMode ? previewDownloadUrl : downloadUrl;
  const effectiveQueueAheadCount = previewMode ? previewQueueAheadCount : queueAheadCount;
  const effectiveFailedStep = previewMode ? undefined : failedStep;

  const steps = useMemo(() => mapStageToSteps(effectiveStage, effectiveFailedStep), [effectiveStage, effectiveFailedStep]);
  useEffect(() => {
    if (previewMode) return;
    if (stage !== "success" || !runId) return;

    const redirectTimer = window.setTimeout(() => {
      window.location.href = `/result?runId=${encodeURIComponent(runId)}`;
    }, 1200);

    return () => {
      window.clearTimeout(redirectTimer);
    };
  }, [stage, runId]);

  const currentActivity = useMemo(() => {
    if (effectiveStage === "queued") return "Waiting in build queue";
    if (effectiveStage === "success") return "Build completed";
    if (effectiveStage === "failed") {
      return effectiveFailedStep ? `${ACTIVE_LABEL[effectiveFailedStep]} failed` : "Build failed";
    }
    if (!effectiveStage) return "Preparing build request";
    return ACTIVE_LABEL[effectiveStage as StepKey] || "Generating";
  }, [effectiveStage, effectiveFailedStep]);

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader
        nextPath="/generating"
      />

      <section className="relative z-10 mx-auto max-w-3xl px-6 py-14">
        <div className="text-center">
          <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">Generating your app</h1>
          <p className="mt-2 text-lg text-[#64748b]">The full build process may take up to 10 minutes</p>
          {previewMode ? (
            <div className="mt-2 inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50/80 px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] text-amber-700 shadow-[0_6px_16px_rgba(15,23,42,0.04)] backdrop-blur">
              PREVIEW MODE · {previewStage === "success" ? "SUCCESS STATE" : previewStage === "failed" ? "FAILED STATE" : "QUEUE STATE"}
            </div>
          ) : runId ? (
            <div className="mt-2 inline-flex items-center rounded-full border border-slate-200/80 bg-white/75 px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] text-slate-400 shadow-[0_6px_16px_rgba(15,23,42,0.04)] backdrop-blur">
              RUN ID · {runId}
            </div>
          ) : null}
        </div>

        <>
          {effectiveStage !== "success" ? (
            effectiveStage === "queued" ? (
              <div className="mt-6 overflow-hidden rounded-[28px] border border-white/60 bg-white/75 p-5 text-center shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl md:p-6">
                <div className="mx-auto mb-4 h-px w-24 bg-gradient-to-r from-transparent via-sky-300/80 to-transparent" />
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Build queue</div>
                <div className="mt-3 flex items-center justify-center gap-3">
                  <Clock3 className="h-5 w-5 text-sky-500" />
                  <div className="text-2xl font-bold tracking-[-0.03em]">{currentActivity}</div>
                </div>
                <div className="mt-2 text-xs text-slate-400">Your build has been accepted and will start automatically.</div>

                <div className="mx-auto mt-5 flex max-w-[420px] items-center justify-center gap-3">
                  <div className="min-w-0 text-left">
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-extrabold tracking-[-0.06em] text-slate-950">
                        {typeof effectiveQueueAheadCount === "number" ? effectiveQueueAheadCount : "--"}
                      </span>
                      <span className="pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-500/80">
                        {typeof effectiveQueueAheadCount === "number" && effectiveQueueAheadCount === 1 ? "person ahead" : "people ahead"}
                      </span>
                    </div>
                    <div className="mt-1 text-sm leading-6 text-slate-500">
                      {typeof effectiveQueueAheadCount === "number"
                        ? effectiveQueueAheadCount === 0
                          ? "No one is ahead of you. Your build should start very soon."
                          : `There ${effectiveQueueAheadCount > 1 ? "are" : "is"} ${effectiveQueueAheadCount} ${effectiveQueueAheadCount > 1 ? "people" : "person"} ahead of you in queue.`
                        : "Queue position is updating..."}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-slate-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-sky-300 [animation-delay:180ms]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-300 [animation-delay:360ms]" />
                  <span className="ml-1">We’ll start your build automatically.</span>
                </div>
              </div>
            ) : (
              <div className="mt-6 overflow-hidden rounded-[28px] border border-white/60 bg-white/75 p-5 text-center shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl md:p-6">
                <div className="mx-auto mb-5 h-px w-28 bg-gradient-to-r from-transparent via-fuchsia-300/80 to-transparent" />
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Current activity</div>
                <div className="mt-3 flex items-center justify-center gap-3">
                  <LoaderCircle className="h-5 w-5 animate-spin text-fuchsia-500" />
                  <div className="text-2xl font-bold tracking-[-0.03em]">{currentActivity}</div>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Step {Math.max(1, steps.findIndex((step) => step.status === "active") + 1)} of 6
                </div>
                <div className="mx-auto mt-2 h-1.5 w-full max-w-[360px] overflow-hidden rounded-full bg-slate-200/60">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-all duration-500"
                    style={{
                      width: `${(Math.max(1, steps.findIndex((step) => step.status === "active") + 1) / 6) * 100}%`,
                    }}
                  />
                </div>
                <div className="mt-3 text-sm leading-7 text-slate-500">{effectiveError || effectiveMessage}</div>
              </div>
            )
          ) : null}

          {effectiveStage === "failed" || effectiveError ? (
            <div className="mt-6 rounded-[24px] border border-red-200 bg-red-50/80 p-5 shadow-[0_8px_18px_rgba(15,23,42,0.03)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <TriangleAlert className="h-5 w-5 text-red-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-red-700">Build failed</div>
                  <div className="mt-2 text-sm leading-7 text-red-600/90">
                    {effectiveError || effectiveMessage || "Something went wrong during the build process."}
                  </div>
                  <div className="mt-2 text-xs font-medium uppercase tracking-[0.12em] text-red-500/80">
                    Failed at: {steps.find((step) => step.status === "failed")?.title || (effectiveFailedStep ? ACTIVE_LABEL[effectiveFailedStep] : currentActivity)}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Retry
                </button>

                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/";
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  <House className="h-4 w-4" />
                  Back to Home
                </button>
              </div>
            </div>
          ) : null}

          {effectiveStage === "success" && effectiveDownloadUrl ? (
            <div className="mt-8 overflow-hidden rounded-[28px] border border-emerald-200/80 bg-[linear-gradient(135deg,rgba(240,253,244,0.96),rgba(255,255,255,0.96))] p-5 shadow-[0_16px_40px_rgba(16,185,129,0.10)] md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Build completed
                  </div>
                  <div className="mt-4 text-lg font-semibold tracking-[-0.02em] text-emerald-950">
                    Redirecting to result page...
                  </div>
                  <div className="mt-4 text-sm leading-7 text-emerald-700/90">
                    Your app package is ready. Opening the result page automatically in a moment.
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = previewMode ? effectiveDownloadUrl : `/result?runId=${encodeURIComponent(runId)}`;
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/90 px-4 py-2.5 text-sm font-medium text-slate-600 shadow-[0_6px_16px_rgba(15,23,42,0.04)] transition hover:bg-white"
                >
                  View Result Page
                </button>
              </div>
            </div>
          ) : null}
        </>

        <div className="mt-14 space-y-5">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className={`flex items-center gap-4 rounded-[24px] border p-5 shadow-[0_8px_18px_rgba(15,23,42,0.03)] transition-all ${
                step.status === "done"
                  ? "border-emerald-200/80 bg-emerald-50/60"
                  : step.status === "active"
                    ? "scale-[1.01] border-fuchsia-200/80 ring-1 ring-fuchsia-200/70 bg-[linear-gradient(135deg,rgba(250,245,255,0.98),rgba(255,255,255,0.98))] shadow-[0_20px_40px_rgba(217,70,239,0.12)]"
                    : step.status === "failed"
                      ? "border-red-200 bg-red-50/70"
                      : "border-slate-200/80 bg-white/85"
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white to-slate-100 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
                {step.status === "done" && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                {step.status === "active" && <LoaderCircle className="h-5 w-5 animate-spin text-purple-500" />}
                {step.status === "pending" && <Circle className="h-5 w-5 text-slate-300" />}
                {step.status === "failed" && <TriangleAlert className="h-5 w-5 text-red-400" />}
              </div>

              <div className="flex-1">
                <div className={`text-sm font-semibold ${step.status === "active" ? "text-[#0f172a]" : "text-[#111827]"}`}>
                  {index + 1}. {step.title}
                </div>
                {step.status === "active" ? (
                  <div className="mt-1 text-xs leading-6 text-slate-500">Currently processing this stage in the NDJC build pipeline.</div>
                ) : null}
              </div>

              <div
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                  step.status === "done"
                    ? "bg-emerald-100 text-emerald-600"
                    : step.status === "active"
                      ? "bg-fuchsia-100 text-fuchsia-600"
                      : step.status === "failed"
                        ? "bg-red-100 text-red-500"
                        : "bg-slate-100 text-slate-400"
                }`}
              >
                {step.status === "done"
                  ? "Done"
                  : step.status === "active"
                    ? "Running"
                    : step.status === "failed"
                      ? "Failed"
                      : "Pending"}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
