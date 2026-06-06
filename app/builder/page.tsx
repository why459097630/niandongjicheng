"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import SiteHeader from "@/components/layout/SiteHeader";
import { createClient } from "@/lib/supabase/client";

const ICON_DATA_URL_STORAGE_KEY = "ndjc_builder_icon_data_url";
const ICON_URL_STORAGE_KEY = "ndjc_builder_icon_url";
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
};

type IconCropMetrics = {
  naturalWidth: number;
  naturalHeight: number;
};

type IconCropOffset = {
  x: number;
  y: number;
};

type IconCropDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const ICON_CROP_BOX_SIZE = 280;
const ICON_CROP_OUTPUT_SIZE = 1024;
const ICON_CROP_MIN_SCALE = 1;
const ICON_CROP_MAX_SCALE = 4;
const ICON_CROP_OUTPUT_TYPE = "image/png";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getIconCropBounds(metrics: IconCropMetrics | null, scale: number): IconCropOffset {
  if (!metrics) {
    return {
      x: 0,
      y: 0,
    };
  }

  const baseScale = ICON_CROP_BOX_SIZE / Math.min(metrics.naturalWidth, metrics.naturalHeight);
  const previewWidth = metrics.naturalWidth * baseScale * scale;
  const previewHeight = metrics.naturalHeight * baseScale * scale;

  return {
    x: Math.max(0, (previewWidth - ICON_CROP_BOX_SIZE) / 2),
    y: Math.max(0, (previewHeight - ICON_CROP_BOX_SIZE) / 2),
  };
}

function clampIconCropOffset(
  offset: IconCropOffset,
  metrics: IconCropMetrics | null,
  scale: number,
): IconCropOffset {
  const bounds = getIconCropBounds(metrics, scale);

  return {
    x: clampNumber(offset.x, -bounds.x, bounds.x),
    y: clampNumber(offset.y, -bounds.y, bounds.y),
  };
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };

    image.onerror = () => {
      reject(new Error("Failed to load icon image."));
    };

    image.src = dataUrl;
  });
}

async function inspectIconImage(dataUrl: string): Promise<IconCropMetrics> {
  const image = await loadImageElement(dataUrl);

  return {
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  };
}

async function createCroppedIconDataUrl(input: {
  sourceDataUrl: string;
  metrics: IconCropMetrics;
  scale: number;
  offset: IconCropOffset;
}): Promise<string> {
  const image = await loadImageElement(input.sourceDataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available.");
  }

  canvas.width = ICON_CROP_OUTPUT_SIZE;
  canvas.height = ICON_CROP_OUTPUT_SIZE;

  context.clearRect(0, 0, ICON_CROP_OUTPUT_SIZE, ICON_CROP_OUTPUT_SIZE);

  const baseScale = ICON_CROP_BOX_SIZE / Math.min(input.metrics.naturalWidth, input.metrics.naturalHeight);
  const previewWidth = input.metrics.naturalWidth * baseScale * input.scale;
  const previewHeight = input.metrics.naturalHeight * baseScale * input.scale;
  const renderScale = ICON_CROP_OUTPUT_SIZE / ICON_CROP_BOX_SIZE;

  const drawWidth = previewWidth * renderScale;
  const drawHeight = previewHeight * renderScale;
  const drawX = (ICON_CROP_OUTPUT_SIZE - drawWidth) / 2 + input.offset.x * renderScale;
  const drawY = (ICON_CROP_OUTPUT_SIZE - drawHeight) / 2 + input.offset.y * renderScale;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  return canvas.toDataURL(ICON_CROP_OUTPUT_TYPE);
}

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

async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  return new File([blob], fileName, {
    type: blob.type || ICON_CROP_OUTPUT_TYPE,
  });
}

async function uploadSourceIconFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("iconFile", file);

  const response = await fetch("/api/pwa-icons/upload-source", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || !data?.ok || typeof data.iconUrl !== "string" || !data.iconUrl.trim()) {
    throw new Error(data?.error || "Failed to upload icon.");
  }

  return data.iconUrl.trim();
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

const ICON_SHAPE_PREVIEWS = [
  {
    key: "circle",
    label: "Circle",
    frameClassName: "rounded-full",
  },
  {
    key: "rounded",
    label: "Rounded",
    frameClassName: "rounded-[22px]",
  },
  {
    key: "squircle",
    label: "Squircle",
    frameClassName: "rounded-[30%]",
  },
  {
    key: "square",
    label: "Square",
    frameClassName: "rounded-[12px]",
  },
] as const;

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
  const [submitError, setSubmitError] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconFileName, setIconFileName] = useState("");
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [pendingIconFile, setPendingIconFile] = useState<File | null>(null);
  const [pendingIconFileName, setPendingIconFileName] = useState("");
  const [pendingIconDataUrl, setPendingIconDataUrl] = useState<string | null>(null);
  const [iconCropMetrics, setIconCropMetrics] = useState<IconCropMetrics | null>(null);
  const [iconCropOpen, setIconCropOpen] = useState(false);
  const [iconCropScale, setIconCropScale] = useState(1);
  const [iconCropOffset, setIconCropOffset] = useState<IconCropOffset>({ x: 0, y: 0 });
  const [iconCropBusy, setIconCropBusy] = useState(false);
  const [iconCropError, setIconCropError] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>(EMPTY_VALIDATION_ERRORS);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const iconCropDragRef = useRef<IconCropDragState | null>(null);
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
    appIcon: !iconUrl,
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
      setIconCropError("");

      if (!nextFile) {
        setPendingIconFile(null);
        setPendingIconFileName("");
        setPendingIconDataUrl(null);
        setIconCropMetrics(null);
        setIconCropOpen(false);
        event.target.value = "";
        return;
      }

      const nextIconDataUrl = await fileToDataUrl(nextFile);
      const nextMetrics = await inspectIconImage(nextIconDataUrl);

      if (nextMetrics.naturalWidth < 128 || nextMetrics.naturalHeight < 128) {
        throw new Error("Icon image is too small. Please upload an image at least 128×128.");
      }

      setPendingIconFile(nextFile);
      setPendingIconFileName(nextFile.name);
      setPendingIconDataUrl(nextIconDataUrl);
      setIconCropMetrics(nextMetrics);
      setIconCropScale(1);
      setIconCropOffset({ x: 0, y: 0 });
      setIconCropOpen(true);
      setIconCropBusy(false);
    } catch (error) {
      setPendingIconFile(null);
      setPendingIconFileName("");
      setPendingIconDataUrl(null);
      setIconCropMetrics(null);
      setIconCropOpen(false);
      alert(error instanceof Error ? error.message : "Failed to read icon file.");
    } finally {
      event.target.value = "";
    }
  };

  const resetPendingIconCrop = () => {
    setPendingIconFile(null);
    setPendingIconFileName("");
    setPendingIconDataUrl(null);
    setIconCropMetrics(null);
    setIconCropScale(1);
    setIconCropOffset({ x: 0, y: 0 });
    setIconCropBusy(false);
    setIconCropError("");
    setIconCropOpen(false);
    iconCropDragRef.current = null;
  };

  const handleCancelIconCrop = () => {
    resetPendingIconCrop();
  };

  const handleConfirmIconCrop = async () => {
    if (!pendingIconDataUrl || !iconCropMetrics || !pendingIconFile) {
      setIconCropError("Please choose an icon image first.");
      return;
    }

    try {
      setIconCropBusy(true);
      setIconCropError("");

      const safeOffset = clampIconCropOffset(iconCropOffset, iconCropMetrics, iconCropScale);
      const croppedDataUrl = await createCroppedIconDataUrl({
        sourceDataUrl: pendingIconDataUrl,
        metrics: iconCropMetrics,
        scale: iconCropScale,
        offset: safeOffset,
      });
      const croppedIconFile = await dataUrlToFile(croppedDataUrl, "pwa-source-icon.png");
      const uploadedIconUrl = await uploadSourceIconFile(croppedIconFile);

      setIconFile(pendingIconFile);
      setIconFileName(pendingIconFileName);
      setIconDataUrl(croppedDataUrl);
      setIconUrl(uploadedIconUrl);
      setValidationErrors((prev) => ({ ...prev, appIcon: false }));
      sessionStorage.setItem(ICON_DATA_URL_STORAGE_KEY, croppedDataUrl);
      sessionStorage.setItem(ICON_URL_STORAGE_KEY, uploadedIconUrl);
      sessionStorage.setItem(ICON_FILE_NAME_STORAGE_KEY, pendingIconFileName);
      void logIconUploaded(pendingIconFileName);
      resetPendingIconCrop();
    } catch (error) {
      setIconCropError(error instanceof Error ? error.message : "Failed to crop icon image.");
      setIconCropBusy(false);
    }
  };

  const handleIconCropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!iconCropMetrics) return;

    event.currentTarget.setPointerCapture(event.pointerId);

    iconCropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: iconCropOffset.x,
      originY: iconCropOffset.y,
    };
  };

  const handleIconCropPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = iconCropDragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const nextOffset = {
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    };

    setIconCropOffset(clampIconCropOffset(nextOffset, iconCropMetrics, iconCropScale));
  };

  const handleIconCropPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = iconCropDragRef.current;

    if (dragState?.pointerId === event.pointerId) {
      iconCropDragRef.current = null;
    }
  };

  const handleIconCropScaleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextScale = clampNumber(Number(event.target.value), ICON_CROP_MIN_SCALE, ICON_CROP_MAX_SCALE);

    setIconCropScale(nextScale);
    setIconCropOffset((prev) => clampIconCropOffset(prev, iconCropMetrics, nextScale));
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

    setIconFile(null);
    setIconDataUrl(null);
    setIconUrl(null);
    setIconFileName("");
    sessionStorage.removeItem(ICON_DATA_URL_STORAGE_KEY);
    sessionStorage.removeItem(ICON_URL_STORAGE_KEY);
    sessionStorage.removeItem(ICON_FILE_NAME_STORAGE_KEY);

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
    });
  }, [isDraftHydrated, appName, moduleName, uiPackName, adminName]);

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
    iconUrl,
  };

  const handleGenerate = async () => {
    if (isSubmitting || authLoading) return;

    setSubmitError("");

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

        window.location.href = `/result?runId=${encodeURIComponent(data.runId)}`;
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Failed to start build.");
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
      {iconCropOpen && pendingIconDataUrl && iconCropMetrics ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-5 shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-500">App icon crop</div>
                <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] text-[#0f172a]">Adjust your icon</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Drag and zoom the image. The square crop will be used as your app icon. Keep the main subject centered and fill the square as much as possible.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCancelIconCrop}
                disabled={iconCropBusy}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="mt-5 flex justify-center">
              <div
                className="relative select-none overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#e2e8f0)] shadow-inner touch-none"
                style={{
                  width: ICON_CROP_BOX_SIZE,
                  height: ICON_CROP_BOX_SIZE,
                }}
                onPointerDown={handleIconCropPointerDown}
                onPointerMove={handleIconCropPointerMove}
                onPointerUp={handleIconCropPointerEnd}
                onPointerCancel={handleIconCropPointerEnd}
              >
                <img
                  src={pendingIconDataUrl}
                  alt="Icon crop source"
                  draggable={false}
                  className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
                  style={{
                    width: iconCropMetrics.naturalWidth * (ICON_CROP_BOX_SIZE / Math.min(iconCropMetrics.naturalWidth, iconCropMetrics.naturalHeight)) * iconCropScale,
                    height: iconCropMetrics.naturalHeight * (ICON_CROP_BOX_SIZE / Math.min(iconCropMetrics.naturalWidth, iconCropMetrics.naturalHeight)) * iconCropScale,
                    transform: `translate(calc(-50% + ${iconCropOffset.x}px), calc(-50% + ${iconCropOffset.y}px))`,
                  }}
                />

                <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-2 ring-inset ring-white/90" />
                <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/35" />
                <div className="pointer-events-none absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/35" />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Zoom</label>
                <span className="text-xs font-semibold text-slate-500">{Math.round(iconCropScale * 100)}%</span>
              </div>
              <input
                type="range"
                min={ICON_CROP_MIN_SCALE}
                max={ICON_CROP_MAX_SCALE}
                step="0.01"
                value={iconCropScale}
                onChange={handleIconCropScaleChange}
                disabled={iconCropBusy}
                className="w-full accent-indigo-500"
              />
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-400">
                <span>Full image</span>
                <span>Closer crop</span>
              </div>
            </div>

            {iconCropError ? (
              <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
                {iconCropError}
              </div>
            ) : null}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={handleCancelIconCrop}
                disabled={iconCropBusy}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmIconCrop}
                disabled={iconCropBusy}
                className="flex-1 rounded-2xl bg-[#111827] px-4 py-3 text-sm font-bold text-white shadow-[0_16px_34px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:bg-[#020617] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {iconCropBusy ? "Cropping..." : "Use this icon"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_48%,#d7dde8_100%),radial-gradient(circle_at_top,rgba(99,102,241,0.18),transparent_38%)]" />

      <SiteHeader
        nextPath="/builder"
      />

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-10">
        <div className="mb-10 text-center">
          <h1 className="text-5xl font-extrabold tracking-[-0.05em] md:text-6xl">
            Create your customer hub in minutes
          </h1>
          <p className="mt-4 text-base text-[#64748b]">
            Set up your business name, app icon, and admin account. We will generate a mobile-ready customer hub customers can open by link or QR code and save to their home screen.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500 shadow backdrop-blur">
            <span className="text-indigo-500">Name</span>
            <span>{"→"}</span>
            <span>Icon</span>
            <span>{"→"}</span>
            <span>Admin</span>
            <span>{"→"}</span>
            <span>Plan</span>
            <span>{"→"}</span>
            <span>Generate</span>
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
  <p className="text-xs text-slate-400">Upload any image, then adjust the crop area for your home screen app icon.</p>
  <div
    className={`group rounded-2xl border bg-white px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:shadow-[0_14px_30px_rgba(15,23,42,0.06)] ${
      validationErrors.appIcon
        ? "border-rose-300 hover:border-rose-300"
        : "border-slate-200 hover:border-indigo-300"
    }`}
  >
    <input
      ref={fileInputRef}
      type="file"
      accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
      className="hidden"
      onChange={handleIconChange}
    />

    <div className="flex items-start gap-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-none border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 text-[11px] font-semibold text-slate-500">
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
            : "PNG / JPG / WEBP / SVG · square crop will be generated"}
        </div>
        {iconDataUrl ? (
          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
            Cropped icon ready
          </div>
        ) : null}
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          Drag and zoom after upload. Your cropped image will be used for home screen icons. The final icon shape is handled by each device and may appear as a circle, rounded square, squircle, or square.
        </p>
      </div>

      <button
        type="button"
        onClick={handleChooseIcon}
        className="rounded-xl border border-slate-200 bg-slate-100/80 px-3 py-1.5 text-xs font-medium text-[#0f172a] transition group-hover:border-indigo-200 group-hover:bg-indigo-50 group-hover:text-indigo-600"
      >
        {iconDataUrl ? "Replace" : "Choose"}
      </button>
    </div>

    <div className="mt-4 grid grid-cols-4 gap-3">
      {ICON_SHAPE_PREVIEWS.map((shape) => (
        <div key={shape.key} className="space-y-2">
          <div className="text-center text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
            {shape.label}
          </div>
          <div className="flex justify-center">
            <div
              className={`flex h-14 w-14 items-center justify-center overflow-hidden border border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 ${shape.frameClassName}`}
            >
              {iconDataUrl ? (
                <img
                  src={iconDataUrl}
                  alt={`${shape.label} icon preview`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-[10px] font-semibold text-slate-400">Preview</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
  {validationErrors.appIcon ? (
    <p className="text-xs font-medium text-rose-500">App icon is required.</p>
  ) : null}
</div>

                  <div ref={logicModuleSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">Current Template</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">INCLUDED</span>
                    </div>
                    <p className="text-xs text-slate-400">Includes services, bookings, chat, updates, favorites, and merchant admin tools in one customer entry.</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setModuleName("feature-showcase");
                          setValidationErrors((prev) => ({ ...prev, logicModule: false }));
                        }}
                        className={moduleName === "feature-showcase" ? selectedModuleClass : unselectedModuleClass}
                      >
                        Local Business Customer Hub
                      </button>
                    </div>
                    {validationErrors.logicModule ? (
                      <p className="text-xs font-medium text-rose-500">Customer hub template is required.</p>
                    ) : null}
                  </div>

                  <div ref={uiPackSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">Current Style</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">INCLUDED</span>
                    </div>
                    <p className="text-xs text-slate-400">A clean mobile-friendly layout with a soft gray-white background, rounded cards, and green-pink action buttons.</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setUiPackName("ui-pack-showcase-greenpink");
                          setValidationErrors((prev) => ({ ...prev, uiPack: false }));
                        }}
                        className={uiPackName === "ui-pack-showcase-greenpink" ? selectedModuleClass : unselectedModuleClass}
                      >
                        Soft Green Pink Style
                      </button>
                    </div>
                    {validationErrors.uiPack ? (
                      <p className="text-xs font-medium text-rose-500">Visual style is required.</p>
                    ) : null}
                  </div>

                  <div ref={adminNameSectionRef} className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-semibold">Admin Email</label>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">REQUIRED</span>
                    </div>
                    <p className="text-xs text-slate-400">Used as your merchant login email inside your customer hub. The same email can be reused across multiple hubs. It cannot be changed after creation.</p>
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
                    <p className="text-xs text-slate-400">Used for merchant login inside your customer hub. Use 6 to 64 characters. You can change this password later inside the hub.</p>
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
                          setSubmitError("");
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
                          setSubmitError("");
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
                      Ready to generate
                    </div>

                    {plan === "free" ? (
                      <div className="mb-3 text-center px-2 py-2">
                        <div className="text-[12px] font-medium text-slate-600">
                          Free trial includes full customer hub generation
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Cloud backend is included for 7 days. After expiry, this hub becomes read-only. To upgrade, generate a new Pro hub.
                        </div>
                      </div>
                    ) : plan === "pro" ? (
                      <div className="mb-3 text-center px-2 py-2">
                        <div className="text-[12px] font-medium text-slate-600">
                          Customer hub generation is a one-time payment
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Cloud backend is included for 30 days. After expiry, the customer hub becomes read-only until renewed.
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
                        {isSubmitting ? "Preparing..." : "Generate customer hub"}
                        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </button>

                    {submitError ? (
                      <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-[13px] font-medium leading-6 text-red-600">
                        {submitError}
                      </div>
                    ) : null}

                    <div className="mt-3 text-center text-xs text-slate-400">Preparing usually takes about 10 seconds · please do not refresh</div>
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
                          Live preview
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
                              <div className="mt-1 text-sm text-white/80">Services · Bookings · Updates</div>
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
                                More cards continue below in your customer hub
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
                                <div className="mt-1 text-xs text-white/45">Customers can receive updates directly from your customer hub.</div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <div className="text-sm font-medium text-white">Designed to match the current visual style</div>
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
