import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";
import { getAdminRevenueOrders } from "@/lib/stripe/orders";

type FrontendProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url?: string | null;
  last_login_at: string | null;
  created_at: string;
  build_count?: number;
  latest_event_name?: string | null;
  latest_event_at?: string | null;
};

type FrontendBuildRow = {
  id: string;
  user_id: string;
  run_id: string;
  app_name: string;
  module_name: string;
  ui_pack_name: string;
  plan: string;
  store_id: string | null;
  status: "queued" | "running" | "success" | "failed";
  stage: string | null;
  message: string | null;
  workflow_run_id: number | null;
  workflow_url: string | null;
  artifact_url: string | null;
  download_url: string | null;
  error: string | null;
  failed_step: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type UserAcquisitionRow = {
  channel: string;
  sessions: number;
  percent: number;
};

type AdminActionRow = {
  created_at: string;
  actor_user_id: string | null;
  action_name: string;
  target_type: string | null;
  target_id: string | null;
};

type FrontendOperationLogRow = {
  occurred_at: string;
  user_id: string | null;
  run_id: string | null;
  event_name: string;
  page_path: string | null;
};

type BuildFailureStatRow = {
  step: string;
  count: number;
};

type SuccessRateRow = {
  name: string;
  total: number;
  success: number;
  failed: number;
  successRate: number;
};

type PageViewStatRow = {
  pagePath: string;
  views: number;
  visitors: number;
  lastViewedAt: string | null;
};

type PageViewLogRow = {
  id: string;
  user_id: string | null;
  session_id: string | null;
  page_path: string | null;
  viewed_at: string | null;
};

type BuildStatRow = {
  id: string;
  plan: string | null;
  status: string | null;
  created_at: string;
  completed_at: string | null;
};

type StoreDirectoryRow = {
  storeId: string;
  appName: string;
  userId: string | null;
  userLabel: string | null;
  moduleName: string | null;
  uiPackName: string | null;
  plan: string | null;
  latestBuildAt: string | null;
};

type AppCloudStoreRow = {
  store_id: string;
  module_type: string | null;
  plan_type: string | null;
  service_status: "active" | "read_only" | "deleted";
  is_write_allowed: boolean | null;
  service_start_at: string | null;
  service_end_at: string | null;
  delete_at: string | null;
  created_at?: string | null;
};

type StoreUsageStatsRow = {
  store_id: string;
  last_input_at: string | null;
  writes_24h: number;
  writes_7d: number;
  items_count: number;
  announcements_count: number;
  messages_7d: number;
  leads_7d: number;
  updated_at: string | null;
};

type StoreProfileRow = {
  store_id: string;
  business_status: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type StoreMembershipRow = {
  id: string;
  store_id: string;
  auth_user_id: string;
  is_active: boolean | null;
  created_at: string | null;
};

type CategoryRow = {
  id: string;
  store_id: string | null;
  name_zh?: string | null;
  name_en?: string | null;
  created_at: string | null;
};

type DishRow = {
  id: string;
  store_id: string | null;
  category_id: string | null;
  name_zh?: string | null;
  name_en?: string | null;
  recommended: boolean | null;
  sold_out: boolean | null;
  hidden: boolean | null;
  price: number | null;
  discount_price: number | null;
  click_count: number | null;
  view_count: number | null;
  created_at: string | null;
  updated_at: number | null;
};

type DishImageRow = {
  id: string;
  dish_id: string | null;
  store_id: string | null;
  created_at: string | null;
};

type AnnouncementRow = {
  id: string;
  store_id: string | null;
  status: string | null;
  updated_at: string | null;
  created_at: string | null;
  view_count: number | null;
};

type LeadRow = {
  id: string;
  store_id: string | null;
  source_dish_id: string | null;
  created_at: string | null;
};

type PushDeviceRow = {
  id: string;
  store_id: string | null;
  audience: string | null;
  token: string | null;
  device_install_id: string | null;
  platform: string | null;
  updated_at: number | null;
  created_at: string | null;
};

type ChatConversationRow = {
  conversation_id: string;
  store_id: string | null;
  client_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ChatThreadMetaRow = {
  store_id: string;
  conversation_id: string;
  merchant_archived: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type ChatMessageRow = {
  id: string;
  conversation_id: string | null;
  store_id: string | null;
  client_id: string | null;
  role: string | null;
  direction: string | null;
  text: string | null;
  time_ms: number | null;
  is_read: boolean | null;
  created_at: string | null;
};

type ChatRelayRow = {
  id: string;
  conversation_id: string | null;
  store_id: string | null;
  client_id: string | null;
  from_role: string | null;
  created_at: string | null;
};

type Metric = {
  title: string;
  value: string;
  hint?: string;
};

type TableBlock = {
  title: string;
  description?: string;
  headers: string[];
  rows: string[][];
};

type TabData = {
  metrics: Metric[];
  tables?: TableBlock[];
  notes?: string[];
};

type AdminOverviewResponse = {
  ok: true;
  generatedAt: string;
  summaryMetrics: Metric[];
  tabs: Record<string, TabData>;
};

type FrontendSnapshot = {
  totalUsers: number;
  totalBuilds: number;
  successBuilds: number;
  failedBuilds: number;
  queuedBuilds: number;
  runningBuilds: number;
  avgBuildMinutes: number | null;
  activeUsers7d: number;
  paidUsers: number;
  repeatUsers: number;
  buildFailuresToday: number;
  stalledQueuedBuilds: number;
  missingDownloadOnSuccess: number;
  builderOpenedCount: number;
  iconUploadedCount: number;
  buildStartedCount: number;
  checkoutOpenedCount: number;
  sessionCreatedCount: number;
  historyOpenedCount: number;
  resultOpenedCount: number;
  downloadClickedCount: number;
  loginSuccessCount: number;
  buildStatusPolledCount: number;
  authCallbackFailedCount: number;
  buildFailedEventCount: number;
  downloadFailedCount: number;
  pageViews7d: number;
  pageVisitors7d: number;
  d1Retention: number;
  d7Retention: number;
  d30Retention: number;
  bestChannel: string;
  recentUsers: FrontendProfileRow[];
  recentBuilds: FrontendBuildRow[];
  topModules: Array<{ name: string; count: number }>;
  topUiPacks: Array<{ name: string; count: number }>;
  channels: UserAcquisitionRow[];
  adminActionTotal: number;
  adminActions: AdminActionRow[];
  recentOperationLogs: FrontendOperationLogRow[];
  buildFailureStats: BuildFailureStatRow[];
  moduleSuccessStats: SuccessRateRow[];
  uiPackSuccessStats: SuccessRateRow[];
  pageViewStats: PageViewStatRow[];
  storeDirectory: StoreDirectoryRow[];
};

type SupportConversationSummaryRow = {
  id: string;
  guestSessionId: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  status: string;
  sourcePath: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  adminUnreadCount: number;
  userUnreadCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type SupportSourceStatRow = {
  sourcePath: string;
  count: number;
};

type SupportChatOverviewSnapshot = {
  totalConversations: number;
  openConversations: number;
  closedConversations: number;
  totalMessages: number;
  adminUnreadTotal: number;
  conversations1d: number;
  messages1d: number;
  activeConversations7d: number;
  guestConversations: number;
  loggedInConversations: number;
  withEmailConversations: number;
  avgFirstReplyMinutes: number;
  avgReplyMinutes: number;
  replyCount: number;
  overdueOpenConversations: number;
  sourceStats: SupportSourceStatRow[];
  overdueConversations: SupportConversationSummaryRow[];
  conversations: SupportConversationSummaryRow[];
};

function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatMoneyUsdFromCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDurationMinutes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value < 1) return "<1m";
  return `${Math.round(value)}m`;
}

function deriveEffectiveStoreStatus(row: AppCloudStoreRow, nowMs: number): AppCloudStoreRow["service_status"] {
  const deleteAtMs = row.delete_at ? new Date(row.delete_at).getTime() : Number.NaN;
  if (Number.isFinite(deleteAtMs) && deleteAtMs <= nowMs) {
    return "deleted";
  }

  const serviceEndMs = row.service_end_at ? new Date(row.service_end_at).getTime() : Number.NaN;
  if (Number.isFinite(serviceEndMs) && serviceEndMs <= nowMs) {
    return "read_only";
  }

  if (row.service_status === "deleted") return "deleted";
  if (row.service_status === "read_only") return "read_only";
  return "active";
}

function deriveEffectiveStoreWriteAllowed(row: AppCloudStoreRow, nowMs: number): boolean {
  return deriveEffectiveStoreStatus(row, nowMs) === "active" && row.is_write_allowed !== false;
}

function pickRevenueOrderTime(row: {
  processed_at: string | null;
  paid_at: string | null;
  checkout_completed_at: string | null;
  created_at: string;
}): string {
  return row.processed_at || row.paid_at || row.checkout_completed_at || row.created_at;
}

function isRevenueOrderWithinDays(
  row: {
    processed_at: string | null;
    paid_at: string | null;
    checkout_completed_at: string | null;
    created_at: string;
  },
  days: number,
  nowMs: number,
): boolean {
  const value = pickRevenueOrderTime(row);
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return time >= nowMs - days * 24 * 60 * 60 * 1000;
}

function toRevenueDayKey(row: {
  processed_at: string | null;
  paid_at: string | null;
  checkout_completed_at: string | null;
  created_at: string;
}): string {
  return formatDateOnly(pickRevenueOrderTime(row));
}

function isWithinDays(value: string | null | undefined, days: number, nowMs: number): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return time >= nowMs - days * 24 * 60 * 60 * 1000;
}

function isEpochWithinDays(value: number | null | undefined, days: number, nowMs: number): boolean {
  if (!value || !Number.isFinite(value)) return false;
  return value >= nowMs - days * 24 * 60 * 60 * 1000;
}

function rankMapEntries(map: Map<string, number>, limit = 20): Array<[string, number]> {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

export async function GET() {
  try {
    const adminCheck = await assertAdminAccess();

    if (!adminCheck.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: adminCheck.error,
        },
        { status: adminCheck.status },
      );
    }

    const authClient = await createServerSupabase();

    const { data: frontendSnapshotRaw, error: frontendSnapshotError } = await authClient.rpc(
      "admin_frontend_overview",
    );

    if (frontendSnapshotError) {
      throw new Error(`admin_frontend_overview rpc failed: ${frontendSnapshotError.message}`);
    }

    const frontendSnapshot = (frontendSnapshotRaw || {}) as FrontendSnapshot;

    const { data: supportChatSnapshotRaw, error: supportChatSnapshotError } = await authClient.rpc(
      "admin_support_chat_overview",
    );

    if (supportChatSnapshotError) {
      throw new Error(`admin_support_chat_overview rpc failed: ${supportChatSnapshotError.message}`);
    }

    const supportChatSnapshot = (supportChatSnapshotRaw || {}) as SupportChatOverviewSnapshot;

    const webAdmin = createAdminClient();

    const [
      pageViewLogsResult,
      buildStatsResult,
    ] = await Promise.all([
      webAdmin
        .from("page_view_logs")
        .select("id,user_id,session_id,page_path,viewed_at")
        .order("viewed_at", { ascending: false }),
      webAdmin
        .from("builds")
        .select("id,plan,status,created_at,completed_at")
        .order("created_at", { ascending: false }),
    ]);

    if (pageViewLogsResult.error) {
      throw new Error(`page_view_logs query failed: ${pageViewLogsResult.error.message}`);
    }

    if (buildStatsResult.error) {
      throw new Error(`builds query failed: ${buildStatsResult.error.message}`);
    }

    const pageViewLogs = (pageViewLogsResult.data || []) as PageViewLogRow[];
    const buildStatsRows = (buildStatsResult.data || []) as BuildStatRow[];

    let stores: AppCloudStoreRow[] = [];
    let storeUsageStats: StoreUsageStatsRow[] = [];
    let storeProfiles: StoreProfileRow[] = [];
    let storeMemberships: StoreMembershipRow[] = [];
    let categories: CategoryRow[] = [];
    let dishes: DishRow[] = [];
    let dishImages: DishImageRow[] = [];
    let announcements: AnnouncementRow[] = [];
    let leads: LeadRow[] = [];
    let pushDevices: PushDeviceRow[] = [];
    let chatConversations: ChatConversationRow[] = [];
    let chatThreadMeta: ChatThreadMetaRow[] = [];
    let chatMessages: ChatMessageRow[] = [];
    let chatRelay: ChatRelayRow[] = [];

    const appCloudUrl = process.env.APP_CLOUD_SUPABASE_URL?.trim() || "";
    const appCloudSecretKey = process.env.APP_CLOUD_SUPABASE_SECRET_KEY?.trim() || "";

    if (appCloudUrl && appCloudSecretKey) {
      const appCloudAdmin = createSupabaseClient(appCloudUrl, appCloudSecretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      const refreshResult = await appCloudAdmin.rpc("refresh_store_usage_stats");

      if (refreshResult.error) {
        throw new Error(`refresh_store_usage_stats failed: ${refreshResult.error.message}`);
      }

      const [
        storesResult,
        usageResult,
        storeProfilesResult,
        storeMembershipsResult,
        categoriesResult,
        dishesResult,
        dishImagesResult,
        announcementsResult,
        leadsResult,
        pushDevicesResult,
        chatConversationsResult,
        chatThreadMetaResult,
        chatMessagesResult,
        chatRelayResult,
      ] = await Promise.all([
        appCloudAdmin
          .from("stores")
          .select(
            "store_id,module_type,plan_type,service_status,is_write_allowed,service_start_at,service_end_at,delete_at,created_at",
          )
          .order("service_end_at", { ascending: true }),
        appCloudAdmin
          .from("store_usage_stats")
          .select(
            "store_id,last_input_at,writes_24h,writes_7d,items_count,announcements_count,messages_7d,leads_7d,updated_at",
          )
          .order("updated_at", { ascending: false }),
        appCloudAdmin
          .from("store_profiles")
          .select("store_id,business_status,updated_at,created_at")
          .order("updated_at", { ascending: false }),
        appCloudAdmin
          .from("store_memberships")
          .select("id,store_id,auth_user_id,is_active,created_at")
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("categories")
          .select("id,store_id,name_zh,name_en,created_at")
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("dishes")
          .select(
            "id,store_id,category_id,name_zh,name_en,recommended,sold_out,hidden,price,discount_price,click_count,view_count,created_at,updated_at",
          )
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("dish_images")
          .select("id,dish_id,store_id,created_at")
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("announcements")
          .select("id,store_id,status,updated_at,created_at,view_count")
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("leads")
          .select("id,store_id,source_dish_id,created_at")
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("push_devices")
          .select("id,store_id,audience,token,device_install_id,platform,updated_at,created_at")
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("chat_conversations")
          .select("conversation_id,store_id,client_id,created_at,updated_at")
          .order("updated_at", { ascending: false }),
        appCloudAdmin
          .from("chat_thread_meta")
          .select("store_id,conversation_id,merchant_archived,created_at,updated_at")
          .order("updated_at", { ascending: false }),
        appCloudAdmin
          .from("chat_messages")
          .select("id,conversation_id,store_id,client_id,role,direction,text,time_ms,is_read,created_at")
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("chat_relay")
          .select("id,conversation_id,store_id,client_id,from_role,created_at")
          .order("created_at", { ascending: false }),
      ]);

      const queryResults = [
        ["stores", storesResult],
        ["store_usage_stats", usageResult],
        ["store_profiles", storeProfilesResult],
        ["store_memberships", storeMembershipsResult],
        ["categories", categoriesResult],
        ["dishes", dishesResult],
        ["dish_images", dishImagesResult],
        ["announcements", announcementsResult],
        ["leads", leadsResult],
        ["push_devices", pushDevicesResult],
        ["chat_conversations", chatConversationsResult],
        ["chat_thread_meta", chatThreadMetaResult],
        ["chat_messages", chatMessagesResult],
        ["chat_relay", chatRelayResult],
      ] as const;

      for (const [name, result] of queryResults) {
        if (result.error) {
          throw new Error(`${name} query failed: ${result.error.message}`);
        }
      }

      stores = (storesResult.data || []) as AppCloudStoreRow[];
      storeUsageStats = (usageResult.data || []) as StoreUsageStatsRow[];
      storeProfiles = (storeProfilesResult.data || []) as StoreProfileRow[];
      storeMemberships = (storeMembershipsResult.data || []) as StoreMembershipRow[];
      categories = (categoriesResult.data || []) as CategoryRow[];
      dishes = (dishesResult.data || []) as DishRow[];
      dishImages = (dishImagesResult.data || []) as DishImageRow[];
      announcements = (announcementsResult.data || []) as AnnouncementRow[];
      leads = (leadsResult.data || []) as LeadRow[];
      pushDevices = (pushDevicesResult.data || []) as PushDeviceRow[];
      chatConversations = (chatConversationsResult.data || []) as ChatConversationRow[];
      chatThreadMeta = (chatThreadMetaResult.data || []) as ChatThreadMetaRow[];
      chatMessages = (chatMessagesResult.data || []) as ChatMessageRow[];
      chatRelay = (chatRelayResult.data || []) as ChatRelayRow[];
    }

    const revenueOrders = await getAdminRevenueOrders();

    const nowMs = Date.now();

    const paidRevenueOrders = revenueOrders.filter(
      (row) =>
        row.status === "paid" ||
        row.status === "processing" ||
        row.status === "processed",
    );

    const successfulRevenueOrders = revenueOrders.filter(
      (row) => row.status === "processed",
    );

    const failedRevenueOrders = revenueOrders.filter(
      (row) => row.status === "failed",
    );

    const canceledRevenueOrders = revenueOrders.filter(
      (row) => row.status === "canceled",
    );

    const processingRevenueOrders = revenueOrders.filter(
      (row) => row.status === "processing",
    );

    const checkoutCreatedRevenueOrders = revenueOrders.filter(
      (row) => row.status === "checkout_created",
    );

    const generateOrders = revenueOrders.filter(
      (row) => row.order_kind === "generate_app",
    );

    const renewOrders = revenueOrders.filter(
      (row) => row.order_kind === "renew_cloud",
    );

    const successfulGenerateOrders = successfulRevenueOrders.filter(
      (row) => row.order_kind === "generate_app",
    );

    const successfulRenewOrders = successfulRevenueOrders.filter(
      (row) => row.order_kind === "renew_cloud",
    );

    const totalPaidAmountCents = successfulRevenueOrders.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );

    const generatePaidAmountCents = successfulGenerateOrders.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );

    const renewPaidAmountCents = successfulRenewOrders.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );

    const revenueByStatusMap = new Map<string, number>();
    for (const row of revenueOrders) {
      revenueByStatusMap.set(row.status, (revenueByStatusMap.get(row.status) || 0) + 1);
    }

    const renewSalesMap = new Map<string, number>();
    for (const row of successfulRenewOrders) {
      const renewId = (row.renew_id || "-").trim() || "-";
      renewSalesMap.set(renewId, (renewSalesMap.get(renewId) || 0) + 1);
    }

    const revenueByKindMap = new Map<string, { count: number; cents: number }>();
    for (const row of successfulRevenueOrders) {
      const key = row.order_kind;
      const current = revenueByKindMap.get(key) || { count: 0, cents: 0 };
      current.count += 1;
      current.cents += row.amount_total || 0;
      revenueByKindMap.set(key, current);
    }

    const successfulPaidUserOrderCountMap = new Map<string, number>();
    for (const row of successfulRevenueOrders) {
      const userId = (row.user_id || "").trim();
      if (!userId) continue;
      successfulPaidUserOrderCountMap.set(
        userId,
        (successfulPaidUserOrderCountMap.get(userId) || 0) + 1,
      );
    }

    const successfulGeneratePaidUserSet = new Set<string>();
    for (const row of successfulGenerateOrders) {
      const userId = (row.user_id || "").trim();
      if (!userId) continue;
      successfulGeneratePaidUserSet.add(userId);
    }

    const successfulRenewPaidUserSet = new Set<string>();
    for (const row of successfulRenewOrders) {
      const userId = (row.user_id || "").trim();
      if (!userId) continue;
      successfulRenewPaidUserSet.add(userId);
    }

    const realPaidUserCount = successfulPaidUserOrderCountMap.size;

    const realRepeatPaidUserCount = Array.from(successfulPaidUserOrderCountMap.values()).filter(
      (count) => count > 1,
    ).length;

    const paidCheckoutEligibleOrders = revenueOrders.filter(
      (row) =>
        row.status === "checkout_created" ||
        row.status === "paid" ||
        row.status === "processing" ||
        row.status === "processed" ||
        row.status === "failed" ||
        row.status === "canceled",
    );

    const generateCheckoutEligibleOrders = generateOrders.filter(
      (row) =>
        row.status === "checkout_created" ||
        row.status === "paid" ||
        row.status === "processing" ||
        row.status === "processed" ||
        row.status === "failed" ||
        row.status === "canceled",
    );

    const renewCheckoutEligibleOrders = renewOrders.filter(
      (row) =>
        row.status === "checkout_created" ||
        row.status === "paid" ||
        row.status === "processing" ||
        row.status === "processed" ||
        row.status === "failed" ||
        row.status === "canceled",
    );

    const generatePaidOrLaterOrders = generateOrders.filter(
      (row) =>
        row.status === "paid" ||
        row.status === "processing" ||
        row.status === "processed",
    );

    const renewPaidOrLaterOrders = renewOrders.filter(
      (row) =>
        row.status === "paid" ||
        row.status === "processing" ||
        row.status === "processed",
    );

    const checkoutToPaidRate =
      paidCheckoutEligibleOrders.length > 0
        ? (paidRevenueOrders.length / paidCheckoutEligibleOrders.length) * 100
        : 0;

    const paidToProcessedRate =
      paidRevenueOrders.length > 0
        ? (successfulRevenueOrders.length / paidRevenueOrders.length) * 100
        : 0;

    const generateCheckoutToPaidRate =
      generateCheckoutEligibleOrders.length > 0
        ? (generatePaidOrLaterOrders.length / generateCheckoutEligibleOrders.length) * 100
        : 0;

    const renewCheckoutToPaidRate =
      renewCheckoutEligibleOrders.length > 0
        ? (renewPaidOrLaterOrders.length / renewCheckoutEligibleOrders.length) * 100
        : 0;

    const paymentFailureRate =
      paidCheckoutEligibleOrders.length > 0
        ? (failedRevenueOrders.length / paidCheckoutEligibleOrders.length) * 100
        : 0;

    const paymentCanceledRate =
      paidCheckoutEligibleOrders.length > 0
        ? (canceledRevenueOrders.length / paidCheckoutEligibleOrders.length) * 100
        : 0;

    const revenueOrders1d = revenueOrders.filter((row) => isRevenueOrderWithinDays(row, 1, nowMs));
    const revenueOrders7d = revenueOrders.filter((row) => isRevenueOrderWithinDays(row, 7, nowMs));
    const revenueOrders30d = revenueOrders.filter((row) => isRevenueOrderWithinDays(row, 30, nowMs));

    const successfulRevenueOrders1d = successfulRevenueOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 1, nowMs),
    );
    const successfulRevenueOrders7d = successfulRevenueOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 7, nowMs),
    );
    const successfulRevenueOrders30d = successfulRevenueOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 30, nowMs),
    );

    const successfulRenewOrders1d = successfulRenewOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 1, nowMs),
    );
    const successfulRenewOrders7d = successfulRenewOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 7, nowMs),
    );
    const successfulRenewOrders30d = successfulRenewOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 30, nowMs),
    );

    const totalPaidAmount1dCents = successfulRevenueOrders1d.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );
    const totalPaidAmount7dCents = successfulRevenueOrders7d.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );
    const totalPaidAmount30dCents = successfulRevenueOrders30d.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );

    const recentRevenueOrders = revenueOrders.slice(0, 30).map((row) => [
      formatDateTime(row.created_at),
      row.order_kind === "generate_app" ? "生成 App" : "云端续费",
      row.status,
      formatMoneyUsdFromCents(row.amount_total || 0),
      row.renew_id || "-",
      row.store_id || "-",
      row.run_id || "-",
      row.price_id || "-",
    ]);

    const recentSuccessfulRenewRows = successfulRenewOrders
      .slice()
      .sort(
        (a, b) =>
          new Date(pickRevenueOrderTime(b)).getTime() -
          new Date(pickRevenueOrderTime(a)).getTime(),
      )
      .slice(0, 30)
      .map((row) => [
        formatDateTime(pickRevenueOrderTime(row)),
        row.store_id || "-",
        row.renew_id || "-",
        formatMoneyUsdFromCents(row.amount_total || 0),
        row.stripe_session_id || "-",
      ]);

    const recentPaidUsersRows = Array.from(successfulPaidUserOrderCountMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([userId, paidCount]) => [
        userId,
        formatCount(paidCount),
      ]);

    const revenueStatusRows = Array.from(revenueByStatusMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([status, count]) => [status, formatCount(count)]);

    const revenueErrorMap = new Map<string, number>();
    for (const row of failedRevenueOrders) {
      const reason = String(row.error || "unknown").trim() || "unknown";
      revenueErrorMap.set(reason, (revenueErrorMap.get(reason) || 0) + 1);
    }

    const revenueErrorRows = Array.from(revenueErrorMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => [reason, formatCount(count)]);

    const renewSalesRows = Array.from(revenueByStatusMap.entries())
      .filter(() => false)
      .map(([status, count]) => [status, formatCount(count)]);

    const realRenewSalesRows = Array.from(renewSalesMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([renewId, count]) => [renewId, formatCount(count)]);

    const revenueKindRows = Array.from(revenueByKindMap.entries())
      .sort((a, b) => b[1].cents - a[1].cents || a[0].localeCompare(b[0]))
      .map(([kind, value]) => [
        kind === "generate_app" ? "生成 App" : "云端续费",
        formatCount(value.count),
        formatMoneyUsdFromCents(value.cents),
      ]);

    const paymentFunnelRows = [
      [
        "全量订单",
        formatCount(revenueOrders.length),
        "100.0%",
      ],
      [
        "已创建 Checkout",
        formatCount(paidCheckoutEligibleOrders.length),
        revenueOrders.length > 0
          ? formatPercent((paidCheckoutEligibleOrders.length / revenueOrders.length) * 100)
          : "0.0%",
      ],
      [
        "进入 paid/processing/processed",
        formatCount(paidRevenueOrders.length),
        formatPercent(checkoutToPaidRate),
      ],
      [
        "最终 processed",
        formatCount(successfulRevenueOrders.length),
        formatPercent(paidToProcessedRate),
      ],
      [
        "失败",
        formatCount(failedRevenueOrders.length),
        formatPercent(paymentFailureRate),
      ],
      [
        "取消",
        formatCount(canceledRevenueOrders.length),
        formatPercent(paymentCanceledRate),
      ],
    ];

    const paymentWindowRows = [
      [
        "今天",
        formatCount(revenueOrders1d.length),
        formatCount(successfulRevenueOrders1d.length),
        formatCount(successfulRenewOrders1d.length),
        formatMoneyUsdFromCents(totalPaidAmount1dCents),
      ],
      [
        "近 7 天",
        formatCount(revenueOrders7d.length),
        formatCount(successfulRevenueOrders7d.length),
        formatCount(successfulRenewOrders7d.length),
        formatMoneyUsdFromCents(totalPaidAmount7dCents),
      ],
      [
        "近 30 天",
        formatCount(revenueOrders30d.length),
        formatCount(successfulRevenueOrders30d.length),
        formatCount(successfulRenewOrders30d.length),
        formatMoneyUsdFromCents(totalPaidAmount30dCents),
      ],
    ];

    const dailyRevenueSuccessMap = new Map<string, { orders: number; renews: number; cents: number }>();
    for (let i = 13; i >= 0; i -= 1) {
      const baseDate = new Date(nowMs - i * 24 * 60 * 60 * 1000);
      const year = baseDate.getFullYear();
      const month = String(baseDate.getMonth() + 1).padStart(2, "0");
      const day = String(baseDate.getDate()).padStart(2, "0");
      const key = `${year}-${month}-${day}`;
      dailyRevenueSuccessMap.set(key, { orders: 0, renews: 0, cents: 0 });
    }

    for (const row of successfulRevenueOrders) {
      const dayKey = toRevenueDayKey(row);
      const current = dailyRevenueSuccessMap.get(dayKey);
      if (!current) continue;
      current.orders += 1;
      current.cents += row.amount_total || 0;
      if (row.order_kind === "renew_cloud") {
        current.renews += 1;
      }
    }

    const dailyRevenueTrendRows = Array.from(dailyRevenueSuccessMap.entries()).map(
      ([dayKey, value]) => [
        dayKey,
        formatCount(value.orders),
        formatCount(value.renews),
        formatMoneyUsdFromCents(value.cents),
      ],
    );

    const conversionByKindRows = [
      [
        "生成 App",
        formatCount(generateCheckoutEligibleOrders.length),
        formatCount(generatePaidOrLaterOrders.length),
        formatCount(successfulGenerateOrders.length),
        formatPercent(generateCheckoutToPaidRate),
      ],
      [
        "云端续费",
        formatCount(renewCheckoutEligibleOrders.length),
        formatCount(renewPaidOrLaterOrders.length),
        formatCount(successfulRenewOrders.length),
        formatPercent(renewCheckoutToPaidRate),
      ],
    ];

    const storeDirectoryMap = new Map<string, StoreDirectoryRow>(
      (frontendSnapshot.storeDirectory || []).map((row) => [row.storeId, row]),
    );

    const storeUsageMap = new Map<string, StoreUsageStatsRow>(
      storeUsageStats.map((row) => [row.store_id, row]),
    );

    const categoriesByStore = new Map<string, number>();
    const dishesByStore = new Map<string, number>();
    const dishImagesByStore = new Map<string, number>();
    const announcementsByStore = new Map<string, number>();
    const leadsByStore = new Map<string, number>();
    const leadsByStore7d = new Map<string, number>();
    const pushByStore = new Map<string, number>();
    const registeredDevicesByStore = new Map<string, Set<string>>();
    const conversationsByStore = new Map<string, number>();
    const messagesByStore = new Map<string, number>();
    const relayByStore = new Map<string, number>();
    const businessStatusMap = new Map<string, number>();
    const pushAudienceMap = new Map<string, number>();
    const pushPlatformMap = new Map<string, number>();
    const chatRoleMap = new Map<string, number>();
    const chatDirectionMap = new Map<string, number>();
    const relayRoleMap = new Map<string, number>();
    const categoryNameMap = new Map<string, string>();
    const dishNameMap = new Map<string, string>();
    const categoryDishCountMap = new Map<string, number>();
    const leadSourceDishMap = new Map<string, number>();

    for (const row of categories) {
      const storeId = row.store_id || "-";
      categoriesByStore.set(storeId, (categoriesByStore.get(storeId) || 0) + 1);
      categoryNameMap.set(row.id, row.name_zh || row.name_en || row.id);

      if (row.id) {
        categoryDishCountMap.set(row.id, categoryDishCountMap.get(row.id) || 0);
      }
    }

    for (const row of dishes) {
      const storeId = row.store_id || "-";
      dishesByStore.set(storeId, (dishesByStore.get(storeId) || 0) + 1);
      dishNameMap.set(row.id, row.name_zh || row.name_en || row.id);

      if (row.category_id) {
        categoryDishCountMap.set(row.category_id, (categoryDishCountMap.get(row.category_id) || 0) + 1);
      }
    }

    for (const row of dishImages) {
      const storeId = row.store_id || "-";
      dishImagesByStore.set(storeId, (dishImagesByStore.get(storeId) || 0) + 1);
    }

    for (const row of announcements) {
      const storeId = row.store_id || "-";
      announcementsByStore.set(storeId, (announcementsByStore.get(storeId) || 0) + 1);
    }

    for (const row of leads) {
      const storeId = row.store_id || "-";
      leadsByStore.set(storeId, (leadsByStore.get(storeId) || 0) + 1);

      if (isWithinDays(row.created_at, 7, nowMs)) {
        leadsByStore7d.set(storeId, (leadsByStore7d.get(storeId) || 0) + 1);
      }

      if (row.source_dish_id) {
        leadSourceDishMap.set(row.source_dish_id, (leadSourceDishMap.get(row.source_dish_id) || 0) + 1);
      }
    }

    for (const row of pushDevices) {
      const storeId = row.store_id || "-";
      const dedupeKey =
        (row.device_install_id || "").trim() ||
        (row.token || "").trim() ||
        row.id;

      if (!registeredDevicesByStore.has(storeId)) {
        registeredDevicesByStore.set(storeId, new Set<string>());
      }

      registeredDevicesByStore.get(storeId)!.add(dedupeKey);
      pushByStore.set(storeId, registeredDevicesByStore.get(storeId)!.size);

      const audience = (row.audience || "unknown").trim() || "unknown";
      pushAudienceMap.set(audience, (pushAudienceMap.get(audience) || 0) + 1);

      const platform = (row.platform || "unknown").trim() || "unknown";
      pushPlatformMap.set(platform, (pushPlatformMap.get(platform) || 0) + 1);
    }

    for (const row of chatConversations) {
      const storeId = row.store_id || "-";
      conversationsByStore.set(storeId, (conversationsByStore.get(storeId) || 0) + 1);
    }

    for (const row of chatMessages) {
      const storeId = row.store_id || "-";
      messagesByStore.set(storeId, (messagesByStore.get(storeId) || 0) + 1);

      const role = (row.role || "unknown").trim() || "unknown";
      chatRoleMap.set(role, (chatRoleMap.get(role) || 0) + 1);

      const direction = (row.direction || "unknown").trim() || "unknown";
      chatDirectionMap.set(direction, (chatDirectionMap.get(direction) || 0) + 1);
    }

    for (const row of chatRelay) {
      const storeId = row.store_id || "-";
      relayByStore.set(storeId, (relayByStore.get(storeId) || 0) + 1);

      const role = (row.from_role || "unknown").trim() || "unknown";
      relayRoleMap.set(role, (relayRoleMap.get(role) || 0) + 1);
    }

    for (const row of storeProfiles) {
      const status = (row.business_status || "unknown").trim() || "unknown";
      businessStatusMap.set(status, (businessStatusMap.get(status) || 0) + 1);
    }

    const totalBuilds = frontendSnapshot.totalBuilds || 0;
    const successBuilds = frontendSnapshot.successBuilds || 0;
    const failedBuilds = frontendSnapshot.failedBuilds || 0;
    const queuedBuilds = frontendSnapshot.queuedBuilds || 0;
    const runningBuilds = frontendSnapshot.runningBuilds || 0;
    const buildSuccessRate = totalBuilds > 0 ? (successBuilds / totalBuilds) * 100 : 0;

    const normalizedStores = stores.map((row) => ({
      ...row,
      service_status: deriveEffectiveStoreStatus(row, nowMs),
      is_write_allowed: deriveEffectiveStoreWriteAllowed(row, nowMs),
    }));

    const effectiveStores = normalizedStores.filter((row) => row.service_status !== "deleted").length;
    const readOnlyStores = normalizedStores.filter((row) => row.service_status === "read_only").length;
    const deletedStores = normalizedStores.filter((row) => row.service_status === "deleted").length;
    const trialStores = normalizedStores.filter((row) => row.plan_type === "trial").length;
    const paidStores = normalizedStores.filter((row) => row.plan_type === "paid").length;

    const expiring7dStores = normalizedStores.filter(
      (row) =>
        !!row.service_end_at &&
        new Date(row.service_end_at).getTime() >= nowMs &&
        new Date(row.service_end_at).getTime() <= nowMs + 7 * 24 * 60 * 60 * 1000 &&
        row.service_status !== "deleted",
    );

    const deleting7dStores = normalizedStores.filter(
      (row) =>
        !!row.delete_at &&
        new Date(row.delete_at).getTime() >= nowMs &&
        new Date(row.delete_at).getTime() <= nowMs + 7 * 24 * 60 * 60 * 1000 &&
        row.service_status !== "deleted",
    );

    const cloudStateAnomalies = normalizedStores.filter(
      (row) => row.service_status === "read_only" && row.is_write_allowed === true,
    ).length;

    const activeMemberships = storeMemberships.filter((row) => row.is_active !== false).length;
    const totalRegisteredDevices = Array.from(registeredDevicesByStore.values()).reduce(
      (sum, set) => sum + set.size,
      0,
    );
    const unreadMessages = chatMessages.filter((row) => row.is_read === false).length;
    const archivedThreads = chatThreadMeta.filter((row) => row.merchant_archived === true).length;
    const totalSiteMessages = chatMessages.length + (supportChatSnapshot.totalMessages || 0);
    const sessionCreatedCount = frontendSnapshot.sessionCreatedCount || 0;
    const avgOrderValueCents =
      successfulRevenueOrders.length > 0 ? totalPaidAmountCents / successfulRevenueOrders.length : 0;
    const arppuCents = realPaidUserCount > 0 ? totalPaidAmountCents / realPaidUserCount : 0;

    const todayKey = formatDateOnly(new Date().toISOString());

    const todayVisits = pageViewLogs.filter((row) => formatDateOnly(row.viewed_at) === todayKey).length;
    const visits7d = pageViewLogs.filter((row) => isWithinDays(row.viewed_at, 7, nowMs)).length;
    const visits30d = pageViewLogs.filter((row) => isWithinDays(row.viewed_at, 30, nowMs)).length;
    const visitsTotal = pageViewLogs.length;

    const successfulFreeBuildRows = buildStatsRows.filter(
      (row) => (row.plan || "").trim().toLowerCase() === "free" && row.status === "success",
    );

    const freeGenerateToday = successfulFreeBuildRows.filter(
      (row) => formatDateOnly(row.created_at) === todayKey,
    ).length;
    const freeGenerate7d = successfulFreeBuildRows.filter((row) =>
      isWithinDays(row.created_at, 7, nowMs),
    ).length;
    const freeGenerate30d = successfulFreeBuildRows.filter((row) =>
      isWithinDays(row.created_at, 30, nowMs),
    ).length;
    const freeGenerateTotal = successfulFreeBuildRows.length;

    const paidGenerateToday = successfulGenerateOrders.filter(
      (row) => formatDateOnly(pickRevenueOrderTime(row)) === todayKey,
    ).length;
    const paidGenerate7d = successfulGenerateOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 7, nowMs),
    ).length;
    const paidGenerate30d = successfulGenerateOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 30, nowMs),
    ).length;
    const paidGenerateTotal = successfulGenerateOrders.length;

    const paidGenerateIncomeTodayCents = successfulGenerateOrders
      .filter((row) => formatDateOnly(pickRevenueOrderTime(row)) === todayKey)
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const paidGenerateIncome7dCents = successfulGenerateOrders
      .filter((row) => isRevenueOrderWithinDays(row, 7, nowMs))
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const paidGenerateIncome30dCents = successfulGenerateOrders
      .filter((row) => isRevenueOrderWithinDays(row, 30, nowMs))
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const paidGenerateIncomeTotalCents = successfulGenerateOrders.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );

    const renew30SuccessOrders = successfulRenewOrders.filter(
      (row) => (row.renew_id || "").trim() === "30d",
    );
    const renew60SuccessOrders = successfulRenewOrders.filter(
      (row) => (row.renew_id || "").trim() === "90d",
    );
    const renew120SuccessOrders = successfulRenewOrders.filter(
      (row) => (row.renew_id || "").trim() === "180d",
    );

    const renew30Today = renew30SuccessOrders.filter(
      (row) => formatDateOnly(pickRevenueOrderTime(row)) === todayKey,
    ).length;
    const renew30_7d = renew30SuccessOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 7, nowMs),
    ).length;
    const renew30_30d = renew30SuccessOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 30, nowMs),
    ).length;
    const renew30Total = renew30SuccessOrders.length;

    const renew60Today = renew60SuccessOrders.filter(
      (row) => formatDateOnly(pickRevenueOrderTime(row)) === todayKey,
    ).length;
    const renew60_7d = renew60SuccessOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 7, nowMs),
    ).length;
    const renew60_30d = renew60SuccessOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 30, nowMs),
    ).length;
    const renew60Total = renew60SuccessOrders.length;

    const renew120Today = renew120SuccessOrders.filter(
      (row) => formatDateOnly(pickRevenueOrderTime(row)) === todayKey,
    ).length;
    const renew120_7d = renew120SuccessOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 7, nowMs),
    ).length;
    const renew120_30d = renew120SuccessOrders.filter((row) =>
      isRevenueOrderWithinDays(row, 30, nowMs),
    ).length;
    const renew120Total = renew120SuccessOrders.length;

    const renewIncomeTodayCents = successfulRenewOrders
      .filter((row) => formatDateOnly(pickRevenueOrderTime(row)) === todayKey)
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const renewIncome7dCents = successfulRenewOrders
      .filter((row) => isRevenueOrderWithinDays(row, 7, nowMs))
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const renewIncome30dCents = successfulRenewOrders
      .filter((row) => isRevenueOrderWithinDays(row, 30, nowMs))
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const renewIncomeTotalCents = successfulRenewOrders.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );

    const totalIncomeTodayCents = successfulRevenueOrders
      .filter((row) => formatDateOnly(pickRevenueOrderTime(row)) === todayKey)
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const totalIncome7dCents = successfulRevenueOrders
      .filter((row) => isRevenueOrderWithinDays(row, 7, nowMs))
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const totalIncome30dCents = successfulRevenueOrders
      .filter((row) => isRevenueOrderWithinDays(row, 30, nowMs))
      .reduce((sum, row) => sum + (row.amount_total || 0), 0);
    const totalIncomeTotalCents = successfulRevenueOrders.reduce(
      (sum, row) => sum + (row.amount_total || 0),
      0,
    );

    const publishedAnnouncements = announcements.filter(
      (row) => (row.status || "").toLowerCase() === "published",
    ).length;
    const draftAnnouncements = announcements.length - publishedAnnouncements;

    const recommendedDishes = dishes.filter((row) => row.recommended === true).length;
    const soldOutDishes = dishes.filter((row) => row.sold_out === true).length;
    const hiddenDishes = dishes.filter((row) => row.hidden === true).length;
    const discountedDishes = dishes.filter(
      (row) =>
        row.discount_price != null &&
        row.price != null &&
        Number(row.discount_price) < Number(row.price),
    ).length;

    const pageViewStats = frontendSnapshot.pageViewStats || [];
    const pageViewRows = pageViewStats.map((row) => [
      row.pagePath,
      formatCount(row.views),
      formatCount(row.visitors),
      formatDateTime(row.lastViewedAt),
    ]);

    const supportChatSourceRows = (supportChatSnapshot.sourceStats || []).map((row) => [
      row.sourcePath || "-",
      formatCount(row.count || 0),
    ]);

    const supportChatRecentRows = (supportChatSnapshot.conversations || []).slice(0, 30).map((row) => [
      formatDateTime(row.lastMessageAt),
      row.userEmail || row.userName || row.userId || row.guestSessionId || row.id,
      row.status || "-",
      formatCount(row.adminUnreadCount || 0),
      formatCount(row.userUnreadCount || 0),
      row.sourcePath || "-",
      row.lastMessagePreview || "-",
    ]);

    const supportChatOverdueRows = (supportChatSnapshot.overdueConversations || []).slice(0, 30).map((row) => [
      formatDateTime(row.lastMessageAt),
      row.userEmail || row.userName || row.userId || row.guestSessionId || row.id,
      row.status || "-",
      formatCount(row.adminUnreadCount || 0),
      row.sourcePath || "-",
      row.lastMessagePreview || "-",
    ]);

    const topCategoryRows = rankMapEntries(categoryDishCountMap, 20).map(([categoryId, count]) => [
      categoryNameMap.get(categoryId) || categoryId,
      formatCount(count),
    ]);

    const topLeadSourceRows = rankMapEntries(leadSourceDishMap, 20).map(([dishId, count]) => [
      dishNameMap.get(dishId) || dishId,
      formatCount(count),
    ]);

    const topAnnouncementRows = announcements
      .slice()
      .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
      .slice(0, 20)
      .map((row) => [
        row.store_id || "-",
        row.id,
        formatCount(row.view_count || 0),
        row.status || "-",
        formatDateTime(row.created_at),
      ]);

    const topDishClickRows = dishes
      .slice()
      .sort((a, b) => (b.click_count || 0) - (a.click_count || 0))
      .slice(0, 20)
      .map((row) => [
        row.store_id || "-",
        row.name_zh || row.name_en || row.id,
        formatCount(row.click_count || 0),
        formatCount(row.view_count || 0),
      ]);

    const storesWithDirectory = normalizedStores
      .slice()
      .sort((a, b) => {
        const aTime = storeDirectoryMap.get(a.store_id)?.latestBuildAt || "";
        const bTime = storeDirectoryMap.get(b.store_id)?.latestBuildAt || "";
        return new Date(bTime || 0).getTime() - new Date(aTime || 0).getTime();
      });

    const summaryMetrics: Metric[] = [
      {
        title: "当天访问量",
        value: formatCount(todayVisits),
        hint: `7天 ${formatCount(visits7d)} / 30天 ${formatCount(visits30d)}`,
      },
      {
        title: "当天免费生成次数",
        value: formatCount(freeGenerateToday),
        hint: `总计 ${formatCount(freeGenerateTotal)}`,
      },
      {
        title: "当天付费生成次数",
        value: formatCount(paidGenerateToday),
        hint: `总计 ${formatCount(paidGenerateTotal)}`,
      },
      {
        title: "当天总收入",
        value: formatMoneyUsdFromCents(totalIncomeTodayCents),
        hint: `总计 ${formatMoneyUsdFromCents(totalIncomeTotalCents)}`,
      },
    ];

    const tabs: Record<string, TabData> = {
      dashboard: {
        metrics: [
          { title: "当天访问量", value: formatCount(todayVisits), hint: `7天 ${formatCount(visits7d)} / 30天 ${formatCount(visits30d)} / 总计 ${formatCount(visitsTotal)}` },
          { title: "当天免费生成次数", value: formatCount(freeGenerateToday), hint: `7天 ${formatCount(freeGenerate7d)} / 30天 ${formatCount(freeGenerate30d)} / 总计 ${formatCount(freeGenerateTotal)}` },
          { title: "当天付费生成次数", value: formatCount(paidGenerateToday), hint: `7天 ${formatCount(paidGenerate7d)} / 30天 ${formatCount(paidGenerate30d)} / 总计 ${formatCount(paidGenerateTotal)}` },
          { title: "当天付费生成收入", value: formatMoneyUsdFromCents(paidGenerateIncomeTodayCents), hint: `7天 ${formatMoneyUsdFromCents(paidGenerateIncome7dCents)} / 30天 ${formatMoneyUsdFromCents(paidGenerateIncome30dCents)} / 总计 ${formatMoneyUsdFromCents(paidGenerateIncomeTotalCents)}` },
          { title: "当天云端续费收入", value: formatMoneyUsdFromCents(renewIncomeTodayCents), hint: `7天 ${formatMoneyUsdFromCents(renewIncome7dCents)} / 30天 ${formatMoneyUsdFromCents(renewIncome30dCents)} / 总计 ${formatMoneyUsdFromCents(renewIncomeTotalCents)}` },
          { title: "当天总收入", value: formatMoneyUsdFromCents(totalIncomeTodayCents), hint: `7天 ${formatMoneyUsdFromCents(totalIncome7dCents)} / 30天 ${formatMoneyUsdFromCents(totalIncome30dCents)} / 总计 ${formatMoneyUsdFromCents(totalIncomeTotalCents)}` },
          { title: "当天30天档云端续费次数", value: formatCount(renew30Today), hint: `7天 ${formatCount(renew30_7d)} / 30天 ${formatCount(renew30_30d)} / 总计 ${formatCount(renew30Total)}` },
          { title: "当天90天档云端续费次数", value: formatCount(renew60Today), hint: `7天 ${formatCount(renew60_7d)} / 30天 ${formatCount(renew60_30d)} / 总计 ${formatCount(renew60Total)}` },
          { title: "当天180天档云端续费次数", value: formatCount(renew120Today), hint: `7天 ${formatCount(renew120_7d)} / 30天 ${formatCount(renew120_30d)} / 总计 ${formatCount(renew120Total)}` },
        ],
        tables: [
          {
            title: "页面访问排行",
            description: "全站真实页面访问统计。",
            headers: ["页面", "访问量", "访客数", "最近访问"],
            rows: pageViewRows,
          },
          {
            title: "商户目录（真实映射）",
            description: "按 build 全量目录映射 Store ↔ App ↔ 用户。",
            headers: ["Store ID", "App 名称", "用户", "模块", "UI 包", "计划", "最新构建"],
            rows: storesWithDirectory.slice(0, 20).map((store) => {
              const directory = storeDirectoryMap.get(store.store_id);
              return [
                store.store_id,
                directory?.appName || "-",
                directory?.userLabel || "-",
                directory?.moduleName || store.module_type || "-",
                directory?.uiPackName || "-",
                directory?.plan || store.plan_type || "-",
                formatDateTime(directory?.latestBuildAt || null),
              ];
            }),
          },
        ],
      },

      builds: {
        metrics: [
          { title: "构建总数", value: formatCount(totalBuilds) },
          { title: "成功构建", value: formatCount(successBuilds) },
          { title: "失败构建", value: formatCount(failedBuilds) },
          { title: "排队中", value: formatCount(queuedBuilds) },
          { title: "构建中", value: formatCount(runningBuilds) },
          { title: "平均构建时长", value: formatDurationMinutes(frontendSnapshot.avgBuildMinutes), hint: "builds.completed_at - created_at" },
          { title: "今日失败", value: formatCount(frontendSnapshot.buildFailuresToday || 0) },
          { title: "排队超时", value: formatCount(frontendSnapshot.stalledQueuedBuilds || 0), hint: ">30 分钟 queued" },
          { title: "成功但缺下载", value: formatCount(frontendSnapshot.missingDownloadOnSuccess || 0), hint: "需排查回写" },
        ],
        tables: [
          {
            title: "步骤失败分布",
            headers: ["失败步骤", "次数"],
            rows: (frontendSnapshot.buildFailureStats || []).map((row) => [
              row.step || "unknown",
              formatCount(row.count || 0),
            ]),
          },
          {
            title: "逻辑模块成功率",
            headers: ["模块", "总构建", "成功", "失败", "成功率"],
            rows: (frontendSnapshot.moduleSuccessStats || []).map((row) => [
              row.name,
              formatCount(row.total),
              formatCount(row.success),
              formatCount(row.failed),
              formatPercent(row.successRate),
            ]),
          },
          {
            title: "UI 包成功率",
            headers: ["UI 包", "总构建", "成功", "失败", "成功率"],
            rows: (frontendSnapshot.uiPackSuccessStats || []).map((row) => [
              row.name,
              formatCount(row.total),
              formatCount(row.success),
              formatCount(row.failed),
              formatPercent(row.successRate),
            ]),
          },
        ],
      },

      users: {
        metrics: [
          { title: "当天免费生成次数", value: formatCount(freeGenerateToday), hint: `7天 ${formatCount(freeGenerate7d)} / 30天 ${formatCount(freeGenerate30d)} / 总免费生成次数 ${formatCount(freeGenerateTotal)}` },
          { title: "当天付费生成次数", value: formatCount(paidGenerateToday), hint: `7天 ${formatCount(paidGenerate7d)} / 30天 ${formatCount(paidGenerate30d)} / 总计付费生成次数 ${formatCount(paidGenerateTotal)}` },
          { title: "注册用户", value: formatCount(frontendSnapshot.totalUsers || 0), hint: "profiles" },
          { title: "7天活跃用户", value: formatCount(frontendSnapshot.activeUsers7d || 0), hint: "user_operation_logs" },
          { title: "真实付费用户", value: formatCount(realPaidUserCount), hint: "按 web_stripe_orders status=processed 去重 user_id" },
          { title: "真实复购用户", value: formatCount(realRepeatPaidUserCount), hint: "成功支付次数 > 1" },
          { title: "生成付费用户", value: formatCount(successfulGeneratePaidUserSet.size), hint: "generate_app processed 去重 user_id" },
          { title: "续费付费用户", value: formatCount(successfulRenewPaidUserSet.size), hint: "renew_cloud processed 去重 user_id" },
        ],
        tables: [
          {
            title: "真实支付用户概览",
            description: "基于 web_stripe_orders 成功支付订单去重统计。",
            headers: ["指标", "数值"],
            rows: [
              ["真实付费用户", formatCount(realPaidUserCount)],
              ["真实复购用户", formatCount(realRepeatPaidUserCount)],
              ["生成付费用户", formatCount(successfulGeneratePaidUserSet.size)],
              ["续费付费用户", formatCount(successfulRenewPaidUserSet.size)],
            ],
          },
          {
            title: "支付用户 Top 30",
            description: "按成功支付订单数倒序。",
            headers: ["用户 ID", "成功支付订单数"],
            rows: recentPaidUsersRows,
          },
          {
            title: "最近用户行为",
            description: "最近用户 + 最近动作。",
            headers: ["用户", "最近登录", "构建次数", "最近动作", "动作时间"],
            rows: (frontendSnapshot.recentUsers || []).map((row) => [
              row.email || row.display_name || row.id,
              formatDateTime(row.last_login_at),
              formatCount(row.build_count || 0),
              row.latest_event_name || "-",
              formatDateTime(row.latest_event_at),
            ]),
          },
          {
            title: "最近操作日志",
            description: "真实 user_operation_logs。",
            headers: ["时间", "事件", "页面", "Run ID", "用户"],
            rows: (frontendSnapshot.recentOperationLogs || []).map((row) => [
              formatDateTime(row.occurred_at),
              row.event_name,
              row.page_path || "-",
              row.run_id || "-",
              row.user_id || "-",
            ]),
          },
        ],
      },

      revenue: {
        metrics: [
          { title: "当天付费生成收入", value: formatMoneyUsdFromCents(paidGenerateIncomeTodayCents), hint: `7天 ${formatMoneyUsdFromCents(paidGenerateIncome7dCents)} / 30天 ${formatMoneyUsdFromCents(paidGenerateIncome30dCents)} / 总计付费生成收入 ${formatMoneyUsdFromCents(paidGenerateIncomeTotalCents)}` },
          { title: "当天云端续费收入", value: formatMoneyUsdFromCents(renewIncomeTodayCents), hint: `7天 ${formatMoneyUsdFromCents(renewIncome7dCents)} / 30天 ${formatMoneyUsdFromCents(renewIncome30dCents)} / 总计云端续费收入 ${formatMoneyUsdFromCents(renewIncomeTotalCents)}` },
          { title: "当天总收入", value: formatMoneyUsdFromCents(totalIncomeTodayCents), hint: `7天 ${formatMoneyUsdFromCents(totalIncome7dCents)} / 30天 ${formatMoneyUsdFromCents(totalIncome30dCents)} / 总计收入 ${formatMoneyUsdFromCents(totalIncomeTotalCents)}` },
          { title: "当天付费生成次数", value: formatCount(paidGenerateToday), hint: `7天 ${formatCount(paidGenerate7d)} / 30天 ${formatCount(paidGenerate30d)} / 总计付费生成次数 ${formatCount(paidGenerateTotal)}` },
          { title: "订单总数", value: formatCount(revenueOrders.length), hint: "web_stripe_orders" },
          { title: "支付成功", value: formatCount(successfulRevenueOrders.length), hint: "status=processed" },
          { title: "支付处理中", value: formatCount(processingRevenueOrders.length), hint: "status=processing" },
          { title: "支付失败", value: formatCount(failedRevenueOrders.length), hint: "status=failed" },
          { title: "支付取消", value: formatCount(canceledRevenueOrders.length), hint: "status=canceled" },
          { title: "Checkout 已创建", value: formatCount(checkoutCreatedRevenueOrders.length), hint: "status=checkout_created" },
          { title: "生成订单", value: formatCount(generateOrders.length), hint: `成功 ${formatCount(successfulGenerateOrders.length)}` },
          { title: "续费订单", value: formatCount(renewOrders.length), hint: `成功 ${formatCount(successfulRenewOrders.length)}` },
          { title: "Checkout→Paid 转化率", value: formatPercent(checkoutToPaidRate), hint: `${formatCount(paidRevenueOrders.length)} / ${formatCount(paidCheckoutEligibleOrders.length)}` },
          { title: "Paid→Processed 转化率", value: formatPercent(paidToProcessedRate), hint: `${formatCount(successfulRevenueOrders.length)} / ${formatCount(paidRevenueOrders.length)}` },
          { title: "生成支付转化率", value: formatPercent(generateCheckoutToPaidRate), hint: `${formatCount(generatePaidOrLaterOrders.length)} / ${formatCount(generateCheckoutEligibleOrders.length)}` },
          { title: "续费支付转化率", value: formatPercent(renewCheckoutToPaidRate), hint: `${formatCount(renewPaidOrLaterOrders.length)} / ${formatCount(renewCheckoutEligibleOrders.length)}` },
          { title: "客单价", value: formatMoneyUsdFromCents(avgOrderValueCents), hint: "成功支付订单平均金额" },
          { title: "ARPPU", value: formatMoneyUsdFromCents(arppuCents), hint: "真实付费用户平均收入" },
        ],
        tables: [
          {
            title: "支付转化漏斗",
            headers: ["阶段", "订单数", "转化率"],
            rows: paymentFunnelRows,
          },
          {
            title: "按类型支付转化",
            headers: ["类型", "Checkout 数", "Paid/Processing/Processed", "最终 Processed", "Checkout→Paid 转化率"],
            rows: conversionByKindRows,
          },
          {
            title: "时间窗口汇总",
            headers: ["时间窗口", "订单总数", "成功支付数", "成功续费数", "收入"],
            rows: paymentWindowRows,
          },
          {
            title: "最近14天收入趋势",
            headers: ["日期", "成功支付订单", "成功续费订单", "收入"],
            rows: dailyRevenueTrendRows,
          },
          {
            title: "收入按类型汇总",
            headers: ["类型", "成功订单数", "成功收入"],
            rows: revenueKindRows,
          },
          {
            title: "支付状态分布",
            headers: ["状态", "订单数"],
            rows: revenueStatusRows,
          },
          {
            title: "支付失败原因分布",
            headers: ["失败原因", "次数"],
            rows: revenueErrorRows,
          },
          {
            title: "续费档位销量",
            headers: ["续费档位", "成功支付数"],
            rows: realRenewSalesRows,
          },
          {
            title: "最近订单",
            headers: ["创建时间", "类型", "状态", "金额", "续费档位", "Store ID", "Run ID", "Price ID"],
            rows: recentRevenueOrders,
          },
          {
            title: "最近续费成功记录",
            headers: ["处理时间", "Store ID", "续费档位", "金额", "Stripe Session"],
            rows: recentSuccessfulRenewRows,
          },
        ],
        notes: [
          "收入统计来源：public.web_stripe_orders。",
          "成功收入口径：status=processed 的订单 amount_total 汇总。",
          "真实付费用户 / 真实复购用户 / 支付转化率 / 时间趋势均基于真实订单表计算。",
        ],
      },

      stores: {
        metrics: [
          { title: "Store 总数", value: formatCount(normalizedStores.length), hint: "stores" },
          { title: "有效 Store", value: formatCount(effectiveStores), hint: "service_status!=deleted" },
          { title: "只读 Store", value: formatCount(readOnlyStores), hint: "service_status=read_only" },
          { title: "已删除 Store", value: formatCount(deletedStores), hint: "service_status=deleted" },
          { title: "试用 Store", value: formatCount(trialStores), hint: "plan_type=trial" },
          { title: "付费 Store", value: formatCount(paidStores), hint: "plan_type=paid" },
          { title: "有资料商户", value: formatCount(storeProfiles.length), hint: "store_profiles" },
          { title: "激活 membership", value: formatCount(activeMemberships), hint: "store_memberships" },
        ],
        tables: [
          {
            title: "Store 目录（真实 App / 用户映射）",
            headers: ["Store ID", "App 名称", "所属用户", "模块", "状态", "注册设备数", "开始时间", "到期时间", "删库时间", "可写"],
            rows: storesWithDirectory.slice(0, 30).map((store) => {
              const directory = storeDirectoryMap.get(store.store_id);
              return [
                store.store_id,
                directory?.appName || "-",
                directory?.userLabel || "-",
                directory?.moduleName || store.module_type || "-",
                store.service_status,
                formatCount(pushByStore.get(store.store_id) || 0),
                formatDateOnly(store.service_start_at),
                formatDateOnly(store.service_end_at),
                formatDateOnly(store.delete_at),
                store.is_write_allowed ? "是" : "否",
              ];
            }),
          },
          {
            title: "business_status 分布",
            headers: ["状态", "商户数"],
            rows: rankMapEntries(businessStatusMap, 50).map(([name, count]) => [
              name,
              formatCount(count),
            ]),
          },
        ],
      },

      history: {
        metrics: [
          { title: "History 打开次数", value: formatCount(frontendSnapshot.historyOpenedCount || 0), hint: "history_opened" },
          { title: "Result 打开次数", value: formatCount(frontendSnapshot.resultOpenedCount || 0), hint: "result_opened" },
          { title: "Download 点击", value: formatCount(frontendSnapshot.downloadClickedCount || 0), hint: "download_clicked" },
          { title: "构建状态轮询", value: formatCount(frontendSnapshot.buildStatusPolledCount || 0), hint: "build_status_polled" },
        ],
        tables: [
          {
            title: "最近构建历史",
            headers: ["App", "状态", "阶段", "创建时间", "完成时间", "Store ID", "模块", "UI 包", "下载"],
            rows: (frontendSnapshot.recentBuilds || []).map((row) => [
              row.app_name,
              row.status,
              row.stage || "-",
              formatDateTime(row.created_at),
              formatDateTime(row.completed_at),
              row.store_id || "-",
              row.module_name,
              row.ui_pack_name,
              row.download_url ? "已生成" : "-",
            ]),
          },
        ],
      },

      cloud: {
        metrics: [
          { title: "未来 7 天到期", value: formatCount(expiring7dStores.length), hint: "stores.service_end_at" },
          { title: "未来 7 天删库", value: formatCount(deleting7dStores.length), hint: "stores.delete_at" },
          { title: "云端状态异常", value: formatCount(cloudStateAnomalies), hint: "read_only 但仍可写" },
          { title: "24h 写入总数", value: formatCount(storeUsageStats.reduce((sum, row) => sum + (row.writes_24h || 0), 0)), hint: "store_usage_stats" },
          { title: "7d 写入总数", value: formatCount(storeUsageStats.reduce((sum, row) => sum + (row.writes_7d || 0), 0)), hint: "store_usage_stats" },
{ title: "全站消息总数", value: formatCount(totalSiteMessages), hint: `App 云端未读 ${formatCount(unreadMessages)} / 站内聊天 ${formatCount(supportChatSnapshot.totalMessages || 0)}` },
          { title: "会话总数", value: formatCount(chatConversations.length), hint: `归档 ${formatCount(archivedThreads)}` },
          { title: "注册设备总数", value: formatCount(totalRegisteredDevices), hint: "按 store_id + device_install_id / token 去重" },
          { title: "relay 总数", value: formatCount(chatRelay.length), hint: "chat_relay" },
        ],
        tables: [
          {
            title: "到期 / 删库监控",
            headers: ["Store ID", "App", "用户", "状态", "到期", "删库", "最后输入", "7d写入"],
            rows: normalizedStores
              .filter((row) => row.service_status !== "deleted" && (!!row.service_end_at || !!row.delete_at))
              .slice(0, 30)
              .map((row) => {
                const directory = storeDirectoryMap.get(row.store_id);
                const usage = storeUsageMap.get(row.store_id);
                return [
                  row.store_id,
                  directory?.appName || "-",
                  directory?.userLabel || "-",
                  row.service_status,
                  formatDateOnly(row.service_end_at),
                  formatDateOnly(row.delete_at),
                  formatDateTime(usage?.last_input_at),
                  formatCount(usage?.writes_7d || 0),
                ];
              }),
          },
          {
            title: "云端活跃概览",
            headers: ["Store ID", "最后输入", "24h写入", "7d写入", "商品", "公告", "7d消息", "7d线索", "注册设备数"],
            rows: storeUsageStats.slice(0, 30).map((row) => [
              row.store_id,
              formatDateTime(row.last_input_at),
              formatCount(row.writes_24h || 0),
              formatCount(row.writes_7d || 0),
              formatCount(row.items_count || dishesByStore.get(row.store_id) || 0),
              formatCount(row.announcements_count || announcementsByStore.get(row.store_id) || 0),
              formatCount(row.messages_7d || 0),
              formatCount(row.leads_7d || 0),
              formatCount(pushByStore.get(row.store_id) || 0),
            ]),
          },
        ],
      },

      content: {
        metrics: [
          { title: "当天30天档云端续费次数", value: formatCount(renew30Today), hint: `7天 ${formatCount(renew30_7d)} / 30天 ${formatCount(renew30_30d)} / 总计30天档云端续费次数 ${formatCount(renew30Total)}` },
          { title: "当天90天档云端续费次数", value: formatCount(renew60Today), hint: `7天 ${formatCount(renew60_7d)} / 30天 ${formatCount(renew60_30d)} / 总计90天档云端续费次数 ${formatCount(renew60Total)}` },
          { title: "当天180天档云端续费次数", value: formatCount(renew120Today), hint: `7天 ${formatCount(renew120_7d)} / 30天 ${formatCount(renew120_30d)} / 总计180天档云端续费次数 ${formatCount(renew120Total)}` },
          { title: "分类总数", value: formatCount(categories.length), hint: "categories" },
          { title: "商品总数", value: formatCount(dishes.length), hint: `推荐 ${formatCount(recommendedDishes)} / 折扣 ${formatCount(discountedDishes)}` },
          { title: "售罄商品", value: formatCount(soldOutDishes), hint: `隐藏 ${formatCount(hiddenDishes)}` },
          { title: "商品图片数", value: formatCount(dishImages.length), hint: `平均每商品 ${(dishes.length > 0 ? dishImages.length / dishes.length : 0).toFixed(1)} 张` },
          { title: "公告总数", value: formatCount(announcements.length), hint: `总浏览 ${formatCount(announcements.reduce((sum, row) => sum + (row.view_count || 0), 0))}` },
          { title: "线索总数", value: formatCount(leads.length), hint: "leads" },
          { title: "热门模块", value: frontendSnapshot.topModules?.[0]?.name || "-", hint: frontendSnapshot.topModules?.[0] ? formatCount(frontendSnapshot.topModules[0].count) : "-" },
          { title: "热门 UI 包", value: frontendSnapshot.topUiPacks?.[0]?.name || "-", hint: frontendSnapshot.topUiPacks?.[0] ? formatCount(frontendSnapshot.topUiPacks[0].count) : "-" },
        ],
        tables: [
          {
            title: "商品点击 / 浏览排行",
            headers: ["Store ID", "商品", "点击数", "浏览数"],
            rows: topDishClickRows,
          },
          {
            title: "公告浏览排行",
            headers: ["Store ID", "公告ID", "浏览数", "状态", "创建时间"],
            rows: topAnnouncementRows,
          },
          {
            title: "分类商品排行",
            headers: ["分类", "商品数"],
            rows: topCategoryRows,
          },
          {
            title: "线索来源商品排行",
            headers: ["商品", "线索数"],
            rows: topLeadSourceRows,
          },
        ],
      },

      alerts: {
        metrics: [
          { title: "今日构建失败", value: formatCount(frontendSnapshot.buildFailuresToday || 0), hint: "builds" },
          { title: "排队超时", value: formatCount(frontendSnapshot.stalledQueuedBuilds || 0), hint: ">30 分钟 queued" },
          { title: "下载失败", value: formatCount(frontendSnapshot.downloadFailedCount || 0), hint: "download_failed" },
          { title: "登录回调失败", value: formatCount(frontendSnapshot.authCallbackFailedCount || 0), hint: "auth_callback_failed" },
          { title: "云端状态异常", value: formatCount(cloudStateAnomalies), hint: "read_only 但仍可写" },
          { title: "即将删库", value: formatCount(deleting7dStores.length), hint: "未来 7 天" },
          { title: "未读消息", value: formatCount(unreadMessages), hint: "chat_messages.is_read=false" },
          { title: "relay 活跃", value: formatCount(chatRelay.length), hint: "chat_relay" },
        ],
        tables: [
          {
            title: "异常清单",
            headers: ["类型", "对象", "时间", "状态"],
            rows: [
              ...(frontendSnapshot.recentBuilds || [])
                .filter((row) => row.status === "failed")
                .slice(0, 8)
                .map((row) => ["构建失败", row.run_id, formatDateTime(row.updated_at), "待处理"]),
              ...(frontendSnapshot.recentOperationLogs || [])
                .filter((row) => ["auth_callback_failed", "download_failed"].includes(row.event_name))
                .slice(0, 8)
                .map((row) => [row.event_name, row.run_id || row.user_id || "-", formatDateTime(row.occurred_at), "待处理"]),
              ...normalizedStores
                .filter((row) => row.service_status === "read_only" && row.is_write_allowed === true)
                .slice(0, 8)
                .map((row) => ["云端状态异常", row.store_id, formatDateTime(row.service_end_at || row.created_at), "待处理"]),
              ...deleting7dStores.slice(0, 8).map((row) => ["即将删库", row.store_id, formatDateTime(row.delete_at), "待处理"]),
            ],
          },
        ],
      },

      actions: {
        metrics: [
          { title: "后台操作总数", value: formatCount(frontendSnapshot.adminActionTotal || 0), hint: "admin_action_logs 全量" },
        ],
        tables: [
          {
            title: "后台操作日志",
            headers: ["时间", "操作者", "动作", "目标类型", "目标ID"],
            rows: (frontendSnapshot.adminActions || []).map((row) => [
              formatDateTime(row.created_at),
              row.actor_user_id || "-",
              row.action_name,
              row.target_type || "-",
              row.target_id || "-",
            ]),
          },
        ],
      },

      conversion: {
        metrics: [
          { title: "登录成功", value: formatCount(frontendSnapshot.loginSuccessCount || 0), hint: "login_success" },
          { title: "打开 Builder", value: formatCount(frontendSnapshot.builderOpenedCount || 0), hint: "builder_opened" },
          { title: "上传图标", value: formatCount(frontendSnapshot.iconUploadedCount || 0), hint: "icon_uploaded" },
          { title: "点击 Generate", value: formatCount(frontendSnapshot.buildStartedCount || 0), hint: "build_started" },
          { title: "打开 Checkout", value: formatCount(frontendSnapshot.checkoutOpenedCount || 0), hint: "checkout_opened" },
          { title: "Session 创建成功", value: formatCount(sessionCreatedCount), hint: "stripe_session_created" },
          { title: "打开 Result", value: formatCount(frontendSnapshot.resultOpenedCount || 0), hint: "result_opened" },
          { title: "点击 Download", value: formatCount(frontendSnapshot.downloadClickedCount || 0), hint: "download_clicked" },
          { title: "Checkout→Paid", value: formatPercent(checkoutToPaidRate), hint: `${formatCount(paidRevenueOrders.length)} / ${formatCount(paidCheckoutEligibleOrders.length)}` },
          { title: "Paid→Processed", value: formatPercent(paidToProcessedRate), hint: `${formatCount(successfulRevenueOrders.length)} / ${formatCount(paidRevenueOrders.length)}` },
        ],
        tables: [
          {
            title: "前端行为漏斗",
            headers: ["阶段", "次数", "相对上一阶段转化"],
            rows: [
              ["登录成功", formatCount(frontendSnapshot.loginSuccessCount || 0), "100%"],
              [
                "打开 Builder",
                formatCount(frontendSnapshot.builderOpenedCount || 0),
                frontendSnapshot.loginSuccessCount > 0
                  ? formatPercent(((frontendSnapshot.builderOpenedCount || 0) / frontendSnapshot.loginSuccessCount) * 100)
                  : "0%",
              ],
              [
                "上传图标",
                formatCount(frontendSnapshot.iconUploadedCount || 0),
                frontendSnapshot.builderOpenedCount > 0
                  ? formatPercent(((frontendSnapshot.iconUploadedCount || 0) / frontendSnapshot.builderOpenedCount) * 100)
                  : "0%",
              ],
              [
                "点击 Generate",
                formatCount(frontendSnapshot.buildStartedCount || 0),
                frontendSnapshot.iconUploadedCount > 0
                  ? formatPercent(((frontendSnapshot.buildStartedCount || 0) / frontendSnapshot.iconUploadedCount) * 100)
                  : "0%",
              ],
              [
                "打开 Checkout",
                formatCount(frontendSnapshot.checkoutOpenedCount || 0),
                frontendSnapshot.buildStartedCount > 0
                  ? formatPercent(((frontendSnapshot.checkoutOpenedCount || 0) / frontendSnapshot.buildStartedCount) * 100)
                  : "0%",
              ],
              [
                "Session 创建成功",
                formatCount(sessionCreatedCount),
                (frontendSnapshot.checkoutOpenedCount || 0) > 0
                  ? formatPercent((sessionCreatedCount / (frontendSnapshot.checkoutOpenedCount || 0)) * 100)
                  : "0%",
              ],
              [
                "支付成功",
                formatCount(successfulRevenueOrders.length),
                sessionCreatedCount > 0
                  ? formatPercent((successfulRevenueOrders.length / sessionCreatedCount) * 100)
                  : "0%",
              ],
              [
                "打开 Result",
                formatCount(frontendSnapshot.resultOpenedCount || 0),
                successfulRevenueOrders.length > 0
                  ? formatPercent(((frontendSnapshot.resultOpenedCount || 0) / successfulRevenueOrders.length) * 100)
                  : "0%",
              ],
              [
                "点击 Download",
                formatCount(frontendSnapshot.downloadClickedCount || 0),
                frontendSnapshot.resultOpenedCount > 0
                  ? formatPercent(((frontendSnapshot.downloadClickedCount || 0) / frontendSnapshot.resultOpenedCount) * 100)
                  : "0%",
              ],
            ],
          },
          {
            title: "支付漏斗",
            headers: ["阶段", "订单数", "转化率"],
            rows: paymentFunnelRows,
          },
          {
            title: "按类型支付转化",
            headers: ["类型", "Checkout 数", "Paid/Processing/Processed", "最终 Processed", "Checkout→Paid 转化率"],
            rows: conversionByKindRows,
          },
          {
            title: "页面访问排行",
            headers: ["页面", "访问量", "访客数", "最近访问"],
            rows: pageViewRows,
          },
        ],
      },
            chat: {
        metrics: [
          { title: "总会话数", value: formatCount(supportChatSnapshot.totalConversations || 0), hint: "support_conversations" },
          { title: "开放会话", value: formatCount(supportChatSnapshot.openConversations || 0), hint: "status=open" },
          { title: "已关闭会话", value: formatCount(supportChatSnapshot.closedConversations || 0), hint: "status=closed" },
          { title: "总消息数", value: formatCount(supportChatSnapshot.totalMessages || 0), hint: "support_messages" },
          { title: "管理员未读总数", value: formatCount(supportChatSnapshot.adminUnreadTotal || 0), hint: "admin_unread_count 汇总" },
          { title: "今日新增会话", value: formatCount(supportChatSnapshot.conversations1d || 0), hint: "近 1 天 created_at" },
          { title: "今日新增消息", value: formatCount(supportChatSnapshot.messages1d || 0), hint: "近 1 天 created_at" },
          { title: "7天活跃会话", value: formatCount(supportChatSnapshot.activeConversations7d || 0), hint: "近 7 天有消息" },
          { title: "游客会话", value: formatCount(supportChatSnapshot.guestConversations || 0), hint: "user_id is null" },
          { title: "登录用户会话", value: formatCount(supportChatSnapshot.loggedInConversations || 0), hint: "user_id is not null" },
          { title: "留邮箱会话", value: formatCount(supportChatSnapshot.withEmailConversations || 0), hint: "user_email 非空" },
          { title: "平均首响时长", value: formatDurationMinutes(supportChatSnapshot.avgFirstReplyMinutes || 0), hint: "首次用户消息 → 首次管理员回复" },
          { title: "平均回复时长", value: formatDurationMinutes(supportChatSnapshot.avgReplyMinutes || 0), hint: `样本 ${formatCount(supportChatSnapshot.replyCount || 0)}` },
          { title: "超时未回复会话", value: formatCount(supportChatSnapshot.overdueOpenConversations || 0), hint: "open + admin_unread_count>0 + 超过30分钟" },
        ],
        tables: [
          {
            title: "来源页面分布",
            headers: ["来源页面", "会话数"],
            rows: supportChatSourceRows,
          },
          {
            title: "超时未回复会话",
            headers: ["最后消息时间", "用户", "状态", "管理员未读", "来源页面", "最后消息预览"],
            rows: supportChatOverdueRows,
          },
          {
            title: "最近会话",
            headers: ["最后消息时间", "用户", "状态", "管理员未读", "用户未读", "来源页面", "最后消息预览"],
            rows: supportChatRecentRows,
          },
        ],
        notes: [
          "站内聊天统计来源：public.admin_support_chat_overview()。",
          "聊天操作面板仍保留在当前 Tab 下方，统计与操作同页查看。",
        ],
      },

      channels: {
        metrics: [
          { title: "渠道会话数", value: formatCount((frontendSnapshot.channels || []).reduce((sum, row) => sum + row.sessions, 0)), hint: "user_acquisition_logs" },
          { title: "最佳渠道", value: frontendSnapshot.bestChannel || "-", hint: "会话数最高" },
        ],
        tables: [
          {
            title: "渠道来源分布",
            headers: ["渠道", "会话数", "占比"],
            rows: (frontendSnapshot.channels || []).map((row) => [
              row.channel,
              formatCount(row.sessions),
              formatPercent(row.percent),
            ]),
          },
        ],
      },

      retention: {
        metrics: [
          { title: "D1 留存", value: formatPercent(frontendSnapshot.d1Retention || 0), hint: "user_operation_logs cohort" },
          { title: "D7 留存", value: formatPercent(frontendSnapshot.d7Retention || 0), hint: "user_operation_logs cohort" },
          { title: "D30 留存", value: formatPercent(frontendSnapshot.d30Retention || 0), hint: "user_operation_logs cohort" },
        ],
        tables: [
          {
            title: "push 设备分布",
            headers: ["受众/平台", "数量"],
            rows: [
              ...rankMapEntries(pushAudienceMap, 20).map(([name, count]) => [`audience:${name}`, formatCount(count)]),
              ...rankMapEntries(pushPlatformMap, 20).map(([name, count]) => [`platform:${name}`, formatCount(count)]),
            ],
          },
          {
            title: "聊天角色 / 方向 / relay 分布",
            headers: ["维度", "数量"],
            rows: [
              ...rankMapEntries(chatRoleMap, 20).map(([name, count]) => [`role:${name}`, formatCount(count)]),
              ...rankMapEntries(chatDirectionMap, 20).map(([name, count]) => [`direction:${name}`, formatCount(count)]),
              ...rankMapEntries(relayRoleMap, 20).map(([name, count]) => [`relay:${name}`, formatCount(count)]),
            ],
          },
        ],
        notes: ["订单 / 支付 / 续费统计已真实接入（含转化漏斗与收入指标）。"],
      },
    };

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      summaryMetrics,
      tabs,
    } satisfies AdminOverviewResponse);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load admin overview.",
      },
      { status: 500 },
    );
  }
}