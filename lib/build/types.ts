export type BuildStage =
  | "preparing_request"
  | "processing_identity"
  | "matching_logic_module"
  | "applying_ui_pack"
  | "preparing_services"
  | "building_apk"
  | "success"
  | "failed";

export type BuildMode = "Free Trial" | "Paid Purchase";

export type BuildStatusValue = "queued" | "running" | "success" | "failed";

export type BuildStatusSource =
  | "github_status_json"
  | "local_api"
  | "manual_fix"
  | "unknown";

export type UserOperationEventName =
  | "login_success"
  | "builder_opened"
  | "icon_uploaded"
  | "build_started"
  | "build_status_polled"
  | "history_opened"
  | "result_opened"
  | "download_clicked";

export type BuildRequest = {
  appName: string;
  module: string;
  uiPack: string;
  plan: string;
  iconUrl?: string | null;
  iconDataUrl?: string | null;
  adminName?: string;
  adminPassword?: string;
  storeId?: string;
  userId?: string;
};

export type InternalBuildRecord = {
  id: string;
  runId: string;
  appName: string;
  moduleName: string;
  uiPackName: string;
  plan: string;
  mode: BuildMode;
  iconUrl?: string | null;
  iconDataUrl?: string | null;
  adminName?: string;
  storeId?: string | null;
  userId?: string;
  requestPath?: string | null;
  workflowRunId?: number | null;
  workflowStatus?: string | null;
  workflowConclusion?: string | null;
  workflowUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string | null;
  statusSource?: BuildStatusSource;
  status: BuildStatusValue;
  stage: BuildStage;
  message: string;
  artifactUrl: string | null;
  downloadUrl: string | null;
  error: string | null;
};

export type StartBuildResponse = {
  ok: boolean;
  runId?: string;
  stage?: BuildStage;
  message?: string | null;
  error?: string | null;
  storeId?: string | null;
};

export type BuildStatusResponse = {
  ok: boolean;
  runId?: string;
  stage?: BuildStage;
  message?: string | null;
  artifactUrl?: string | null;
  downloadUrl?: string | null;
  error?: string | null;
  appName?: string;
  adminName?: string;
  storeId?: string | null;
  moduleName?: string;
  uiPackName?: string;
  plan?: string;
  mode?: BuildMode;
  createdAt?: string;
  requestPath?: string | null;
  workflowRunId?: number | null;
  workflowStatus?: string | null;
  workflowConclusion?: string | null;
  workflowUrl?: string | null;
};

export type BuildHistoryItem = {
  runId: string;
  appName: string;
  stage: BuildStatusValue;
  createdAt: string;
  moduleName: string;
  uiPackName: string;
  mode: BuildMode;
  downloadUrl?: string | null;
};

export type BuildListResponse = {
  ok: boolean;
  items: BuildHistoryItem[];
  error?: string;
};
