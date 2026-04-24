"use client";

import { useEffect, useMemo, useState } from "react";

type BuildStatusResponse = {
  ok: boolean;
  runId?: string;
  appName?: string;
  publicApkUrl?: string | null;
  error?: string | null;
};

type PageProps = {
  params?: {
    runId?: string;
  };
};

const DEFAULT_APP_NAME = "Merchant App";

function DownloadIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function CopyIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <rect x="4" y="4" width="11" height="11" rx="2" />
    </svg>
  );
}

function PhoneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function getRunIdFromBrowserFallback() {
  if (typeof window === "undefined") return "";
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1] || "";
  const queryRunId = new URLSearchParams(window.location.search).get("runId") || "";
  return queryRunId || lastPart;
}

export default function AppDownloadPage({ params }: PageProps) {
  const [runId, setRunId] = useState(params?.runId || "");
  const [data, setData] = useState<BuildStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const resolvedRunId = params?.runId || getRunIdFromBrowserFallback();
    setRunId(resolvedRunId);

    if (!resolvedRunId || resolvedRunId === "app-download") {
      setData({
        ok: true,
        appName: DEFAULT_APP_NAME,
        publicApkUrl: "#",
      });
      setLoading(false);
      return;
    }

    fetch(`/api/app-download-info?runId=${encodeURIComponent(resolvedRunId)}`, { cache: "no-store" })
      .then(async (res) => {
        const nextData: BuildStatusResponse = await res.json();
        if (!res.ok || !nextData.ok) {
          throw new Error(nextData.error || "Failed to load app download information.");
        }
        setData(nextData);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load app download information.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [params?.runId]);

  const appName = data?.appName || DEFAULT_APP_NAME;
  const apkUrl = data?.publicApkUrl || "";
  const canDownload = Boolean(apkUrl);

  const pageUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl || window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_48%,#eef2ff_100%)] text-[#0f172a]">
      <section className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-10">
        <div className="w-full p-0">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 text-white shadow-[0_18px_46px_rgba(217,70,239,0.3)]">
            <PhoneIcon className="h-9 w-9" />
          </div>

          <div className="mt-6 text-center">
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-fuchsia-600">Android App</div>
            <h1 className="mt-3 text-[38px] font-extrabold leading-tight tracking-[-0.055em] text-[#0f172a] sm:text-[52px]">
              {appName}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-500 sm:text-lg">
              Download this app to contact the merchant, view products or services, and receive important updates.
            </p>
          </div>

          {loading ? (
            <div className="mt-8 rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4 text-center text-sm font-semibold text-slate-500">
              Loading download link...
            </div>
          ) : null}

          {error ? (
            <div className="mt-8 rounded-[22px] border border-red-200 bg-red-50 px-5 py-4 text-center text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          {!loading && !error ? (
            <div className="mt-8 space-y-4">
              <a
                href={canDownload ? apkUrl : "#"}
                className={`group relative block w-full overflow-hidden rounded-[24px] px-6 py-5 text-lg font-semibold text-white shadow-[0_25px_60px_rgba(236,72,153,0.25)] transition ${
                  canDownload
                    ? "bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 hover:scale-[1.04] hover:shadow-[0_35px_90px_rgba(236,72,153,0.35)] active:scale-[0.98]"
                    : "pointer-events-none bg-slate-300"
                }`}
              >
                <div className="relative flex items-center justify-center gap-2">
                  <DownloadIcon className="h-5 w-5" />
                  {canDownload ? "Download & install your app" : "APK not available"}
                </div>
              </a>

              <button
                type="button"
                onClick={handleCopy}
                className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[20px] border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-[0_14px_34px_rgba(15,23,42,0.06)] transition hover:border-fuchsia-200 hover:text-fuchsia-700"
              >
                <CopyIcon className="h-4 w-4" />
                {copied ? "Link copied" : "Copy download page link"}
              </button>
            </div>
          ) : null}

          <div className="mt-8 rounded-[24px] bg-slate-50 p-5">
            <div className="text-sm font-extrabold text-slate-900">How to install</div>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <div>
                1. Tap <span className="font-bold text-slate-800">Download APK</span>.
              </div>
              <div>2. Open the downloaded file on your Android device.</div>
              <div>3. If prompted, allow installation from your browser.</div>
            </div>
          </div>

          <div className="mt-5 text-center text-xs font-medium leading-6 text-slate-400">
            For Android devices only · Shared by the merchant
            {runId ? <span className="block truncate">Run ID: {runId}</span> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
