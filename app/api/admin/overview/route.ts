import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type FrontendProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  last_login_at: string | null;
  created_at: string;
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

type UserOperationLogRow = {
  user_id: string;
  run_id: string | null;
  event_name: string;
  page_path: string | null;
  occurred_at: string;
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
  updated_at?: string | null;
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

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getBuildDurationMinutes(build: FrontendBuildRow): number | null {
  if (!build.completed_at) return null;
  const createdAt = new Date(build.created_at).getTime();
  const completedAt = new Date(build.completed_at).getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(completedAt) || completedAt < createdAt) {
    return null;
  }
  return (completedAt - createdAt) / 60000;
}

function getUserLabel(profile: FrontendProfileRow | undefined): string {
  if (!profile) return "-";
  return profile.email || profile.display_name || profile.id;
}

function startOfTodayIso() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return start.toISOString();
}

function isWithinDays(value: string | null | undefined, days: number, from = new Date()): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  const start = from.getTime();
  const end = start + days * 24 * 60 * 60 * 1000;
  return time >= start && time <= end;
}

function isPast(value: string | null | undefined, from = new Date()): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return time < from.getTime();
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
     * 前端网站库：
     * 不再使用 SUPABASE_SERVICE_ROLE_KEY。
     * 直接复用 createServerSupabase() 的当前登录用户会话。
     * 这样完全适配你现在已有的：
     * - NEXT_PUBLIC_SUPABASE_URL
     * - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
     */
    const [profilesResult, buildsResult, logsResult] = await Promise.all([
      authClient
        .from("profiles")
        .select("id, email, display_name, last_login_at, created_at")
        .eq("id", user.id)
        .limit(1),
      authClient
        .from("builds")
        .select(
          "id, user_id, run_id, app_name, module_name, ui_pack_name, plan, store_id, status, stage, message, workflow_run_id, workflow_url, artifact_url, download_url, error, failed_step, completed_at, created_at, updated_at",
        )
        .order("created_at", { ascending: false }),
      authClient
        .from("user_operation_logs")
        .select("user_id, run_id, event_name, page_path, occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(5000),
    ]);

    if (profilesResult.error) {
      throw new Error(`profiles query failed: ${profilesResult.error.message}`);
    }
    if (buildsResult.error) {
      throw new Error(`builds query failed: ${buildsResult.error.message}`);
    }
    if (logsResult.error) {
      throw new Error(`user_operation_logs query failed: ${logsResult.error.message}`);
    }

    const profiles = (profilesResult.data || []) as FrontendProfileRow[];
    const builds = (buildsResult.data || []) as FrontendBuildRow[];
    const logs = (logsResult.data || []) as UserOperationLogRow[];

    /**
     * App 云端库：
     * 继续用你已有变量名
     * - APP_CLOUD_SUPABASE_URL
     * - APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY
     */
    let stores: AppCloudStoreRow[] = [];
    const appCloudUrl = process.env.APP_CLOUD_SUPABASE_URL?.trim() || "";
    const appCloudServiceRole = process.env.APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

    if (appCloudUrl && appCloudServiceRole) {
      const appCloudAdmin = createSupabaseClient(appCloudUrl, appCloudServiceRole, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      const storesResult = await appCloudAdmin
        .from("stores")
        .select(
          "store_id, module_type, plan_type, service_status, is_write_allowed, service_start_at, service_end_at, delete_at, created_at, updated_at",
        )
        .order("service_end_at", { ascending: true });

      if (storesResult.error) {
        console.error("NDJC admin overview stores error", storesResult.error);
      } else {
        stores = (storesResult.data || []) as AppCloudStoreRow[];
      }
    }

    const now = new Date();
    const todayIso = startOfTodayIso();
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const buildsByStoreId = new Map<string, FrontendBuildRow>();

    for (const build of builds) {
      if (!build.store_id) continue;
      if (!buildsByStoreId.has(build.store_id)) {
        buildsByStoreId.set(build.store_id, build);
      }
    }

    const totalUsers = profiles.length;
    const totalBuilds = builds.length;
    const successBuilds = builds.filter((build) => build.status === "success").length;
    const failedBuilds = builds.filter((build) => build.status === "failed").length;
    const queuedBuilds = builds.filter((build) => build.status === "queued").length;
    const runningBuilds = builds.filter((build) => build.status === "running").length;
    const successRate = totalBuilds > 0 ? (successBuilds / totalBuilds) * 100 : 0;

    const completedDurations = builds
      .map((build) => getBuildDurationMinutes(build))
      .filter((value): value is number => value != null);

    const avgBuildMinutes = average(completedDurations);

    const paidBuilds = builds.filter((build) => build.plan !== "free");
    const paidUsers = new Set(paidBuilds.map((build) => build.user_id)).size;

    const buildsByUser = new Map<string, number>();
    for (const build of paidBuilds) {
      buildsByUser.set(build.user_id, (buildsByUser.get(build.user_id) || 0) + 1);
    }
    const repeatUsers = Array.from(buildsByUser.values()).filter((count) => count > 1).length;

    const activeUsers7d = new Set(
      logs
        .filter((log) => {
          const occurredAt = new Date(log.occurred_at).getTime();
          return Number.isFinite(occurredAt) && occurredAt >= now.getTime() - 7 * 24 * 60 * 60 * 1000;
        })
        .map((log) => log.user_id),
    ).size;

    const effectiveStores = stores.filter((store) => store.service_status !== "deleted").length;
    const trialStores = stores.filter((store) => store.plan_type === "trial").length;
    const paidStores = stores.filter((store) => store.plan_type === "paid").length;
    const readOnlyStores = stores.filter((store) => store.service_status === "read_only").length;
    const deletedStores = stores.filter((store) => store.service_status === "deleted").length;
    const expiredStores = stores.filter((store) => isPast(store.service_end_at, now) && store.service_status !== "deleted").length;
    const expiring7dStores = stores.filter((store) => isWithinDays(store.service_end_at, 7, now) && store.service_status !== "deleted");
    const expiring30dStores = stores.filter((store) => isWithinDays(store.service_end_at, 30, now) && store.service_status !== "deleted");

    const buildFailuresToday = builds.filter(
      (build) => build.status === "failed" && build.updated_at >= todayIso,
    ).length;
    const stalledQueuedBuilds = builds.filter((build) => {
      if (build.status !== "queued") return false;
      const createdAt = new Date(build.created_at).getTime();
      return Number.isFinite(createdAt) && createdAt <= now.getTime() - 30 * 60 * 1000;
    }).length;
    const missingDownloadOnSuccess = builds.filter(
      (build) => build.status === "success" && !build.download_url,
    ).length;
    const cloudStateAnomalies = stores.filter(
      (store) => store.service_status === "read_only" && store.is_write_allowed === true,
    ).length;

    const builderOpenedCount = logs.filter((log) => log.event_name === "builder_opened").length;
    const iconUploadedCount = logs.filter((log) => log.event_name === "icon_uploaded").length;
    const buildStartedCount = logs.filter((log) => log.event_name === "build_started").length;
    const historyOpenedCount = logs.filter((log) => log.event_name === "history_opened").length;
    const resultOpenedCount = logs.filter((log) => log.event_name === "result_opened").length;
    const downloadClickedCount = logs.filter((log) => log.event_name === "download_clicked").length;

    const moduleCountMap = new Map<string, number>();
    const uiPackCountMap = new Map<string, number>();
    for (const build of builds) {
      moduleCountMap.set(build.module_name, (moduleCountMap.get(build.module_name) || 0) + 1);
      uiPackCountMap.set(build.ui_pack_name, (uiPackCountMap.get(build.ui_pack_name) || 0) + 1);
    }

    const topModules = Array.from(moduleCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const topUiPacks = Array.from(uiPackCountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

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
          { title: "总用户数", value: formatCount(totalUsers), hint: "当前登录用户上下文" },
          { title: "总构建次数", value: formatCount(totalBuilds), hint: "builds" },
          { title: "成功构建数", value: formatCount(successBuilds), hint: `失败 ${formatCount(failedBuilds)}` },
          { title: "成功率", value: formatPercent(successRate), hint: "基于 builds.status" },
          { title: "当前有效云端商户数", value: formatCount(effectiveStores), hint: "stores" },
          { title: "试用商户数", value: formatCount(trialStores), hint: "stores.plan_type=trial" },
          { title: "付费商户数", value: formatCount(paidStores), hint: "stores.plan_type=paid" },
          { title: "未来 7 天到期", value: formatCount(expiring7dStores.length), hint: "stores.service_end_at" },
          { title: "当前排队", value: formatCount(queuedBuilds), hint: `运行中 ${formatCount(runningBuilds)}` },
          { title: "平均构建时长", value: formatDurationMinutes(avgBuildMinutes), hint: "completed_at - created_at" },
        ],
        notes: [
          "前端网站数据当前按登录用户会话读取，不再依赖前端库 service role。",
          "App 云端 stores 继续走 APP_CLOUD_SUPABASE_URL + APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY。",
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
            description: "已接 builds 表。排队耗时目前库里没有独立字段，先显示为 -。",
            headers: ["Run", "状态", "创建时间", "完成时间", "构建耗时", "模块", "计划"],
            rows: builds.slice(0, 12).map((build) => [
              build.run_id,
              build.status,
              formatDateTime(build.created_at),
              formatDateTime(build.completed_at),
              formatDurationMinutes(getBuildDurationMinutes(build)),
              build.module_name,
              build.plan,
            ]),
          },
        ],
      },
      users: {
        metrics: [
          { title: "注册用户", value: formatCount(totalUsers), hint: "当前登录用户上下文" },
          { title: "7天活跃用户", value: formatCount(activeUsers7d), hint: "user_operation_logs" },
          { title: "付费用户", value: formatCount(paidUsers), hint: "按 builds.plan!=free 推算" },
          { title: "复购用户", value: formatCount(repeatUsers), hint: "多次非 free 构建" },
        ],
        tables: [
          {
            title: "最近用户行为",
            description: "已接 profiles + builds + user_operation_logs。",
            headers: ["用户", "最近登录", "构建次数", "最近动作", "动作时间"],
            rows: profiles.slice(0, 12).map((profile) => {
              const userBuildCount = builds.filter((build) => build.user_id === profile.id).length;
              const latestLog = logs.find((log) => log.user_id === profile.id);
              return [
                getUserLabel(profile),
                formatDateTime(profile.last_login_at),
                formatCount(userBuildCount),
                latestLog?.event_name || "-",
                formatDateTime(latestLog?.occurred_at),
              ];
            }),
          },
        ],
        notes: ["当前这部分是按登录用户自身数据读取，不是全站超管口径。"],
      },
      revenue: {
        metrics: [],
        notes: [
          "当前项目里没有 payment_orders / cloud_renew_orders 正式表。",
          "这个 Tab 暂时不接，等支付链路落表后再接。",
        ],
      },
      stores: {
        metrics: [
          { title: "Store 总数", value: formatCount(stores.length), hint: "stores" },
          { title: "活跃 Store", value: formatCount(effectiveStores), hint: "service_status!=deleted" },
          { title: "只读 Store", value: formatCount(readOnlyStores), hint: "service_status=read_only" },
          { title: "已删除 Store", value: formatCount(deletedStores), hint: "service_status=deleted" },
        ],
        tables: [
          {
            title: "商户 / Store 列表",
            description: "已接 app cloud stores，并用 builds + profiles 补充 App 名称和所属用户。",
            headers: ["Store ID", "App 名称", "所属用户", "云端状态", "到期时间", "是否可写", "计划"],
            rows: stores.slice(0, 20).map((store) => {
              const build = buildsByStoreId.get(store.store_id);
              const profile = build ? profilesById.get(build.user_id) : undefined;
              return [
                store.store_id,
                build?.app_name || "-",
                getUserLabel(profile),
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
              builds.filter((build) => build.status === "success" && build.plan !== "free" && build.store_id).length,
            ),
            hint: "成功 + 非 free + 有 store_id",
          },
        ],
        tables: [
          {
            title: "历史记录管理",
            description: "已接 builds，并尽可能补上 cloud 状态。",
            headers: ["App 名称", "状态", "创建时间", "完成时间", "下载", "模块", "UI 包", "计划", "Store ID"],
            rows: builds.slice(0, 20).map((build) => [
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
        ],
        tables: [
          {
            title: "未来 7 天到期列表",
            description: "当前项目里能稳定接的是到期时间和基础状态；最后写入时间暂时没有正式统计表。",
            headers: ["Store ID", "App", "状态", "到期", "用户", "最后写入", "备注"],
            rows: expiring7dStores.slice(0, 20).map((store) => {
              const build = buildsByStoreId.get(store.store_id);
              const profile = build ? profilesById.get(build.user_id) : undefined;
              const diffMs = new Date(store.service_end_at || now.toISOString()).getTime() - now.getTime();
              return [
                store.store_id,
                build?.app_name || "-",
                store.service_status,
                formatDateOnly(store.service_end_at),
                getUserLabel(profile),
                "-",
                formatRelativeDays(diffMs),
              ];
            }),
          },
          {
            title: "未来 30 天到期列表",
            description: "已接 stores.service_end_at。高级活跃度指标当前项目无正式汇总表。",
            headers: ["Store ID", "状态", "到期", "是否可写", "计划", "App"],
            rows: expiring30dStores.slice(0, 20).map((store) => {
              const build = buildsByStoreId.get(store.store_id);
              return [
                store.store_id,
                store.service_status,
                formatDateOnly(store.service_end_at),
                store.is_write_allowed ? "是" : "否",
                store.plan_type || "-",
                build?.app_name || "-",
              ];
            }),
          },
        ],
        notes: ["last_input_at / writes_24h / storage_bytes 这类数据当前项目没有正式 store_usage_stats 表，先不接。"],
      },
      content: {
        metrics: [
          { title: "逻辑模块使用次数", value: formatCount(totalBuilds), hint: "builds.module_name 聚合" },
          { title: "UI 包使用次数", value: formatCount(totalBuilds), hint: "builds.ui_pack_name 聚合" },
          { title: "最热门模块", value: topModules[0]?.[0] || "-", hint: topModules[0] ? formatCount(topModules[0][1]) : "-" },
          { title: "最热门 UI 包", value: topUiPacks[0]?.[0] || "-", hint: topUiPacks[0] ? formatCount(topUiPacks[0][1]) : "-" },
        ],
        tables: [
          {
            title: "模块排行",
            headers: ["分类", "名称", "使用次数", "占比"],
            rows: [
              ...topModules.map(([name, count]) => [
                "逻辑模块",
                name,
                formatCount(count),
                totalBuilds > 0 ? formatPercent((count / totalBuilds) * 100) : "0%",
              ]),
              ...topUiPacks.map(([name, count]) => [
                "UI 包",
                name,
                formatCount(count),
                totalBuilds > 0 ? formatPercent((count / totalBuilds) * 100) : "0%",
              ]),
            ],
          },
        ],
        notes: ["行业模板当前项目没有正式字段，先不接行业统计。"],
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
            description: "当前基于现有表推导，未接独立 alerts 表。",
            headers: ["异常类型", "对象", "级别", "发生时间", "状态"],
            rows: [
              ...builds
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
                .slice(0, 4)
                .map((store) => [
                  "云端状态异常",
                  store.store_id,
                  "高",
                  formatDateTime(store.updated_at || store.service_end_at),
                  "待处理",
                ]),
            ],
          },
        ],
      },
      actions: {
        metrics: [],
        notes: [
          "这个 Tab 是后台动作入口，不是数据统计。",
          "当前项目里还没有独立的 admin_action_logs 表。",
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
            description: "只接项目里已经正式写入 user_operation_logs 的事件。",
            headers: ["阶段", "次数", "相对上一阶段转化"],
            rows: [
              ["打开 Builder", formatCount(builderOpenedCount), "100%"],
              ["上传图标", formatCount(iconUploadedCount), builderOpenedCount > 0 ? formatPercent((iconUploadedCount / builderOpenedCount) * 100) : "0%"],
              ["点击 Generate", formatCount(buildStartedCount), iconUploadedCount > 0 ? formatPercent((buildStartedCount / iconUploadedCount) * 100) : "0%"],
              ["打开 Result", formatCount(resultOpenedCount), buildStartedCount > 0 ? formatPercent((resultOpenedCount / buildStartedCount) * 100) : "0%"],
              ["点击 Download", formatCount(downloadClickedCount), resultOpenedCount > 0 ? formatPercent((downloadClickedCount / resultOpenedCount) * 100) : "0%"],
            ],
          },
        ],
        notes: ["支付页、续费页漏斗当前没有正式订单表，不接。"],
      },
      channels: {
        metrics: [],
        notes: [
          "当前项目没有 utm / referrer / acquisition 表。",
          "这个 Tab 暂时不接。",
        ],
      },
      retention: {
        metrics: [],
        notes: [
          "当前项目没有按 cohort 落表的留存统计。",
          "如果要做留存，后续应基于 user_operation_logs 另做 cohort 计算。",
        ],
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
