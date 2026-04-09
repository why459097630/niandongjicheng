import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
  created_at: string | null;
};

type DishRow = {
  id: string;
  store_id: string | null;
  category_id: string | null;
  recommended: boolean | null;
  sold_out: boolean | null;
  hidden: boolean | null;
  price: number | null;
  discount_price: number | null;
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
  historyOpenedCount: number;
  resultOpenedCount: number;
  downloadClickedCount: number;
  loginSuccessCount: number;
  buildStatusPolledCount: number;
  authCallbackFailedCount: number;
  buildFailedEventCount: number;
  downloadFailedCount: number;
  d1Retention: number;
  d7Retention: number;
  d30Retention: number;
  bestChannel: string;
  recentUsers: FrontendProfileRow[];
  recentBuilds: FrontendBuildRow[];
  topModules: Array<{ name: string; count: number }>;
  topUiPacks: Array<{ name: string; count: number }>;
  channels: UserAcquisitionRow[];
  adminActions: AdminActionRow[];
  recentOperationLogs: FrontendOperationLogRow[];
  buildFailureStats: BuildFailureStatRow[];
  moduleSuccessStats: SuccessRateRow[];
  uiPackSuccessStats: SuccessRateRow[];
};

function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
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

function formatRelativeDays(diffMs: number): string {
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今天";
  return `${days}天内`;
}

function getUserLabel(profile: FrontendProfileRow | undefined): string {
  if (!profile) return "-";
  return profile.email || profile.display_name || profile.id;
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

function getStoreFreshness(
  storeId: string,
  usage: Map<string, StoreUsageStatsRow>,
  messagesByStore: Map<string, number>,
  leadsByStore7d: Map<string, number>,
): number {
  const usageRow = usage.get(storeId);
  return (
    (usageRow?.writes_7d || 0) +
    (usageRow?.messages_7d || 0) +
    (usageRow?.leads_7d || 0) +
    (messagesByStore.get(storeId) || 0) +
    (leadsByStore7d.get(storeId) || 0)
  );
}

export async function GET() {
  try {
    const authClient = await createServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please sign in first.",
        },
        { status: 401 },
      );
    }

    const { data: frontendSnapshotRaw, error: frontendSnapshotError } = await authClient.rpc(
      "admin_frontend_overview",
    );

    if (frontendSnapshotError) {
      throw new Error(`admin_frontend_overview rpc failed: ${frontendSnapshotError.message}`);
    }

    const frontendSnapshot = (frontendSnapshotRaw || {}) as FrontendSnapshot;

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
    const appCloudServiceRole = process.env.APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

    if (appCloudUrl && appCloudServiceRole) {
      const appCloudAdmin = createSupabaseClient(appCloudUrl, appCloudServiceRole, {
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
          .select("id,store_id,created_at")
          .order("created_at", { ascending: false }),
        appCloudAdmin
          .from("dishes")
          .select(
            "id,store_id,category_id,recommended,sold_out,hidden,price,discount_price,created_at,updated_at",
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
          .select("id,store_id,audience,platform,updated_at,created_at")
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

    const now = new Date();
    const nowMs = now.getTime();

    const profilesById = new Map<string, FrontendProfileRow>(
      (frontendSnapshot.recentUsers || []).map((profile) => [profile.id, profile]),
    );

    const buildsByStoreId = new Map<string, FrontendBuildRow>();
    for (const build of frontendSnapshot.recentBuilds || []) {
      if (build.store_id && !buildsByStoreId.has(build.store_id)) {
        buildsByStoreId.set(build.store_id, build);
      }
    }

    const storeUsageMap = new Map<string, StoreUsageStatsRow>(
      storeUsageStats.map((row) => [row.store_id, row]),
    );

    const totalUsers = frontendSnapshot.totalUsers || 0;
    const totalBuilds = frontendSnapshot.totalBuilds || 0;
    const successBuilds = frontendSnapshot.successBuilds || 0;
    const failedBuilds = frontendSnapshot.failedBuilds || 0;
    const queuedBuilds = frontendSnapshot.queuedBuilds || 0;
    const runningBuilds = frontendSnapshot.runningBuilds || 0;
    const avgBuildMinutes = frontendSnapshot.avgBuildMinutes ?? null;
    const activeUsers7d = frontendSnapshot.activeUsers7d || 0;
    const paidUsers = frontendSnapshot.paidUsers || 0;
    const repeatUsers = frontendSnapshot.repeatUsers || 0;
    const buildFailuresToday = frontendSnapshot.buildFailuresToday || 0;
    const stalledQueuedBuilds = frontendSnapshot.stalledQueuedBuilds || 0;
    const missingDownloadOnSuccess = frontendSnapshot.missingDownloadOnSuccess || 0;
    const builderOpenedCount = frontendSnapshot.builderOpenedCount || 0;
    const iconUploadedCount = frontendSnapshot.iconUploadedCount || 0;
    const buildStartedCount = frontendSnapshot.buildStartedCount || 0;
    const historyOpenedCount = frontendSnapshot.historyOpenedCount || 0;
    const resultOpenedCount = frontendSnapshot.resultOpenedCount || 0;
    const downloadClickedCount = frontendSnapshot.downloadClickedCount || 0;
    const loginSuccessCount = frontendSnapshot.loginSuccessCount || 0;
    const buildStatusPolledCount = frontendSnapshot.buildStatusPolledCount || 0;
    const authCallbackFailedCount = frontendSnapshot.authCallbackFailedCount || 0;
    const buildFailedEventCount = frontendSnapshot.buildFailedEventCount || 0;
    const downloadFailedCount = frontendSnapshot.downloadFailedCount || 0;

    const effectiveStores = stores.filter((store) => store.service_status !== "deleted").length;
    const trialStores = stores.filter((store) => store.plan_type === "trial").length;
    const paidStores = stores.filter((store) => store.plan_type === "paid").length;
    const readOnlyStores = stores.filter((store) => store.service_status === "read_only").length;
    const deletedStores = stores.filter((store) => store.service_status === "deleted").length;

    const expiredStores = stores.filter(
      (store) =>
        !!store.service_end_at &&
        new Date(store.service_end_at).getTime() < nowMs &&
        store.service_status !== "deleted",
    ).length;

    const expiring7dStores = stores.filter(
      (store) =>
        !!store.service_end_at &&
        new Date(store.service_end_at).getTime() >= nowMs &&
        new Date(store.service_end_at).getTime() <= nowMs + 7 * 24 * 60 * 60 * 1000 &&
        store.service_status !== "deleted",
    );

    const expiring30dStores = stores.filter(
      (store) =>
        !!store.service_end_at &&
        new Date(store.service_end_at).getTime() >= nowMs &&
        new Date(store.service_end_at).getTime() <= nowMs + 30 * 24 * 60 * 60 * 1000 &&
        store.service_status !== "deleted",
    );

    const cloudStateAnomalies = stores.filter(
      (store) => store.service_status === "read_only" && store.is_write_allowed === true,
    ).length;

    const deletingSoonStores = stores.filter(
      (store) =>
        !!store.delete_at &&
        new Date(store.delete_at).getTime() >= nowMs &&
        new Date(store.delete_at).getTime() <= nowMs + 7 * 24 * 60 * 60 * 1000 &&
        store.service_status !== "deleted",
    );

    const created7dStores = stores.filter((store) => isWithinDays(store.created_at, 7, nowMs)).length;
    const started7dStores = stores.filter((store) => isWithinDays(store.service_start_at, 7, nowMs)).length;

    const profileCoverage = new Set(storeProfiles.map((row) => row.store_id)).size;
    const activeMemberships = storeMemberships.filter((row) => row.is_active !== false).length;

    const categories7d = categories.filter((row) => isWithinDays(row.created_at, 7, nowMs)).length;
    const dishes7d = dishes.filter(
      (row) => isWithinDays(row.created_at, 7, nowMs) || isEpochWithinDays(row.updated_at, 7, nowMs),
    ).length;
    const announcements7d = announcements.filter(
      (row) => isWithinDays(row.created_at, 7, nowMs) || isWithinDays(row.updated_at, 7, nowMs),
    ).length;
    const leads7d = leads.filter((row) => isWithinDays(row.created_at, 7, nowMs)).length;
    const messages7dActual = chatMessages.filter(
      (row) => isWithinDays(row.created_at, 7, nowMs) || isEpochWithinDays(row.time_ms, 7, nowMs),
    ).length;
    const devices7d = pushDevices.filter(
      (row) => isWithinDays(row.created_at, 7, nowMs) || isEpochWithinDays(row.updated_at, 7, nowMs),
    ).length;
    const conversations7d = chatConversations.filter(
      (row) => isWithinDays(row.created_at, 7, nowMs) || isWithinDays(row.updated_at, 7, nowMs),
    ).length;

    const recommendedDishes = dishes.filter((row) => row.recommended === true).length;
    const soldOutDishes = dishes.filter((row) => row.sold_out === true).length;
    const hiddenDishes = dishes.filter((row) => row.hidden === true).length;
    const discountedDishes = dishes.filter(
      (row) =>
        row.discount_price != null &&
        row.price != null &&
        Number(row.discount_price) < Number(row.price),
    ).length;

    const publishedAnnouncements = announcements.filter(
      (row) => String(row.status || "").toLowerCase() === "published",
    ).length;
    const draftAnnouncements = announcements.filter(
      (row) => String(row.status || "").toLowerCase() !== "published",
    ).length;

    const archivedThreads = chatThreadMeta.filter((row) => row.merchant_archived === true).length;
    const unreadMessages = chatMessages.filter((row) => row.is_read === false).length;

    const dishesByStore = new Map<string, number>();
    const announcementsByStore = new Map<string, number>();
    const leadsByStore = new Map<string, number>();
    const leadsByStore7d = new Map<string, number>();
    const messagesByStore = new Map<string, number>();
    const conversationsByStore = new Map<string, number>();
    const pushByStore = new Map<string, number>();
    const imagesByStore = new Map<string, number>();
    const categoriesByStore = new Map<string, number>();

    for (const row of dishes) {
      const key = row.store_id || "-";
      dishesByStore.set(key, (dishesByStore.get(key) || 0) + 1);
    }

    for (const row of announcements) {
      const key = row.store_id || "-";
      announcementsByStore.set(key, (announcementsByStore.get(key) || 0) + 1);
    }

    for (const row of leads) {
      const key = row.store_id || "-";
      leadsByStore.set(key, (leadsByStore.get(key) || 0) + 1);
      if (isWithinDays(row.created_at, 7, nowMs)) {
        leadsByStore7d.set(key, (leadsByStore7d.get(key) || 0) + 1);
      }
    }

    for (const row of chatMessages) {
      const key = row.store_id || "-";
      messagesByStore.set(key, (messagesByStore.get(key) || 0) + 1);
    }

    for (const row of chatConversations) {
      const key = row.store_id || "-";
      conversationsByStore.set(key, (conversationsByStore.get(key) || 0) + 1);
    }

    for (const row of pushDevices) {
      const key = row.store_id || "-";
      pushByStore.set(key, (pushByStore.get(key) || 0) + 1);
    }

    for (const row of dishImages) {
      const key = row.store_id || "-";
      imagesByStore.set(key, (imagesByStore.get(key) || 0) + 1);
    }

    for (const row of categories) {
      const key = row.store_id || "-";
      categoriesByStore.set(key, (categoriesByStore.get(key) || 0) + 1);
    }

    const storesSortedByFreshness = stores
      .slice()
      .sort(
        (a, b) =>
          getStoreFreshness(b.store_id, storeUsageMap, messagesByStore, leadsByStore7d) -
          getStoreFreshness(a.store_id, storeUsageMap, messagesByStore, leadsByStore7d),
      )
      .slice(0, 20);

    const storesSortedByDeleteAt = stores
      .filter((store) => !!store.delete_at && store.service_status !== "deleted")
      .slice()
      .sort(
        (a, b) =>
          new Date(a.delete_at || "2999-12-31").getTime() -
          new Date(b.delete_at || "2999-12-31").getTime(),
      )
      .slice(0, 20);

    const successRate = totalBuilds > 0 ? (successBuilds / totalBuilds) * 100 : 0;
    const pollPerBuild = buildStartedCount > 0 ? buildStatusPolledCount / buildStartedCount : 0;

    const summaryMetrics: Metric[] = [
      {
        title: "当前排队",
        value: formatCount(queuedBuilds),
        hint: `构建中 ${formatCount(runningBuilds)}`,
      },
      {
        title: "有效商户",
        value: formatCount(effectiveStores),
        hint: `试用 ${formatCount(trialStores)} / 付费 ${formatCount(paidStores)}`,
      },
      {
        title: "未来 7 天到期",
        value: formatCount(expiring7dStores.length),
        hint: `删库预警 ${formatCount(deletingSoonStores.length)}`,
      },
      {
        title: "今日构建失败",
        value: formatCount(buildFailuresToday),
        hint: `下载失败日志 ${formatCount(downloadFailedCount)}`,
      },
    ];

    const tabs: Record<string, TabData> = {
      dashboard: {
        metrics: [
          { title: "总用户数", value: formatCount(totalUsers), hint: "前端用户云端全局" },
          { title: "总构建次数", value: formatCount(totalBuilds), hint: "builds 全局" },
          {
            title: "成功率",
            value: formatPercent(successRate),
            hint: `成功 ${formatCount(successBuilds)} / 失败 ${formatCount(failedBuilds)}`,
          },
          {
            title: "平均构建时长",
            value: formatDurationMinutes(avgBuildMinutes),
            hint: "completed_at - created_at",
          },
          {
            title: "当前有效云端商户",
            value: formatCount(effectiveStores),
            hint: `只读 ${formatCount(readOnlyStores)} / 已删 ${formatCount(deletedStores)}`,
          },
          {
            title: "已接商户资料",
            value: formatCount(profileCoverage),
            hint: `store_profiles / stores = ${formatPercent(
              stores.length > 0 ? (profileCoverage / stores.length) * 100 : 0,
            )}`,
          },
          {
            title: "商品总数",
            value: formatCount(dishes.length),
            hint: `分类 ${formatCount(categories.length)} / 图片 ${formatCount(dishImages.length)}`,
          },
          {
            title: "聊天消息总数",
            value: formatCount(chatMessages.length),
            hint: `会话 ${formatCount(chatConversations.length)} / 7天 ${formatCount(messages7dActual)}`,
          },
          {
            title: "公告总数",
            value: formatCount(announcements.length),
            hint: `已发布 ${formatCount(publishedAnnouncements)} / 草稿 ${formatCount(draftAnnouncements)}`,
          },
          { title: "线索总数", value: formatCount(leads.length), hint: `近7天 ${formatCount(leads7d)}` },
          {
            title: "推送设备总数",
            value: formatCount(pushDevices.length),
            hint: `近7天变动 ${formatCount(devices7d)}`,
          },
          {
            title: "未来 7 天到期",
            value: formatCount(expiring7dStores.length),
            hint: `30天内 ${formatCount(expiring30dStores.length)}`,
          },
        ],
        tables: [
          {
            title: "商户经营活跃榜",
            description: "按写入 + 消息 + 线索综合排序。",
            headers: ["Store ID", "App", "状态", "7d写入", "7d消息", "7d线索", "最后输入", "到期"],
            rows: storesSortedByFreshness.map((store) => {
              const build = buildsByStoreId.get(store.store_id);
              const usage = storeUsageMap.get(store.store_id);
              return [
                store.store_id,
                build?.app_name || "-",
                store.service_status,
                formatCount(usage?.writes_7d || 0),
                formatCount(usage?.messages_7d || 0),
                formatCount(usage?.leads_7d || 0),
                formatDateTime(usage?.last_input_at),
                formatDateOnly(store.service_end_at),
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
          { title: "今日失败", value: formatCount(buildFailuresToday) },
          { title: "排队超时", value: formatCount(stalledQueuedBuilds), hint: ">30 分钟仍 queued" },
          { title: "成功但缺下载", value: formatCount(missingDownloadOnSuccess), hint: "需排查回写" },
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
              formatCount(row.total || 0),
              formatCount(row.success || 0),
              formatCount(row.failed || 0),
              formatPercent(row.successRate || 0),
            ]),
          },
          {
            title: "UI 包成功率",
            headers: ["UI 包", "总构建", "成功", "失败", "成功率"],
            rows: (frontendSnapshot.uiPackSuccessStats || []).map((row) => [
              row.name,
              formatCount(row.total || 0),
              formatCount(row.success || 0),
              formatCount(row.failed || 0),
              formatPercent(row.successRate || 0),
            ]),
          },
          {
            title: "最近构建记录",
            description: "全站构建记录。",
            headers: ["Run", "状态", "阶段", "创建时间", "完成时间", "构建耗时", "模块", "UI 包", "计划", "失败步骤"],
            rows: (frontendSnapshot.recentBuilds || []).slice(0, 20).map((build) => [
              build.run_id,
              build.status,
              build.stage || "-",
              formatDateTime(build.created_at),
              formatDateTime(build.completed_at),
              formatDurationMinutes(
                build.completed_at
                  ? (new Date(build.completed_at).getTime() - new Date(build.created_at).getTime()) / 60000
                  : null,
              ),
              build.module_name,
              build.ui_pack_name,
              build.plan,
              build.failed_step || "-",
            ]),
          },
        ],
      },

      users: {
        metrics: [
          { title: "注册用户", value: formatCount(totalUsers), hint: "profiles 全局" },
          { title: "7天活跃用户", value: formatCount(activeUsers7d), hint: "user_operation_logs 全局" },
          { title: "登录成功", value: formatCount(loginSuccessCount), hint: "login_success" },
          { title: "付费用户", value: formatCount(paidUsers), hint: "按 builds.plan!=free 推算" },
          { title: "复购用户", value: formatCount(repeatUsers), hint: "多次非 free 构建" },
          { title: "登录回调失败", value: formatCount(authCallbackFailedCount), hint: "auth_callback_failed" },
          { title: "构建失败事件", value: formatCount(buildFailedEventCount), hint: "build_failed" },
          { title: "下载失败事件", value: formatCount(downloadFailedCount), hint: "download_failed" },
        ],
        tables: [
          {
            title: "最近用户行为",
            description: "全站最近用户行为。",
            headers: ["用户", "最近登录", "构建次数", "最近动作", "动作时间"],
            rows: (frontendSnapshot.recentUsers || []).slice(0, 20).map((profile) => [
              profile.email || profile.display_name || profile.id,
              formatDateTime(profile.last_login_at),
              formatCount(profile.build_count || 0),
              profile.latest_event_name || "-",
              formatDateTime(profile.latest_event_at),
            ]),
          },
          {
            title: "最近前端操作日志",
            description: "user_operation_logs 最新事件。",
            headers: ["时间", "事件", "页面", "Run ID", "用户"],
            rows: (frontendSnapshot.recentOperationLogs || []).slice(0, 20).map((row) => [
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
        metrics: [],
        notes: ["按你的要求，这里先不接订单 / 支付 / 续费收入统计。"],
      },

      stores: {
        metrics: [
          { title: "Store 总数", value: formatCount(stores.length), hint: "stores 全局" },
          { title: "活跃 Store", value: formatCount(effectiveStores), hint: "service_status!=deleted" },
          { title: "只读 Store", value: formatCount(readOnlyStores), hint: "service_status=read_only" },
          { title: "已删除 Store", value: formatCount(deletedStores), hint: "service_status=deleted" },
          { title: "近7天新建 Store", value: formatCount(created7dStores), hint: "stores.created_at" },
          { title: "近7天开通服务", value: formatCount(started7dStores), hint: "stores.service_start_at" },
          { title: "资料已建立商户", value: formatCount(profileCoverage), hint: "store_profiles" },
          { title: "激活会员关系", value: formatCount(activeMemberships), hint: "store_memberships.is_active" },
        ],
        tables: [
          {
            title: "商户 / Store 列表",
            description: "全站商户列表。",
            headers: ["Store ID", "App 名称", "所属用户", "模块", "状态", "开始时间", "到期时间", "删库时间", "可写", "计划"],
            rows: stores.slice(0, 20).map((store) => {
              const build = buildsByStoreId.get(store.store_id);
              const profile = build ? profilesById.get(build.user_id) : undefined;
              return [
                store.store_id,
                build?.app_name || "-",
                profile ? getUserLabel(profile) : "-",
                store.module_type || "-",
                store.service_status,
                formatDateOnly(store.service_start_at),
                formatDateOnly(store.service_end_at),
                formatDateOnly(store.delete_at),
                store.is_write_allowed ? "是" : "否",
                store.plan_type || "-",
              ];
            }),
          },
          {
            title: "即将删库列表",
            description: "delete_at 最近的商户。",
            headers: ["Store ID", "状态", "到期", "删库时间", "最后输入", "7d写入"],
            rows: storesSortedByDeleteAt.map((store) => {
              const usage = storeUsageMap.get(store.store_id);
              return [
                store.store_id,
                store.service_status,
                formatDateOnly(store.service_end_at),
                formatDateOnly(store.delete_at),
                formatDateTime(usage?.last_input_at),
                formatCount(usage?.writes_7d || 0),
              ];
            }),
          },
        ],
      },

      history: {
        metrics: [
          { title: "历史记录总数", value: formatCount(totalBuilds) },
          { title: "成功记录", value: formatCount(successBuilds), hint: "可下载 / 可续费候选" },
          { title: "失败记录", value: formatCount(failedBuilds) },
          {
            title: "轮询次数",
            value: formatCount(buildStatusPolledCount),
            hint: `平均每次构建 ${pollPerBuild.toFixed(1)} 次`,
          },
          { title: "打开 History", value: formatCount(historyOpenedCount), hint: "history_opened" },
          { title: "打开 Result", value: formatCount(resultOpenedCount), hint: "result_opened" },
          { title: "点击 Download", value: formatCount(downloadClickedCount), hint: "download_clicked" },
          { title: "下载失败日志", value: formatCount(downloadFailedCount), hint: "download_failed" },
        ],
        tables: [
          {
            title: "历史记录管理",
            description: "全站构建历史记录。",
            headers: ["App 名称", "状态", "阶段", "创建时间", "完成时间", "下载", "模块", "UI 包", "计划", "Store ID"],
            rows: (frontendSnapshot.recentBuilds || []).slice(0, 20).map((build) => [
              build.app_name,
              build.status,
              build.stage || "-",
              formatDateTime(build.created_at),
              formatDateTime(build.completed_at),
              build.download_url ? "已生成" : "-",
              build.module_name,
              build.ui_pack_name,
              build.plan,
              build.store_id || "-",
            ]),
          },
          {
            title: "失败与异常事件日志",
            description: "便于对照前端实际失败与下载异常。",
            headers: ["时间", "事件", "Run ID", "页面", "用户"],
            rows: (frontendSnapshot.recentOperationLogs || [])
              .filter((row) =>
                ["auth_callback_failed", "build_failed", "download_failed"].includes(row.event_name),
              )
              .slice(0, 20)
              .map((row) => [
                formatDateTime(row.occurred_at),
                row.event_name,
                row.run_id || "-",
                row.page_path || "-",
                row.user_id || "-",
              ]),
          },
        ],
      },

      cloud: {
        metrics: [
          { title: "即将到期商户数", value: formatCount(expiring7dStores.length), hint: "未来 7 天" },
          { title: "已过期商户数", value: formatCount(expiredStores), hint: "service_end_at < now" },
          { title: "即将删库商户数", value: formatCount(deletingSoonStores.length), hint: "未来 7 天 delete_at" },
          { title: "云端状态异常", value: formatCount(cloudStateAnomalies), hint: "read_only 但仍可写" },
          {
            title: "24h 写入总数",
            value: formatCount(storeUsageStats.reduce((sum, row) => sum + (row.writes_24h || 0), 0)),
            hint: "store_usage_stats",
          },
          {
            title: "7d 写入总数",
            value: formatCount(storeUsageStats.reduce((sum, row) => sum + (row.writes_7d || 0), 0)),
            hint: "store_usage_stats",
          },
          { title: "真实 7d 消息数", value: formatCount(messages7dActual), hint: "chat_messages" },
          { title: "真实 7d 线索数", value: formatCount(leads7d), hint: "leads" },
        ],
        tables: [
          {
            title: "未来 7 天到期列表",
            description: "全站到期监控。",
            headers: ["Store ID", "App", "状态", "到期", "删库", "用户", "最后写入", "备注"],
            rows: expiring7dStores.slice(0, 20).map((store) => {
              const build = buildsByStoreId.get(store.store_id);
              const profile = build ? profilesById.get(build.user_id) : undefined;
              const usage = storeUsageMap.get(store.store_id);
              const diffMs = new Date(store.service_end_at || now.toISOString()).getTime() - nowMs;
              return [
                store.store_id,
                build?.app_name || "-",
                store.service_status,
                formatDateOnly(store.service_end_at),
                formatDateOnly(store.delete_at),
                profile ? getUserLabel(profile) : "-",
                formatDateTime(usage?.last_input_at),
                formatRelativeDays(diffMs),
              ];
            }),
          },
          {
            title: "云端活跃概览",
            description: "从 store_usage_stats + 真实业务表整合。",
            headers: ["Store ID", "最后输入", "24h写入", "7d写入", "商品数", "公告数", "7d消息", "7d线索", "推送设备"],
            rows: storeUsageStats.slice(0, 20).map((row) => [
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
          {
            title: "逻辑模块使用次数",
            value: formatCount(totalBuilds),
            hint: "builds.module_name 聚合",
          },
          {
            title: "最热门模块",
            value: frontendSnapshot.topModules?.[0]?.name || "-",
            hint: frontendSnapshot.topModules?.[0]
              ? formatCount(frontendSnapshot.topModules[0].count)
              : "-",
          },
          {
            title: "最热门 UI 包",
            value: frontendSnapshot.topUiPacks?.[0]?.name || "-",
            hint: frontendSnapshot.topUiPacks?.[0]
              ? formatCount(frontendSnapshot.topUiPacks[0].count)
              : "-",
          },
          { title: "分类总数", value: formatCount(categories.length), hint: `近7天新增 ${formatCount(categories7d)}` },
          { title: "商品总数", value: formatCount(dishes.length), hint: `近7天变动 ${formatCount(dishes7d)}` },
          {
            title: "推荐商品",
            value: formatCount(recommendedDishes),
            hint: `售罄 ${formatCount(soldOutDishes)} / 隐藏 ${formatCount(hiddenDishes)}`,
          },
          { title: "折扣商品", value: formatCount(discountedDishes), hint: "discount_price < price" },
          {
            title: "商品图片数",
            value: formatCount(dishImages.length),
            hint: `平均每商品 ${(dishes.length > 0 ? dishImages.length / dishes.length : 0).toFixed(1)} 张`,
          },
          {
            title: "公告总数",
            value: formatCount(announcements.length),
            hint: `已发布 ${formatCount(publishedAnnouncements)} / 草稿 ${formatCount(draftAnnouncements)}`,
          },
          {
            title: "公告总浏览",
            value: formatCount(announcements.reduce((sum, row) => sum + (row.view_count || 0), 0)),
            hint: "announcements.view_count",
          },
          { title: "线索总数", value: formatCount(leads.length), hint: `近7天 ${formatCount(leads7d)}` },
          { title: "聊天会话总数", value: formatCount(chatConversations.length), hint: `近7天 ${formatCount(conversations7d)}` },
        ],
        tables: [
          {
            title: "模块 / UI 包排行",
            headers: ["分类", "名称", "使用次数", "占比"],
            rows: [
              ...(frontendSnapshot.topModules || []).map((row) => [
                "逻辑模块",
                row.name,
                formatCount(row.count),
                totalBuilds > 0 ? formatPercent((row.count / totalBuilds) * 100) : "0%",
              ]),
              ...(frontendSnapshot.topUiPacks || []).map((row) => [
                "UI 包",
                row.name,
                formatCount(row.count),
                totalBuilds > 0 ? formatPercent((row.count / totalBuilds) * 100) : "0%",
              ]),
            ],
          },
          {
            title: "商户内容规模榜",
            description: "按商品 / 公告 / 聊天 / 线索综合看。",
            headers: ["Store ID", "分类", "商品", "图片", "公告", "线索", "会话", "消息"],
            rows: storesSortedByFreshness.map((store) => [
              store.store_id,
              formatCount(categoriesByStore.get(store.store_id) || 0),
              formatCount(dishesByStore.get(store.store_id) || 0),
              formatCount(imagesByStore.get(store.store_id) || 0),
              formatCount(announcementsByStore.get(store.store_id) || 0),
              formatCount(leadsByStore.get(store.store_id) || 0),
              formatCount(conversationsByStore.get(store.store_id) || 0),
              formatCount(messagesByStore.get(store.store_id) || 0),
            ]),
          },
        ],
      },

      alerts: {
        metrics: [
          { title: "构建失败告警", value: formatCount(buildFailuresToday), hint: "今日失败" },
          { title: "排队超时", value: formatCount(stalledQueuedBuilds), hint: ">30 分钟仍 queued" },
          { title: "成功但缺下载", value: formatCount(missingDownloadOnSuccess), hint: "需排查回写" },
          { title: "登录回调失败", value: formatCount(authCallbackFailedCount), hint: "auth_callback_failed" },
          { title: "下载失败日志", value: formatCount(downloadFailedCount), hint: "download_failed" },
          { title: "云端状态异常", value: formatCount(cloudStateAnomalies), hint: "read_only 但仍可写" },
          { title: "即将删库", value: formatCount(deletingSoonStores.length), hint: "未来 7 天 delete_at" },
          { title: "未读消息", value: formatCount(unreadMessages), hint: "chat_messages.is_read=false" },
        ],
        tables: [
          {
            title: "异常告警列表",
            description: "全站异常告警。",
            headers: ["异常类型", "对象", "级别", "发生时间", "状态"],
            rows: [
              ...(frontendSnapshot.recentBuilds || [])
                .filter((build) => build.status === "failed")
                .slice(0, 8)
                .map((build) => [
                  "构建失败",
                  build.run_id,
                  "高",
                  formatDateTime(build.updated_at),
                  "待处理",
                ]),
              ...(frontendSnapshot.recentOperationLogs || [])
                .filter((row) => ["auth_callback_failed", "download_failed"].includes(row.event_name))
                .slice(0, 6)
                .map((row) => [
                  row.event_name === "auth_callback_failed" ? "登录回调失败" : "下载失败",
                  row.run_id || row.user_id || "-",
                  "高",
                  formatDateTime(row.occurred_at),
                  "待处理",
                ]),
              ...stores
                .filter((store) => store.service_status === "read_only" && store.is_write_allowed === true)
                .slice(0, 6)
                .map((store) => [
                  "云端状态异常",
                  store.store_id,
                  "高",
                  formatDateTime(store.service_end_at || store.created_at),
                  "待处理",
                ]),
              ...deletingSoonStores.slice(0, 6).map((store) => [
                "即将删库",
                store.store_id,
                "中",
                formatDateTime(store.delete_at),
                "待处理",
              ]),
            ],
          },
        ],
      },

      actions: {
        metrics: [
          {
            title: "后台操作总数",
            value: formatCount((frontendSnapshot.adminActions || []).length),
            hint: "admin_action_logs",
          },
        ],
        tables: [
          {
            title: "后台操作日志",
            description: "后台动作日志。",
            headers: ["时间", "操作者", "动作", "目标类型", "目标ID"],
            rows: (frontendSnapshot.adminActions || []).slice(0, 20).map((row) => [
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
          { title: "登录成功", value: formatCount(loginSuccessCount), hint: "login_success" },
          { title: "打开 Builder", value: formatCount(builderOpenedCount), hint: "builder_opened" },
          { title: "上传图标", value: formatCount(iconUploadedCount), hint: "icon_uploaded" },
          { title: "点击 Generate", value: formatCount(buildStartedCount), hint: "build_started" },
          { title: "打开 Result", value: formatCount(resultOpenedCount), hint: "result_opened" },
          { title: "点击 Download", value: formatCount(downloadClickedCount), hint: "download_clicked" },
          {
            title: "构建轮询次数",
            value: formatCount(buildStatusPolledCount),
            hint: `平均每构建 ${pollPerBuild.toFixed(1)} 次`,
          },
        ],
        tables: [
          {
            title: "当前可接漏斗",
            description: "全站转化漏斗。",
            headers: ["阶段", "次数", "相对上一阶段转化"],
            rows: [
              ["登录成功", formatCount(loginSuccessCount), "100%"],
              [
                "打开 Builder",
                formatCount(builderOpenedCount),
                loginSuccessCount > 0 ? formatPercent((builderOpenedCount / loginSuccessCount) * 100) : "0%",
              ],
              [
                "上传图标",
                formatCount(iconUploadedCount),
                builderOpenedCount > 0 ? formatPercent((iconUploadedCount / builderOpenedCount) * 100) : "0%",
              ],
              [
                "点击 Generate",
                formatCount(buildStartedCount),
                iconUploadedCount > 0 ? formatPercent((buildStartedCount / iconUploadedCount) * 100) : "0%",
              ],
              [
                "打开 Result",
                formatCount(resultOpenedCount),
                buildStartedCount > 0 ? formatPercent((resultOpenedCount / buildStartedCount) * 100) : "0%",
              ],
              [
                "点击 Download",
                formatCount(downloadClickedCount),
                resultOpenedCount > 0 ? formatPercent((downloadClickedCount / resultOpenedCount) * 100) : "0%",
              ],
            ],
          },
        ],
      },

      channels: {
        metrics: [
          {
            title: "渠道会话数",
            value: formatCount(
              (frontendSnapshot.channels || []).reduce((sum, row) => sum + (row.sessions || 0), 0),
            ),
            hint: "user_acquisition_logs",
          },
          {
            title: "最佳渠道",
            value: frontendSnapshot.bestChannel || "-",
            hint: "按会话数排序",
          },
        ],
        tables: [
          {
            title: "渠道来源分布",
            description: "按 user_acquisition_logs 聚合。",
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
          {
            title: "D1 留存",
            value: formatPercent(frontendSnapshot.d1Retention || 0),
            hint: "基于操作日志 cohort 推算",
          },
          {
            title: "D7 留存",
            value: formatPercent(frontendSnapshot.d7Retention || 0),
            hint: "基于操作日志 cohort 推算",
          },
          {
            title: "D30 留存",
            value: formatPercent(frontendSnapshot.d30Retention || 0),
            hint: "基于操作日志 cohort 推算",
          },
        ],
        notes: ["留存继续走 user_operation_logs 口径；订单 / 续费统计按你的要求先不接。"],
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
