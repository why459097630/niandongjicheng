export type BuildStage =
  | "preparing_request"
  | "processing_identity"
  | "matching_module"
  | "applying_ui"
  | "preparing_services"
  | "building_apk"
  | "success"
  | "failed";

export type BuildMode = "Free Trial" | "Paid Purchase";

export type BuildRequest = {
  appName: string;
  module: string;
  uiPack: string;
  plan: string;
  iconUrl?: string | null;
  adminName?: string;
  adminPassword?: string;
  storeId?: string;
};

export type InternalBuildRecord = {
  runId: string;
  appName: string;
  moduleName: string;
  uiPackName: string;
  plan: string;
  mode: BuildMode;
  iconUrl?: string | null;
  adminName?: string;
  storeId?: string;
  requestPath?: string | null;
  workflowRunId?: number | null;
  workflowStatus?: string | null;
  workflowConclusion?: string | null;
  workflowUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  status: "queued" | "running" | "success" | "failed";
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
  message?: string;
  error?: string;
  storeId?: string;
};

export type BuildStatusResponse = {
  ok: boolean;
  runId?: string;
  stage?: BuildStage;
  message?: string;
  artifactUrl?: string | null;
  downloadUrl?: string | null;
  error?: string;
  appName?: string;
  adminName?: string;
  storeId?: string;
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
  stage: "success" | "failed" | "running" | "queued";
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
