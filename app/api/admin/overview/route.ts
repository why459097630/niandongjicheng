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

    /**
     * 前端用户数据云端：
     * 只使用现有变量：
     * - NEXT_PUBLIC_SUPABASE_URL
     * - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
     *
     * 全局后台数据通过 security definer RPC 返回，
     * 不直接查 profiles/builds/user_operation_logs 全表。
     */
    const { data: frontendSnapshotRaw, error: frontendSnapshotError } = await authClient.rpc(
      "admin_frontend_overview",
    );

    if (frontendSnapshotError) {
      throw new Error(`admin_frontend_overview rpc failed: ${frontendSnapshotError.message}`);
    }

    const frontendSnapshot = (frontendSnapshotRaw || {}) as FrontendSnapshot;

    /**
     * App 内云端：
     * 使用现有变量：
     * - APP_CLOUD_SUPABASE_URL
     * - APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY
     */
    let stores: AppCloudStoreRow[] = [];
    let storeUsageStats: StoreUsageStatsRow[] = [];

    const appCloudUrl = process.env.APP_CLOUD_SUPABASE_URL?.trim() || "";
    const appCloudServiceRole = process.env.APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

    if (appCloudUrl && appCloudServiceRole) {
      console.log("NDJC admin overview app cloud env", {
        appCloudUrl,
        appCloudUrlHost: (() => {
          try {
            return new URL(appCloudUrl).host;
          } catch {
            return appCloudUrl;
          }
        })(),
        appCloudServiceRoleLength: appCloudServiceRole.length,
      });

      const appCloudAdmin = createSupabaseClient(appCloudUrl, appCloudServiceRole, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      const refreshResult = await appCloudAdmin.rpc("refresh_store_usage_stats");

      if (refreshResult.error) {
        console.error("NDJC admin overview refresh_store_usage_stats error", refreshResult.error);
        throw new Error(`refresh_store_usage_stats failed: ${refreshResult.error.message}`);
      }

      const [storesResult, usageResult] = await Promise.all([
        appCloudAdmin
          .from("stores")
          .select(
            "store_id, module_type, plan_type, service_status, is_write_allowed, service_start_at, service_end_at, delete_at, created_at",
          )
          .order("service_end_at", { ascending: true }),
        appCloudAdmin
          .from("store_usage_stats")
          .select(
            "store_id, last_input_at, writes_24h, writes_7d, items_count, announcements_count, messages_7d, leads_7d, updated_at",
          )
          .order("updated_at", { ascending: false }),
      ]);

      if (storesResult.error) {
        console.error("NDJC admin overview stores error", storesResult.error);
        throw new Error(`stores query failed: ${storesResult.error.message}`);
      } else {
        stores = (storesResult.data || []) as AppCloudStoreRow[];
      }

      if (usageResult.error) {
        console.error("NDJC admin overview store_usage_stats error", usageResult.error);
        throw new Error(`store_usage_stats query failed: ${usageResult.error.message}`);
      } else {
        storeUsageStats = (usageResult.data || []) as StoreUsageStatsRow[];
      }

      console.log("NDJC admin overview app cloud result", {
        storesCount: stores.length,
        usageCount: storeUsageStats.length,
      });
    }

    const now = new Date();
    const buildsByStoreId = new Map<string, FrontendBuildRow>();
    const profilesById = new Map<string, FrontendProfileRow>(
      (frontendSnapshot.recentUsers || []).map((profile) => [profile.id, profile]),
    );
    const storeUsageMap = new Map<string, StoreUsageStatsRow>(
      storeUsageStats.map((row) => [row.store_id, row]),
    );

    for (const build of frontendSnapshot.recentBuilds || []) {
      if (!build.store_id) continue;
      if (!buildsByStoreId.has(build.store_id)) {
        buildsByStoreId.set(build.store_id, build);
      }
    }

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

    const effectiveStores = stores.filter((store) => store.service_status !== "deleted").length;
    const trialStores = stores.filter((store) => store.plan_type === "trial").length;
    const paidStores = stores.filter((store) => store.plan_type === "paid").length;
    const readOnlyStores = stores.filter((store) => store.service_status === "read_only").length;
    const deletedStores = stores.filter((store) => store.service_status === "deleted").length;
    const expiredStores = stores.filter(
      (store) =>
        !!store.service_end_at &&
        new Date(store.service_end_at).getTime() < now.getTime() &&
        store.service_status !== "deleted",
    ).length;
    const expiring7dStores = stores.filter(
      (store) =>
        !!store.service_end_at &&
        new Date(store.service_end_at).getTime() >= now.getTime() &&
        new Date(store.service_end_at).getTime() <= now.getTime() + 7 * 24 * 60 * 60 * 1000 &&
        store.service_status !== "deleted",
    );
    const expiring30dStores = stores.filter(
      (store) =>
        !!store.service_end_at &&
        new Date(store.service_end_at).getTime() >= now.getTime() &&
        new Date(store.service_end_at).getTime() <= now.getTime() + 30 * 24 * 60 * 60 * 1000 &&
        store.service_status !== "deleted",
    );
    const cloudStateAnomalies = stores.filter(
      (store) => store.service_status === "read_only" && store.is_write_allowed === true,
    ).length;

    const builderOpenedCount = frontendSnapshot.builderOpenedCount || 0;
    const iconUploadedCount = frontendSnapshot.iconUploadedCount || 0;
    const buildStartedCount = frontendSnapshot.buildStartedCount || 0;
    const historyOpenedCount = frontendSnapshot.historyOpenedCount || 0;
    const resultOpenedCount = frontendSnapshot.resultOpenedCount || 0;
    const downloadClickedCount = frontendSnapshot.downloadClickedCount || 0;

    const successRate = totalBuilds > 0 ? (successBuilds / totalBuilds) * 100 : 0;

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
        hint: stores.length > 0 ? "已接 stores 表" : "未配置 App 云端库",
      },
      {
        title: "今日构建失败",
        value: formatCount(buildFailuresToday),
        hint: `缺下载 ${formatCount(missingDownloadOnSuccess)}`,
      },
    ];

    const tabs: Record<string, TabData> = {
      dashboard: {
        metrics: [
          { title: "总用户数", value: formatCount(totalUsers), hint: "前端用户云端全局" },
          { title: "总构建次数", value: formatCount(totalBuilds), hint: "builds 全局" },
          { title: "成功构建数", value: formatCount(successBuilds), hint: `失败 ${formatCount(failedBuilds)}` },
          { title: "成功率", value: formatPercent(successRate), hint: "builds.status 全局" },
          { title: "当前有效云端商户数", value: formatCount(effectiveStores), hint: "stores 全局" },
          { title: "试用商户数", value: formatCount(trialStores), hint: "stores.plan_type=trial" },
          { title: "付费商户数", value: formatCount(paidStores), hint: "stores.plan_type=paid" },
          { title: "未来 7 天到期", value: formatCount(expiring7dStores.length), hint: "stores.service_end_at" },
          { title: "当前排队", value: formatCount(queuedBuilds), hint: `运行中 ${formatCount(runningBuilds)}` },
          { title: "平均构建时长", value: formatDurationMinutes(avgBuildMinutes), hint: "completed_at - created_at" },
        ],
        notes: [
          "除付费收入外，这一页已切到后台全局口径。",
        ],
      },
      builds: {
        metrics: [
          { title: "构建总数", value: formatCount(totalBuilds) },
          { title: "成功构建", value: formatCount(successBuilds) },
          { title: "失败构建", value: formatCount(failedBuilds) },
          { title: "平均构建时长", value: formatDurationMinutes(avgBuildMinutes) },
          { title: "排队中", value: formatCount(queuedBuilds) },
          { title: "构建中", value: formatCount(runningBuilds) },
          { title: "今日失败", value: formatCount(buildFailuresToday) },
          { title: "缺下载链接", value: formatCount(missingDownloadOnSuccess) },
        ],
        tables: [
          {
            title: "最近构建记录",
            description: "全站构建记录。",
            headers: ["Run", "状态", "创建时间", "完成时间", "构建耗时", "模块", "计划"],
            rows: (frontendSnapshot.recentBuilds || []).slice(0, 20).map((build) => [
              build.run_id,
              build.status,
              formatDateTime(build.created_at),
              formatDateTime(build.completed_at),
              formatDurationMinutes(
                build.completed_at
                  ? (new Date(build.completed_at).getTime() - new Date(build.created_at).getTime()) / 60000
                  : null,
              ),
              build.module_name,
              build.plan,
            ]),
          },
        ],
      },
      users: {
        metrics: [
          { title: "注册用户", value: formatCount(totalUsers), hint: "profiles 全局" },
          { title: "7天活跃用户", value: formatCount(activeUsers7d), hint: "user_operation_logs 全局" },
          { title: "付费用户", value: formatCount(paidUsers), hint: "按 builds.plan!=free 推算" },
          { title: "复购用户", value: formatCount(repeatUsers), hint: "多次非 free 构建" },
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
        ],
      },
      revenue: {
        metrics: [],
        notes: ["按你的要求，这里不接付费收入相关数据。"],
      },
      stores: {
        metrics: [
          { title: "Store 总数", value: formatCount(stores.length), hint: "stores 全局" },
          { title: "活跃 Store", value: formatCount(effectiveStores), hint: "service_status!=deleted" },
          { title: "只读 Store", value: formatCount(readOnlyStores), hint: "service_status=read_only" },
          { title: "已删除 Store", value: formatCount(deletedStores), hint: "service_status=deleted" },
        ],
        tables: [
          {
            title: "商户 / Store 列表",
            description: "全站商户列表。",
            headers: ["Store ID", "App 名称", "所属用户", "云端状态", "到期时间", "是否可写", "计划"],
            rows: stores.slice(0, 20).map((store) => {
              const build = buildsByStoreId.get(store.store_id);
              const profile = build ? profilesById.get(build.user_id) : undefined;
              return [
                store.store_id,
                build?.app_name || "-",
                profile ? getUserLabel(profile) : "-",
                store.service_status,
                formatDateOnly(store.service_end_at),
                store.is_write_allowed ? "是" : "否",
                store.plan_type || "-",
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
            title: "可续费候选",
            value: formatCount(
              (frontendSnapshot.recentBuilds || []).filter(
                (build) => build.status === "success" && build.plan !== "free" && build.store_id,
              ).length,
            ),
            hint: "成功 + 非 free + 有 store_id（当前列表样本）",
          },
        ],
        tables: [
          {
            title: "历史记录管理",
            description: "全站构建历史记录。",
            headers: ["App 名称", "状态", "创建时间", "完成时间", "下载", "模块", "UI 包", "计划", "Store ID"],
            rows: (frontendSnapshot.recentBuilds || []).slice(0, 20).map((build) => [
              build.app_name,
              build.status,
              formatDateTime(build.created_at),
              formatDateTime(build.completed_at),
              build.download_url ? "已生成" : "-",
              build.module_name,
              build.ui_pack_name,
              build.plan,
              build.store_id || "-",
            ]),
          },
        ],
      },
      cloud: {
        metrics: [
          { title: "即将到期商户数", value: formatCount(expiring7dStores.length), hint: "未来 7 天" },
          { title: "已过期商户数", value: formatCount(expiredStores), hint: "service_end_at < now" },
          { title: "只读商户数", value: formatCount(readOnlyStores), hint: "service_status=read_only" },
          { title: "已删库商户数", value: formatCount(deletedStores), hint: "service_status=deleted" },
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
        ],
        tables: [
          {
            title: "未来 7 天到期列表",
            description: "全站到期监控。",
            headers: ["Store ID", "App", "状态", "到期", "用户", "最后写入", "备注"],
            rows: expiring7dStores.slice(0, 20).map((store) => {
              const build = buildsByStoreId.get(store.store_id);
              const profile = build ? profilesById.get(build.user_id) : undefined;
              const usage = storeUsageMap.get(store.store_id);
              const diffMs = new Date(store.service_end_at || now.toISOString()).getTime() - now.getTime();
              return [
                store.store_id,
                build?.app_name || "-",
                store.service_status,
                formatDateOnly(store.service_end_at),
                profile ? getUserLabel(profile) : "-",
                formatDateTime(usage?.last_input_at),
                formatRelativeDays(diffMs),
              ];
            }),
          },
          {
            title: "云端活跃概览",
            description: "从 store_usage_stats 读取。",
            headers: ["Store ID", "最后输入", "24h写入", "7d写入", "商品数", "公告数", "7d消息", "7d线索"],
            rows: storeUsageStats.slice(0, 20).map((row) => [
              row.store_id,
              formatDateTime(row.last_input_at),
              formatCount(row.writes_24h || 0),
              formatCount(row.writes_7d || 0),
              formatCount(row.items_count || 0),
              formatCount(row.announcements_count || 0),
              formatCount(row.messages_7d || 0),
              formatCount(row.leads_7d || 0),
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
            title: "UI 包使用次数",
            value: formatCount(totalBuilds),
            hint: "builds.ui_pack_name 聚合",
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
        ],
        tables: [
          {
            title: "模块排行",
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
        ],
      },
      alerts: {
        metrics: [
          { title: "构建失败告警", value: formatCount(buildFailuresToday), hint: "今日失败" },
          { title: "排队超时", value: formatCount(stalledQueuedBuilds), hint: ">30 分钟仍 queued" },
          { title: "成功但缺下载", value: formatCount(missingDownloadOnSuccess), hint: "需排查回写" },
          { title: "云端状态异常", value: formatCount(cloudStateAnomalies), hint: "read_only 但仍可写" },
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
              ...stores
                .filter((store) => store.service_status === "read_only" && store.is_write_allowed === true)
                .slice(0, 8)
                .map((store) => [
                  "云端状态异常",
                  store.store_id,
                  "高",
                  formatDateTime(store.service_end_at || store.created_at),
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
          { title: "打开 Builder", value: formatCount(builderOpenedCount), hint: "builder_opened" },
          { title: "上传图标", value: formatCount(iconUploadedCount), hint: "icon_uploaded" },
          { title: "点击 Generate", value: formatCount(buildStartedCount), hint: "build_started" },
          { title: "打开 History", value: formatCount(historyOpenedCount), hint: "history_opened" },
          { title: "打开 Result", value: formatCount(resultOpenedCount), hint: "result_opened" },
          { title: "点击 Download", value: formatCount(downloadClickedCount), hint: "download_clicked" },
        ],
        tables: [
          {
            title: "当前可接漏斗",
            description: "全站转化漏斗。",
            headers: ["阶段", "次数", "相对上一阶段转化"],
            rows: [
              ["打开 Builder", formatCount(builderOpenedCount), "100%"],
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
        notes: ["当前留存使用 user_operation_logs 现算，不接付费表。"],
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
