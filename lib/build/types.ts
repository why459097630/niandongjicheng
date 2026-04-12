export type BuildStage =
  | "queued"
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

export type StepKey =
  | "preparing_request"
  | "processing_identity"
  | "matching_logic_module"
  | "applying_ui_pack"
  | "preparing_services"
  | "building_apk";

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
  | "download_clicked"
  | "auth_callback_failed"
  | "build_failed"
  | "download_failed";

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
  runId?: string;
};

export type CloudServiceStatus = "active" | "read_only" | "deleted";

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
  completedAt?: string | null;
  failedStep?: StepKey | null;
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
  adminPassword?: string;
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
  failedStep?: StepKey;
  queueAheadCount?: number;
  runningCount?: number;
  concurrencyLimit?: number;
};

export type BuildHistoryItem = {
  runId: string;
  appName: string;
  stage: BuildStatusValue;
  createdAt: string;
  completedAt?: string | null;
  failedStep?: StepKey | null;
  storeId?: string | null;
  moduleName: string;
  uiPackName: string;
  mode: BuildMode;
  downloadUrl?: string | null;
  cloudStatus?: CloudServiceStatus;
  cloudExpiresAt?: string | null;
  cloudDeletesAt?: string | null;
  isWriteAllowed?: boolean;
};

export type BuildListResponse = {
  ok: boolean;
  items: BuildHistoryItem[];
  error?: string;
};
