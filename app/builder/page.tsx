"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";
import { createClient } from "@/lib/supabase/client";

const ICON_DATA_URL_STORAGE_KEY = "ndjc_builder_icon_data_url";
const ICON_FILE_NAME_STORAGE_KEY = "ndjc_builder_icon_file_name";
const BUILDER_DRAFT_STORAGE_KEY = "ndjc_builder_draft";
const CHECKOUT_APP_NAME_STORAGE_KEY = "ndjc_checkout_app_name";
const CHECKOUT_MODULE_STORAGE_KEY = "ndjc_checkout_module";
const CHECKOUT_UI_PACK_STORAGE_KEY = "ndjc_checkout_ui_pack";
const CHECKOUT_PLAN_STORAGE_KEY = "ndjc_checkout_plan";
const CHECKOUT_ADMIN_NAME_STORAGE_KEY = "ndjc_checkout_admin_name";
const CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY = "ndjc_checkout_admin_password";
const BUILDER_OPENED_LOG_KEY = "ndjc_builder_opened_logged";
const ICON_UPLOADED_LOG_PREFIX = "ndjc_icon_uploaded_";

type ValidationErrors = {
  appName: boolean;
  appIcon: boolean;
  logicModule: boolean;
  uiPack: boolean;
  adminName: boolean;
  adminPassword: boolean;
  plan: boolean;
};

const EMPTY_VALIDATION_ERRORS: ValidationErrors = {
  appName: false,
  appIcon: false,
  logicModule: false,
  uiPack: false,
  adminName: false,
  adminPassword: false,
  plan: false,
};
type BuilderDraft = {
  appName: string;
  module: string;
  uiPack: string;
  plan: string;
  adminName: string;
  iconDataUrl: string | null;
  iconFileName: string;
};

function loadBuilderDraft(): BuilderDraft | null {
  try {
    const raw = sessionStorage.getItem(BUILDER_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BuilderDraft;
  } catch {
    return null;
  }
}

function saveBuilderDraft(draft: BuilderDraft) {
  try {
    sessionStorage.setItem(BUILDER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {}
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Failed to read icon file."));
    };

    reader.onerror = () => {
      reject(new Error("Failed to read icon file."));
    };

    reader.readAsDataURL(file);
  });
}

function isValidAdminEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length >= 5 &&
    normalized.length <= 100 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  );
}

function isValidAdminPassword(value: string): boolean {
  return value.length >= 6 && value.length <= 64;
}

export default function BuilderPage() {
  const previewScreens = ["home", "services", "chat", "announcement"] as const;
  const [activePreview, setActivePreview] = useState<(typeof previewScreens)[number]>("home");
  const [appName, setAppName] = useState("");
  const [moduleName, setModuleName] = useState("feature-showcase");
  const [uiPackName, setUiPackName] = useState("ui-pack-showcase-greenpink");
  const [plan, setPlan] = useState("pro");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconFileName, setIconFileName] = useState("");
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>(EMPTY_VALIDATION_ERRORS);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const appNameSectionRef = useRef<HTMLDivElement | null>(null);
  const appIconSectionRef = useRef<HTMLDivElement | null>(null);
  const logicModuleSectionRef = useRef<HTMLDivElement | null>(null);
  const uiPackSectionRef = useRef<HTMLDivElement | null>(null);
  const adminNameSectionRef = useRef<HTMLDivElement | null>(null);
  const adminPasswordSectionRef = useRef<HTMLDivElement | null>(null);
  const planSectionRef = useRef<HTMLDivElement | null>(null);
  const planRef = useRef("pro");
  const supabase = useMemo(() => createClient(), []);

  const logBuilderOpened = async () => {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) return;

      const alreadyLogged = sessionStorage.getItem(BUILDER_OPENED_LOG_KEY);
      if (alreadyLogged === "1") return;

      const { error: insertError } = await supabase.from("user_operation_logs").insert({
        user_id: user.id,
        build_id: null,
        run_id: null,
        event_name: "builder_opened",
        page_path: "/builder",
        metadata: {
          source: "builder_page",
        },
      });

      if (insertError) {
        throw insertError;
      }

      sessionStorage.setItem(BUILDER_OPENED_LOG_KEY, "1");
    } catch (error) {
      console.error("NDJC builder: failed to write builder_opened log", error);
    }
  };

  const logIconUploaded = async (fileName: string) => {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) return;

      const dedupeKey = `${ICON_UPLOADED_LOG_PREFIX}${fileName}`;
      const alreadyLogged = sessionStorage.getItem(dedupeKey);
      if (alreadyLogged === "1") return;

      const { error: insertError } = await supabase.from("user_operation_logs").insert({
        user_id: user.id,
        build_id: null,
        run_id: null,
        event_name: "icon_uploaded",
        page_path: "/builder",
        metadata: {
          fileName,
        },
      });

      if (insertError) {
        throw insertError;
      }

      sessionStorage.setItem(dedupeKey, "1");
    } catch (error) {
      console.error("NDJC builder: failed to write icon_uploaded log", error);
    }
  };

  const handleChooseIcon = () => {
    fileInputRef.current?.click();
  };

  const buildValidationErrors = (): ValidationErrors => ({
    appName: appName.trim().length === 0,
    appIcon: !iconDataUrl,
    logicModule: moduleName.trim().length === 0,
    uiPack: uiPackName.trim().length === 0,
    adminName: !isValidAdminEmail(adminName),
    adminPassword: !isValidAdminPassword(adminPassword),
    plan: planRef.current.trim().length === 0,
  });

  const scrollToFirstError = (errors: ValidationErrors) => {
    const orderedKeys: Array<keyof ValidationErrors> = [
      "appName",
      "appIcon",
      "logicModule",
      "uiPack",
      "adminName",
      "adminPassword",
      "plan",
    ];

    for (const key of orderedKeys) {
      if (!errors[key]) continue;

      const target =
        key === "appName"
          ? appNameSectionRef.current
          : key === "appIcon"
            ? appIconSectionRef.current
            : key === "logicModule"
              ? logicModuleSectionRef.current
              : key === "uiPack"
                ? uiPackSectionRef.current
                : key === "adminName"
                  ? adminNameSectionRef.current
                  : key === "adminPassword"
                    ? adminPasswordSectionRef.current
                    : planSectionRef.current;

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      break;
    }
  };

  const handleIconChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;

    try {
      setIconFile(nextFile);

      if (!nextFile) {
        setIconFileName("");
        setIconDataUrl(null);
        setValidationErrors((prev) => ({ ...prev, appIcon: true }));
        sessionStorage.removeItem(ICON_DATA_URL_STORAGE_KEY);
        sessionStorage.removeItem(ICON_FILE_NAME_STORAGE_KEY);
        event.target.value = "";
        return;
      }

      const nextIconDataUrl = await fileToDataUrl(nextFile);

      setIconFileName(nextFile.name);
      setIconDataUrl(nextIconDataUrl);
      setValidationErrors((prev) => ({ ...prev, appIcon: false }));
      sessionStorage.setItem(ICON_DATA_URL_STORAGE_KEY, nextIconDataUrl);
      sessionStorage.setItem(ICON_FILE_NAME_STORAGE_KEY, nextFile.name);
      void logIconUploaded(nextFile.name);
    } catch (error) {
      setIconFile(null);
      setIconFileName("");
      setIconDataUrl(null);
      sessionStorage.removeItem(ICON_DATA_URL_STORAGE_KEY);
      sessionStorage.removeItem(ICON_FILE_NAME_STORAGE_KEY);
      alert(error instanceof Error ? error.message : "Failed to read icon file.");
    } finally {
      event.target.value = "";
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const draft = loadBuilderDraft();

    const nextAppName =
      params.get("appName") ||
      draft?.appName ||
      "";

    const nextModuleName =
      params.get("module") ||
      draft?.module ||
      "feature-showcase";

    const nextUiPackName =
      params.get("uiPack") ||
      draft?.uiPack ||
      "ui-pack-showcase-greenpink";

    const nextPlan = (
      params.get("plan") ||
      draft?.plan ||
      "pro"
    ).toLowerCase();

    const nextAdminName =
      params.get("adminName") ||
      draft?.adminName ||
      "";

    setAppName(nextAppName);
    setModuleName(nextModuleName);
    setUiPackName(nextUiPackName);
    setPlan(nextPlan);
    planRef.current = nextPlan;
    setAdminName(nextAdminName);
    setAdminPassword("");

    const storedIconDataUrl =
      draft?.iconDataUrl ||
      sessionStorage.getItem(ICON_DATA_URL_STORAGE_KEY);

    const storedIconFileName =
      draft?.iconFileName ||
      sessionStorage.getItem(ICON_FILE_NAME_STORAGE_KEY) ||
      "";

    if (storedIconDataUrl) {
      setIconDataUrl(storedIconDataUrl);
      setIconFileName(storedIconFileName);
    }

    setIsDraftHydrated(true);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      const authed = !error && !!data.user;
      setIsAuthed(authed);
      setAuthLoading(false);

      if (authed) {
        void logBuilderOpened();
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const authed = !!session?.user;
      setIsAuthed(authed);
      setAuthLoading(false);

      if (authed) {
        void logBuilderOpened();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);
  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }

    saveBuilderDraft({
      appName,
      module: moduleName,
      uiPack: uiPackName,
      plan: planRef.current,
      adminName: adminName.trim(),
      iconDataUrl,
      iconFileName,
    });
  }, [isDraftHydrated, appName, moduleName, uiPackName, adminName, iconDataUrl, iconFileName]);

  const selectedModuleClass =
    "rounded-full border border-indigo-400 bg-[linear-gradient(135deg,rgba(224,231,255,0.95),rgba(238,242,255,0.98))] px-4 py-2 text-indigo-700 shadow-[0_0_0_2px_rgba(99,102,241,0.12),0_10px_24px_rgba(99,102,241,0.12)] transition hover:-translate-y-0.5";
  const unselectedModuleClass =
    "rounded-full border border-slate-200 bg-white px-4 py-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700";

  const buildParams = {
    appName: appName.trim() || "Untitled App",
    module: moduleName,
    uiPack: uiPackName,
    plan: planRef.current,
    adminName: adminName.trim(),
    adminPassword,
    iconDataUrl,
  };

  const handleGenerate = async () => {
    if (isSubmitting || authLoading) return;

    const nextValidationErrors = buildValidationErrors();
    setValidationErrors(nextValidationErrors);

    if (Object.values(nextValidationErrors).some(Boolean)) {
      scrollToFirstError(nextValidationErrors);
      return;
    }

    if (!isAuthed) {
      alert("Please sign in with Google first.");
      return;
    }

    const currentPlan = planRef.current;

    saveBuilderDraft({
      appName: buildParams.appName,
      module: buildParams.module,
      uiPack: buildParams.uiPack,
      plan: buildParams.plan,
      adminName: buildParams.adminName,
      iconDataUrl: buildParams.iconDataUrl,
      iconFileName,
    });

    sessionStorage.setItem(CHECKOUT_APP_NAME_STORAGE_KEY, buildParams.appName);
    sessionStorage.setItem(CHECKOUT_MODULE_STORAGE_KEY, buildParams.module);
    sessionStorage.setItem(CHECKOUT_UI_PACK_STORAGE_KEY, buildParams.uiPack);
    sessionStorage.setItem(CHECKOUT_PLAN_STORAGE_KEY, buildParams.plan);
    sessionStorage.setItem(CHECKOUT_ADMIN_NAME_STORAGE_KEY, buildParams.adminName);

    if (currentPlan === "free") {
      sessionStorage.removeItem(CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY);

      try {
        setIsSubmitting(true);

        const response = await fetch("/api/start-build", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildParams),
        });

        const data = await response.json();

        if (!response.ok || !data?.ok || !data?.runId) {
          throw new Error(data?.error || "Failed to start build.");
        }

        window.location.href = `/generating?runId=${encodeURIComponent(data.runId)}`;
      } catch (error) {
        alert(error instanceof Error ? error.message : "Failed to start build.");
        setIsSubmitting(false);
      }

      return;
    }

    sessionStorage.setItem(
      CHECKOUT_ADMIN_PASSWORD_STORAGE_KEY,
      buildParams.adminPassword,
    );

    const params = new URLSearchParams({
      appName: buildParams.appName,
      module: buildParams.module,
      uiPack: buildParams.uiPack,
      plan: buildParams.plan,
      adminName: buildParams.adminName,
    });
    window.location.href = `/checkout?${params.toString()}`;
  };

  return (
    <main className="relative min-h-screen bg-[#f8fafc] text-[#0f172a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader
        nextPath="/builder"
      />

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-10">
        <div className="mb-10 text-center">
          <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">
            Build your native app in seconds
          </h1>
          <p className="mt-4 text-base text-[#64748b]">
            Configure your app and generate a native APK instantly
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 shadow backdrop-blur">
            <span className="text-indigo-500">Name</span>
            <span>{"→"}</span>
            <span>Icon</span>
            <span>{"→"}</span>
            <span>Module</span>
            <span>{"→"}</span>
            <span>UI</span>
            <span>{"→"}</span>
            <span>Admin</span>
            <span>{"→"}</span>
            <span>Plan</span>
            <span>{"→"}</span>
            <span>Build</span>
          </div>
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            <div className="mx-auto max-w-xl lg:mx-0">
              <section className="relative p-2 md:p-4">
                <div className="space-y-7">
                  <div ref={appNameSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">App Name</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">REQUIRED</span>
                    </div>
                    <div
                      className={`rounded-2xl border bg-white px-4 py-4 text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_24px_rgba(15,23,42,0.04)] transition focus-within:ring-4 ${
                        validationErrors.appName
                          ? "border-rose-300 focus-within:border-rose-400 focus-within:ring-rose-100/80"
                          : "border-slate-200 focus-within:border-indigo-400 focus-within:ring-indigo-100/80"
                      }`}
                    >
                      <input
                        value={appName}
                        onChange={(e) => {
                          setAppName(e.target.value);
                          setValidationErrors((prev) => ({ ...prev, appName: false }));
                        }}
                        placeholder="Enter app name"
                        className="w-full bg-transparent outline-none placeholder:text-slate-400"
                      />
                    </div>
                    {validationErrors.appName ? (
                      <p className="text-xs font-medium text-rose-500">App name is required.</p>
                    ) : null}
                  </div>

                  <div ref={appIconSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">App Icon</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">REQUIRED</span>
                    </div>
                    <p className="text-xs text-slate-400">Shown as your app icon on the home screen after installation.</p>
                    <div
                      className={`group flex items-center gap-3 rounded-2xl border bg-white px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:shadow-[0_14px_30px_rgba(15,23,42,0.06)] ${
                        validationErrors.appIcon
                          ? "border-rose-300 hover:border-rose-300"
                          : "border-slate-200 hover:border-indigo-300"
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                        className="hidden"
                        onChange={handleIconChange}
                      />

                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 text-[11px] font-semibold text-slate-500">
                        {iconDataUrl ? (
                          <img src={iconDataUrl} alt="App icon preview" className="h-full w-full object-cover" />
                        ) : (
                          "Icon"
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#0f172a]">Upload app icon</div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {iconFileName
                            ? `${iconFileName}`
                            : "PNG / JPG / SVG · 1024×1024 recommended"}
                        </div>
                        {iconDataUrl ? (
                          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
                            Image preview ready
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={handleChooseIcon}
                        className="rounded-xl border border-slate-200 bg-slate-100/80 px-3 py-1.5 text-xs font-medium text-[#0f172a] transition group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-600"
                      >
                        {iconDataUrl ? "Replace" : "Choose"}
                      </button>
                    </div>
                    {validationErrors.appIcon ? (
                      <p className="text-xs font-medium text-rose-500">App icon is required.</p>
                    ) : null}
                  </div>

                  <div ref={logicModuleSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">Logic Module</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">REQUIRED</span>
                    </div>
                    <p className="text-xs text-slate-400">Built for local businesses that serve customers in person—perfect for shops, studios, and services with repeat customers. More modules coming soon.</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setModuleName("feature-showcase");
                          setValidationErrors((prev) => ({ ...prev, logicModule: false }));
                        }}
                        className={moduleName === "feature-showcase" ? selectedModuleClass : unselectedModuleClass}
                      >
                        feature-showcase
                      </button>
                    </div>
                    {validationErrors.logicModule ? (
                      <p className="text-xs font-medium text-rose-500">Logic module is required.</p>
                    ) : null}
                  </div>

                  <div ref={uiPackSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">UI Pack</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">REQUIRED</span>
                    </div>
                    <p className="text-xs text-slate-400">Controls the visual style and layout of your app. More UI packs coming soon.</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setUiPackName("ui-pack-showcase-greenpink");
                          setValidationErrors((prev) => ({ ...prev, uiPack: false }));
                        }}
                        className={uiPackName === "ui-pack-showcase-greenpink" ? selectedModuleClass : unselectedModuleClass}
                      >
                        ui-pack-showcase-greenpink
                      </button>
                    </div>
                    {validationErrors.uiPack ? (
                      <p className="text-xs font-medium text-rose-500">UI pack is required.</p>
                    ) : null}
                  </div>

                  <div ref={adminNameSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">Admin Email</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">REQUIRED</span>
                    </div>
                    <p className="text-xs text-slate-400">Used as your merchant login email inside the app. The same email can be reused across multiple apps. It cannot be changed after creation.</p>
                    <div
                      className={`rounded-2xl border bg-white px-4 py-4 text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_24px_rgba(15,23,42,0.04)] transition focus-within:ring-4 ${
                        validationErrors.adminName
                          ? "border-rose-300 focus-within:border-rose-400 focus-within:ring-rose-100/80"
                          : "border-slate-200 focus-within:border-indigo-400 focus-within:ring-indigo-100/80"
                      }`}
                    >
                      <input
                        type="email"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={adminName}
                        onChange={(e) => {
                          setAdminName(e.target.value);
                          setValidationErrors((prev) => ({ ...prev, adminName: false }));
                        }}
                        placeholder="Enter admin email"
                        className="w-full bg-transparent outline-none placeholder:text-slate-400"
                      />
                    </div>
                    {validationErrors.adminName ? (
                      <p className="text-xs font-medium text-rose-500">Enter a valid admin email between 5 and 100 characters.</p>
                    ) : null}
                  </div>

                  <div ref={adminPasswordSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">Admin Password</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">REQUIRED</span>
                    </div>
                    <p className="text-xs text-slate-400">Used for merchant login inside the app. Use 6 to 64 characters. You can change this password later inside the app.</p>
                    <div
                      className={`rounded-2xl border bg-white px-4 py-4 text-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_10px_24px_rgba(15,23,42,0.04)] transition focus-within:ring-4 ${
                        validationErrors.adminPassword
                          ? "border-rose-300 focus-within:border-rose-400 focus-within:ring-rose-100/80"
                          : "border-slate-200 focus-within:border-indigo-400 focus-within:ring-indigo-100/80"
                      }`}
                    >
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => {
                          setAdminPassword(e.target.value);
                          setValidationErrors((prev) => ({ ...prev, adminPassword: false }));
                        }}
                        placeholder="Enter admin password"
                        className="w-full bg-transparent outline-none placeholder:text-slate-400"
                      />
                    </div>
                    {validationErrors.adminPassword ? (
                      <p className="text-xs font-medium text-rose-500">Enter an admin password between 6 and 64 characters.</p>
                    ) : null}
                  </div>

                  <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

                  <div ref={planSectionRef}>
                    <div className="mb-3 flex justify-between">
                      <span className="text-xs text-slate-400">Choose plan</span>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">REQUIRED</span>
                    </div>

                    <div className="mb-6 grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          planRef.current = "free";
                          setPlan("free");
                          setValidationErrors((prev) => ({ ...prev, plan: false }));
                        }}
                        className={
                          plan === "free"
                            ? "relative flex min-h-[110px] flex-col rounded-xl border border-indigo-300 bg-indigo-50/70 p-4 text-left shadow-[0_0_0_1px_rgba(99,102,241,0.12),0_18px_38px_rgba(99,102,241,0.10)] transition hover:-translate-y-0.5"
                            : "relative flex min-h-[110px] flex-col rounded-xl border border-slate-200 bg-white/80 p-4 text-left opacity-90 transition hover:border-slate-300 hover:bg-white"
                        }
                      >
                        <div className="font-semibold text-[#0f172a]">Free</div>
                        <div className="mt-2 text-xs text-slate-500">Full features · 7-day trial</div>
                        <div className="mt-2 text-[11px] font-medium text-slate-400">7-day cloud backend included</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          planRef.current = "pro";
                          setPlan("pro");
                          setValidationErrors((prev) => ({ ...prev, plan: false }));
                        }}
                        className={
                          plan === "pro"
                            ? "relative flex min-h-[110px] flex-col rounded-xl border border-fuchsia-400 bg-gradient-to-br from-fuchsia-50 to-pink-50 p-4 text-left shadow-[0_0_0_1px_rgba(217,70,239,0.18),0_18px_38px_rgba(217,70,239,0.14)] transition hover:-translate-y-0.5"
                            : "relative flex min-h-[110px] flex-col rounded-xl border border-slate-200 bg-white/80 p-4 text-left opacity-90 transition hover:border-slate-300 hover:bg-white"
                        }
                      >
                        <div className="mb-3 inline-flex h-[22px] w-fit items-center rounded-full border border-fuchsia-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-600">
                          Recommended
                        </div>
                        <div className="font-semibold text-fuchsia-700">Pro</div>
                        <div className="mt-2 text-xs text-fuchsia-600">Full features · long-term use</div>
                        <div className="mt-2 text-[11px] font-medium text-fuchsia-500/90">30-day cloud backend included</div>
                        {plan === "pro" ? (
                          <div className="absolute right-4 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-fuchsia-600 text-xs text-white">
                            ✓
                          </div>
                        ) : null}
                      </button>
                    </div>

                    {validationErrors.plan ? (
                      <p className="-mt-2 mb-3 text-xs font-medium text-rose-500">Plan selection is required.</p>
                    ) : null}

                    <div className="mb-3 text-center text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                      Ready to build
                    </div>

                    {plan === "free" ? (
                      <div className="mb-3 text-center px-2 py-2">
                        <div className="text-[12px] font-medium text-slate-600">
                          Free trial includes full app generation
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Cloud backend is included for 7 days. After expiry, the app becomes read-only. Upgrade requires generating a new app.
                        </div>
                      </div>
                    ) : plan === "pro" ? (
                      <div className="mb-3 text-center px-2 py-2">
                        <div className="text-[12px] font-medium text-slate-600">
                          App generation is a one-time payment
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Cloud backend is included for 30 days. After expiry, the app becomes read-only until renewed.
                        </div>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={isSubmitting}
                      className="group relative w-full overflow-hidden rounded-[22px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 py-5 text-lg font-semibold text-white shadow-[0_25px_60px_rgba(236,72,153,0.3)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <div className="absolute inset-0 rounded-[22px] bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 opacity-30 blur-xl" />
                      <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.18)_40%,transparent_72%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                      <div className="relative flex items-center justify-center gap-2">
                        {isSubmitting ? "Starting Build..." : "Generate APK"}
                        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </button>

                    <div className="mt-3 text-center text-xs text-slate-400">Build takes about 10 minutes · may queue during peak times</div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div className="relative hidden lg:flex lg:items-center">
            <div className="w-full">
              <div className="relative w-full max-w-[420px]">
                <div className="pointer-events-none absolute -inset-14 rounded-[64px] bg-[radial-gradient(70%_60%_at_50%_40%,rgba(236,72,153,0.24),rgba(168,85,247,0.18),rgba(99,102,241,0.14),transparent_72%)] blur-[90px] opacity-85" />
                <div className="pointer-events-none absolute inset-x-10 top-10 h-28 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.18),transparent_72%)] blur-3xl" />

                <div className="relative mx-auto aspect-[9/19.5] w-[306px] rounded-[44px] border border-[#2d3442] bg-[linear-gradient(180deg,#4b5563_0%,#171b24_14%,#0a0d14_56%,#1b2230_100%)] p-[6px] shadow-[0_16px_32px_rgba(15,23,42,0.22),0_42px_100px_rgba(15,23,42,0.24)]">
                  <div className="pointer-events-none absolute inset-0 rounded-[44px] bg-[linear-gradient(180deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.03)_18%,transparent_36%,transparent_100%)]" />
                  <div className="pointer-events-none absolute inset-[1px] rounded-[43px] border border-white/10" />
                  <div className="relative flex h-full flex-col rounded-[38px] border border-black/70 bg-[#05070c] p-[4px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                    <div className="relative flex h-full flex-col overflow-hidden rounded-[34px] bg-[#0a0d14] text-white">
                      <div className="absolute top-0 left-0 right-0 h-14 bg-gradient-to-b from-white/[0.08] to-transparent pointer-events-none" />

                      <div className="flex items-center justify-between border-b border-white/8 px-4 pb-3 pt-6">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Preview</div>
                          <div className="mt-1 text-sm font-medium text-white/90">{uiPackName}</div>
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/65">
                          Auto demo
                        </div>
                      </div>

                      <div className="flex-1 overflow-hidden px-4 py-4">
                        {activePreview === "home" && (
                          <div className="space-y-4">
                            <div className="rounded-[24px] bg-gradient-to-r from-fuchsia-500 to-pink-500 p-4 text-white shadow-[0_18px_40px_rgba(236,72,153,0.28)]">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-white/75">Store home</div>
                              <div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                                {appName.trim() || "Beauty Studio"}
                              </div>
                              <div className="mt-1 text-sm text-white/80">Storefront · Products · Announcements</div>
                              <div className="mt-4 flex items-center gap-2">
                                <div className="rounded-full bg-white/18 px-3 py-1 text-xs text-white/90">Open today</div>
                                <div className="rounded-full bg-white/18 px-3 py-1 text-xs text-white/90">24 services</div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Top card</div>
                                <div className="mt-2 text-sm font-medium text-white">Featured services</div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Live chat</div>
                                <div className="mt-2 text-sm font-medium text-white">Customer support</div>
                              </div>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                              <div className="mb-3 flex items-center justify-between">
                                <div>
                                  <div className="text-sm font-medium text-white">Popular services</div>
                                  <div className="text-xs text-white/45">What customers see first</div>
                                </div>
                                <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">3 cards</div>
                              </div>
                              <div className="space-y-3">
                                <div className="rounded-xl bg-white/6 p-3">
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-pink-400 to-fuchsia-500" />
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium text-white">Skin Care Package</div>
                                      <div className="text-xs text-white/45">Popular card component preview</div>
                                    </div>
                                    <div className="text-xs text-white/75">$29</div>
                                  </div>
                                </div>
                                <div className="rounded-xl bg-white/6 p-3">
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-400 to-indigo-500" />
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium text-white">Hair Styling</div>
                                      <div className="text-xs text-white/45">List row and detail entry preview</div>
                                    </div>
                                    <div className="text-xs text-white/75">$18</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {activePreview === "services" && (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Services</div>
                                <div className="mt-1 text-xl font-semibold tracking-[-0.03em] text-white">Browse treatments</div>
                              </div>
                              <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-white/70">12 items</div>
                            </div>

                            <div className="space-y-3">
                              <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                                <div className="flex items-center gap-3">
                                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-pink-400 to-fuchsia-500" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-medium text-white">Glow Facial</div>
                                        <div className="mt-1 text-xs text-white/45">Hydrating treatment · 45 mins</div>
                                      </div>
                                      <div className="text-sm font-semibold text-white">$42</div>
                                    </div>
                                    <div className="mt-3 flex items-center gap-2">
                                      <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">Popular</div>
                                      <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">New</div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                                <div className="flex items-center gap-3">
                                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-medium text-white">Hair Styling Set</div>
                                        <div className="mt-1 text-xs text-white/45">Styling + wash · 30 mins</div>
                                      </div>
                                      <div className="text-sm font-semibold text-white">$26</div>
                                    </div>
                                    <div className="mt-3 flex items-center gap-2">
                                      <div className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/70">Fast booking</div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-center text-xs text-white/45">
                                More cards continue below in the generated app
                              </div>
                            </div>
                          </div>
                        )}

                        {activePreview === "chat" && (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Chat</div>
                                <div className="mt-1 text-sm font-medium text-white">Beauty Studio Support</div>
                              </div>
                              <div className="rounded-full bg-fuchsia-500/18 px-2 py-1 text-[10px] font-medium text-fuchsia-200">2 unread</div>
                            </div>

                            <div className="space-y-3 rounded-[24px] border border-white/10 bg-white/5 p-4">
                              <div className="flex justify-start">
                                <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white/8 px-3 py-2 text-sm text-white/85">
                                  Hi, do you have an opening this afternoon?
                                </div>
                              </div>
                              <div className="flex justify-end">
                                <div className="max-w-[78%] rounded-2xl rounded-br-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-2 text-sm text-white shadow-[0_10px_24px_rgba(236,72,153,0.22)]">
                                  Yes, we have a 3:30 slot available.
                                </div>
                              </div>
                              <div className="flex justify-start">
                                <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-white/8 px-3 py-2 text-sm text-white/85">
                                  Great, please reserve it for me.
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                              <div className="h-9 flex-1 rounded-xl bg-white/6 px-3 py-2 text-sm text-white/35">Type a message...</div>
                              <div className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-2 text-xs font-medium text-white">Send</div>
                            </div>
                          </div>
                        )}

                        {activePreview === "announcement" && (
                          <div className="space-y-4">
                            <div className="rounded-[24px] border border-white/10 bg-gradient-to-br from-white/8 to-white/4 p-4">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Announcement</div>
                              <div className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">Summer sale banner</div>
                              <div className="mt-2 text-sm leading-7 text-white/70">
                                New seasonal promotion now live. Push this update to customers from the merchant console.
                              </div>
                            </div>

                            <div className="rounded-[24px] bg-gradient-to-r from-fuchsia-500 to-pink-500 p-4 text-white shadow-[0_18px_40px_rgba(236,72,153,0.25)]">
                              <div className="text-xs uppercase tracking-[0.16em] text-white/75">Featured update</div>
                              <div className="mt-2 text-lg font-semibold">Book this week and get 15% off</div>
                              <div className="mt-2 text-sm text-white/80">Perfect for promos, banners, and store-wide updates.</div>
                            </div>

                            <div className="space-y-3">
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-sm font-medium text-white">Push notification ready</div>
                                <div className="mt-1 text-xs text-white/45">Customers can receive updates directly from the generated app.</div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-sm font-medium text-white">Designed to match the UI pack</div>
                                <div className="mt-1 text-xs text-white/45">Brand styling, card rhythm, and content hierarchy stay consistent.</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-white/8 px-4 py-3">
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                          <div className="flex items-center gap-2">
                            {previewScreens.map((screen) => (
                              <div
                                key={screen}
                                className={`h-2 rounded-full transition-all duration-500 ${
                                  activePreview === screen ? "w-6 bg-fuchsia-400" : "w-2 bg-white/18"
                                }`}
                              />
                            ))}
                          </div>
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                            {activePreview === "home" && "Home screen"}
                            {activePreview === "services" && "Services list"}
                            {activePreview === "chat" && "Chat flow"}
                            {activePreview === "announcement" && "Announcement"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
