"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const SESSION_KEY = "ndjc_page_view_session_id";
const LAST_VIEW_KEY = "ndjc_last_page_view_key";

function getSessionId(): string {
  if (typeof window === "undefined") return "";

  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;

  const created =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `pv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queryString = useMemo(() => {
    return searchParams?.toString() || "";
  }, [searchParams]);

  useEffect(() => {
    if (!pathname) return;

    const dedupeKey = `${pathname}?${queryString}`;
    const lastKey = window.sessionStorage.getItem(LAST_VIEW_KEY);

    if (lastKey === dedupeKey) {
      return;
    }

    window.sessionStorage.setItem(LAST_VIEW_KEY, dedupeKey);

    const sessionId = getSessionId();

    void fetch("/api/track-page-view", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        pagePath: pathname,
        referrer: typeof document !== "undefined" ? document.referrer || null : null,
        queryString: queryString || null,
      }),
      keepalive: true,
    }).catch(() => null);
  }, [pathname, queryString]);

  return null;
}