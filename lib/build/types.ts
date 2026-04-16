export type BuildStage =
  | "configuring_build"
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

export type BuildPriority = "admin" | "paid" | "free";

export type PaymentOrderStatus =
  | "created"
  | "checkout_created"
  | "paid"
  | "processing"
  | "processed"
  | "failed"
  | "manual_review_required"
  | "refund_pending"
  | "refunded"
  | "canceled";

export type PaymentCompensationStatus =
  | "none"
  | "pending_retry"
  | "retrying"
  | "manual_review_required"
  | "refund_pending"
  | "refunded";

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
  | "download_failed"
  | "checkout_opened"
  | "stripe_session_created"
  | "payment_auto_retry_scheduled"
  | "payment_manual_review_required"
  | "payment_manual_retry_started"
  | "payment_refund_started"
  | "payment_refunded";

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
  buildPriority?: BuildPriority;
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
  buildPriority: BuildPriority;
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

  paymentOrderStatus?: PaymentOrderStatus | null;
  paymentCompensationStatus?: PaymentCompensationStatus | null;
  paymentCompensationNote?: string | null;
  paymentNextRetryAt?: string | null;
  paymentManualReviewRequiredAt?: string | null;
  paymentRefundedAt?: string | null;
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

  buildOrderStatus?: PaymentOrderStatus | null;
  buildCompensationStatus?: PaymentCompensationStatus | null;
  buildCompensationNote?: string | null;
  buildNextRetryAt?: string | null;
  buildManualReviewRequiredAt?: string | null;
  buildRefundedAt?: string | null;

  renewOrderStatus?: PaymentOrderStatus | null;
  renewCompensationStatus?: PaymentCompensationStatus | null;
  renewCompensationNote?: string | null;
  renewNextRetryAt?: string | null;
  renewManualReviewRequiredAt?: string | null;
  renewRefundedAt?: string | null;
};

export type BuildListResponse = {
  ok: boolean;
  items: BuildHistoryItem[];
  error?: string;
};