"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminChatPanel from "@/components/chat/AdminChatPanel";

const tabs = [
  { key: "overview_core", label: "核心总览" },
  { key: "revenue_core", label: "核心收入" },
  { key: "users_core", label: "核心用户" },
  { key: "system_core", label: "核心系统" },
  { key: "dashboard", label: "总览看板" },
  { key: "builds", label: "构建统计" },
  { key: "users", label: "用户统计" },
  { key: "revenue", label: "订单与收入" },
  { key: "stores", label: "商户 / Store" },
  { key: "history", label: "历史记录管理" },
  { key: "cloud", label: "云端运营监控" },
  { key: "content", label: "内容与使用情况" },
  { key: "alerts", label: "异常告警" },
  { key: "actions", label: "后台管理操作" },
  { key: "conversion", label: "转化漏斗" },
  { key: "channels", label: "渠道来源" },
  { key: "retention", label: "用户留存" },
  { key: "chat", label: "站内聊天" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

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
  ok: boolean;
  generatedAt?: string;
  summaryMetrics?: Metric[];
  tabs?: Record<string, TabData>;
  error?: string;
};

type AdminOrderItem = {
  id: string;
  order_kind: "generate_app" | "renew_cloud";
  user_id: string;
  run_id: string | null;
  store_id: string | null;
  renew_id: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  status:
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
  amount_total: number | null;
  currency: string | null;
  paid_at: string | null;
  failed_at: string | null;
  processed_at: string | null;
  retry_count: number | null;
  manual_retry_count: number | null;
  next_retry_at: string | null;
  compensation_status:
    | "none"
    | "pending_retry"
    | "retrying"
    | "manual_review_required"
    | "refund_pending"
    | "refunded"
    | null;
  compensation_note: string | null;
  last_retry_at: string | null;
  admin_notified_at: string | null;
  manual_review_required_at: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  stripe_refund_id: string | null;
  renewal_applied_at: string | null;
  build_started_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type AdminOrdersResponse = {
  ok: boolean;
  items?: AdminOrderItem[];
  error?: string;
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMoney(value?: number | null, currency?: string | null) {
  if (typeof value !== "number") {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "USD").toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function formatOrderKind(kind: AdminOrderItem["order_kind"]) {
  return kind === "generate_app" ? "付费构建" : "云端续费";
}

function getSecondaryIdMeta(order: AdminOrderItem) {
  if (order.order_kind === "generate_app") {
    return {
      label: "RUN ID",
      value: order.run_id || "-",
    };
  }

  return {
    label: "RENEW ID",
    value: order.renew_id || "-",
  };
}

function getOrderStatusMeta(order: AdminOrderItem) {
  if (order.status === "refunded") {
    return {
      label: "已退款",
      className: "border-red-200 bg-red-50 text-red-600",
    };
  }

  if (order.status === "refund_pending") {
    return {
      label: "退款处理中",
      className: "border-rose-200 bg-rose-50 text-rose-600",
    };
  }

  if (
    order.status === "manual_review_required" ||
    order.compensation_status === "manual_review_required"
  ) {
    return {
      label: "人工处理中",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (
    order.compensation_status === "pending_retry" ||
    order.compensation_status === "retrying"
  ) {
    return {
      label: "自动补偿中",
      className: "border-violet-200 bg-violet-50 text-violet-700",
    };
  }

  if (order.status === "failed") {
    return {
      label: "失败待处理",
      className: "border-red-200 bg-red-50 text-red-600",
    };
  }

  if (order.status === "processed") {
    return {
      label: "已完成",
      className: "border-emerald-200 bg-emerald-50 text-emerald-600",
    };
  }

  return {
    label: order.status,
    className: "border-slate-200 bg-slate-50 text-slate-600",
  };
}

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</div>
      <div className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-900">{value}</div>
      {hint ? <div className="mt-2 text-sm text-slate-500">{hint}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/70 bg-white/82 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold tracking-[-0.03em] text-slate-900">{title}</h3>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50/90 text-slate-500">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-slate-100 text-slate-700">
                  {row.map((cell, cellIndex) => (
                    <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3 whitespace-nowrap">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr className="border-t border-slate-100 text-slate-500">
                <td colSpan={headers.length} className="px-4 py-6 text-center">
                  暂无可显示数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ lines }: { lines: string[] }) {
  return (
    <SectionCard title="当前说明" description="这里只显示当前 Tab 的补充说明。当前页面优先展示已接入的真实统计数据。">
      <div className="flex flex-wrap gap-3">
        {lines.map((line) => (
          <Pill key={line}>{line}</Pill>
        ))}
      </div>
    </SectionCard>
  );
}

function pickMetricsFromTabs(
  sourceTabs: Record<string, TabData> | undefined,
  picks: Array<{
    tab: string;
    title: string;
    alias?: string;
  }>,
): Metric[] {
  if (!sourceTabs) {
    return [];
  }

  return picks
    .map((pick) => {
      const sourceTab = sourceTabs[pick.tab];
      const metric = sourceTab?.metrics?.find((item) => item.title === pick.title);

      if (!metric) {
        return null;
      }

      return {
        ...metric,
        title: pick.alias || metric.title,
      };
    })
    .filter((item): item is Metric => item !== null);
}

function mergeTablesFromTabs(
  sourceTabs: Record<string, TabData> | undefined,
  keys: string[],
): TableBlock[] {
  if (!sourceTabs) {
    return [];
  }

  return keys.flatMap((key) => sourceTabs[key]?.tables || []);
}

function mergeNotesFromTabs(
  sourceTabs: Record<string, TabData> | undefined,
  keys: string[],
): string[] {
  if (!sourceTabs) {
    return [];
  }

  return keys.flatMap((key) => sourceTabs[key]?.notes || []);
}

function filterTabData(
  tabData: TabData | undefined,
  options: {
    metricTitles?: string[];
    tableTitles?: string[];
  },
): TabData {
  if (!tabData) {
    return {
      metrics: [],
      tables: [],
      notes: [],
    };
  }

  const metricTitles = options.metricTitles || [];
  const tableTitles = options.tableTitles || [];

  return {
    ...tabData,
    metrics: (tabData.metrics || []).filter((item) => !metricTitles.includes(item.title)),
    tables: (tabData.tables || []).filter((item) => !tableTitles.includes(item.title)),
  };
}

function isCoreTab(tab: TabKey) {
  return ["overview_core", "revenue_core", "users_core", "system_core"].includes(tab);
}

export default function AdminPage() {
  const [tab, setTab] = useState<TabKey>("overview_core");
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [adminOrders, setAdminOrders] = useState<AdminOrderItem[]>([]);
  const [actioningOrderId, setActioningOrderId] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");

  const loadOverview = useCallback(async () => {
    const response = await fetch("/api/admin/overview", {
      method: "GET",
      cache: "no-store",
    });

    const json = (await response.json()) as AdminOverviewResponse;

    if (!response.ok || !json.ok) {
      throw new Error(json.error || "Failed to load admin overview.");
    }

    return json;
  }, []);

  const loadAdminOrders = useCallback(async () => {
    const response = await fetch("/api/admin/orders", {
      method: "GET",
      cache: "no-store",
    });

    const json = (await response.json()) as AdminOrdersResponse;

    if (!response.ok || !json.ok) {
      throw new Error(json.error || "Failed to load admin orders.");
    }

    return json.items || [];
  }, []);

  const refreshAdminOrdersOnly = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);

    try {
      const items = await loadAdminOrders();
      setAdminOrders(items);
    } catch (refreshError) {
      setOrdersError(refreshError instanceof Error ? refreshError.message : "Failed to load admin orders.");
    } finally {
      setOrdersLoading(false);
    }
  }, [loadAdminOrders]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setOrdersLoading(true);
      setError(null);
      setOrdersError(null);

      try {
        const [overview, orders] = await Promise.all([loadOverview(), loadAdminOrders()]);

        if (!cancelled) {
          setData(overview);
          setAdminOrders(orders);
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : "Failed to load admin data.";
          setError(message);
          setOrdersError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setOrdersLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [loadAdminOrders, loadOverview]);

  const activeTab = useMemo(() => tabs.find((item) => item.key === tab), [tab]);

  const composedTabs = useMemo<Record<string, TabData>>(() => {
    const sourceTabs = data?.tabs || {};

    return {
      overview_core: {
        metrics: pickMetricsFromTabs(sourceTabs, [
          { tab: "revenue", title: "7天收入" },
          { tab: "users", title: "真实付费用户" },
          { tab: "revenue", title: "Checkout→Paid 转化率" },
          { tab: "stores", title: "有效 Store", alias: "有效商户" },
          { tab: "builds", title: "构建成功率" },
          { tab: "alerts", title: "今日构建失败", alias: "系统异常数" },
        ]),
        tables: [],
        notes: [
          "这个模块是老板视角总览，只抽取最核心的 6 个指标。",
          "数据全部复用现有 overview 接口，不新增后端统计逻辑。",
        ],
      },
      revenue_core: {
        metrics: pickMetricsFromTabs(sourceTabs, [
          { tab: "revenue", title: "今日收入" },
          { tab: "revenue", title: "7天收入" },
          { tab: "revenue", title: "30天收入" },
          { tab: "revenue", title: "订单总数" },
          { tab: "revenue", title: "支付成功" },
          { tab: "revenue", title: "总收入" },
          { tab: "revenue", title: "Checkout→Paid 转化率" },
          { tab: "revenue", title: "Paid→Processed 转化率" },
          { tab: "revenue", title: "生成订单" },
          { tab: "revenue", title: "续费订单" },
          { tab: "revenue", title: "客单价" },
          { tab: "revenue", title: "ARPPU" },
        ]),
        tables: mergeTablesFromTabs(sourceTabs, ["revenue"]),
        notes: [
          "这个模块只看钱和支付转化。",
          "当前先直接复用原 revenue Tab 的现成统计和表格。",
        ],
      },
      users_core: {
        metrics: pickMetricsFromTabs(sourceTabs, [
          { tab: "users", title: "注册用户" },
          { tab: "users", title: "7天活跃用户" },
          { tab: "users", title: "真实付费用户" },
          { tab: "users", title: "真实复购用户" },
          { tab: "users", title: "生成付费用户" },
          { tab: "users", title: "续费付费用户" },
          { tab: "stores", title: "Store 总数", alias: "商户总数" },
          { tab: "stores", title: "有效 Store", alias: "有效商户" },
          { tab: "stores", title: "试用 Store", alias: "试用商户" },
          { tab: "stores", title: "付费 Store", alias: "付费商户" },
          { tab: "stores", title: "激活 membership", alias: "激活续费" },
          { tab: "cloud", title: "未来 7 天到期", alias: "即将到期" },
        ]),
        tables: [
          ...(sourceTabs.users?.tables?.filter((table) =>
            ["真实支付用户概览", "支付用户 Top 30"].includes(table.title),
          ) || []),
          ...(sourceTabs.stores?.tables?.filter((table) =>
            ["Store 目录（真实 App / 用户映射）"].includes(table.title),
          ) || []),
          ...(sourceTabs.cloud?.tables?.filter((table) =>
            ["到期 / 删库监控"].includes(table.title),
          ) || []),
        ],
        notes: [
          "这个模块只看用户、商户、续费和到期。",
          "当前先把 users / stores / cloud 里和用户经营相关的数据组合到一起。",
        ],
      },
      system_core: {
        metrics: pickMetricsFromTabs(sourceTabs, [
          { tab: "builds", title: "构建总数" },
          { tab: "builds", title: "成功构建" },
          { tab: "builds", title: "失败构建" },
          { tab: "builds", title: "排队中" },
          { tab: "builds", title: "构建中" },
          { tab: "builds", title: "平均构建时长" },
          { tab: "builds", title: "排队超时" },
          { tab: "builds", title: "成功但缺下载" },
          { tab: "alerts", title: "今日构建失败" },
          { tab: "alerts", title: "下载失败" },
          { tab: "alerts", title: "登录回调失败" },
          { tab: "alerts", title: "云端状态异常" },
        ]),
        tables: [
          ...(sourceTabs.builds?.tables || []),
          ...(sourceTabs.alerts?.tables || []),
          ...(sourceTabs.cloud?.tables?.filter((table) =>
            ["云端活跃概览"].includes(table.title),
          ) || []),
        ],
        notes: [
          "这个模块只看构建、异常、云端状态和系统稳定性。",
          "当前先把 builds / alerts / cloud 的系统类统计集中展示。",
        ],
      },
    };
  }, [data?.tabs]);

  const filteredLegacyTabs = useMemo<Record<string, TabData>>(() => {
    const sourceTabs = data?.tabs || {};

    return {
      ...sourceTabs,
      revenue: filterTabData(sourceTabs.revenue, {
        metricTitles: [
          "今日收入",
          "7天收入",
          "30天收入",
          "订单总数",
          "支付成功",
          "总收入",
          "Checkout→Paid 转化率",
          "Paid→Processed 转化率",
          "生成订单",
          "续费订单",
          "客单价",
          "ARPPU",
        ],
        tableTitles: (sourceTabs.revenue?.tables || []).map((item) => item.title),
      }),
      users: filterTabData(sourceTabs.users, {
        metricTitles: [
          "注册用户",
          "7天活跃用户",
          "真实付费用户",
          "真实复购用户",
          "生成付费用户",
          "续费付费用户",
        ],
        tableTitles: ["真实支付用户概览", "支付用户 Top 30"],
      }),
      stores: filterTabData(sourceTabs.stores, {
        metricTitles: [
          "Store 总数",
          "有效 Store",
          "试用 Store",
          "付费 Store",
          "激活 membership",
        ],
        tableTitles: ["Store 目录（真实 App / 用户映射）"],
      }),
      cloud: filterTabData(sourceTabs.cloud, {
        metricTitles: ["未来 7 天到期"],
        tableTitles: ["到期 / 删库监控", "云端活跃概览"],
      }),
      builds: filterTabData(sourceTabs.builds, {
        metricTitles: [
          "构建总数",
          "成功构建",
          "失败构建",
          "排队中",
          "构建中",
          "平均构建时长",
          "排队超时",
          "成功但缺下载",
        ],
        tableTitles: (sourceTabs.builds?.tables || []).map((item) => item.title),
      }),
      alerts: filterTabData(sourceTabs.alerts, {
        metricTitles: [
          "今日构建失败",
          "下载失败",
          "登录回调失败",
          "云端状态异常",
        ],
        tableTitles: (sourceTabs.alerts?.tables || []).map((item) => item.title),
      }),
      conversion: filterTabData(sourceTabs.conversion, {
        metricTitles: ["Checkout→Paid 转化率", "Paid→Processed 转化率"],
        tableTitles: [],
      }),
    };
  }, [data?.tabs]);

  const activeData = (composedTabs[tab] || filteredLegacyTabs[tab] || { metrics: [], tables: [], notes: [] }) as TabData;
  const summaryMetrics = isCoreTab(tab) ? [] : (data?.summaryMetrics || []);

  const autoRetryOrders = useMemo(
    () =>
      adminOrders.filter(
        (order) =>
          order.compensation_status === "pending_retry" ||
          order.compensation_status === "retrying",
      ),
    [adminOrders],
  );

  const manualReviewOrders = useMemo(
    () =>
      adminOrders.filter(
        (order) =>
          order.status === "manual_review_required" ||
          order.compensation_status === "manual_review_required",
      ),
    [adminOrders],
  );

  const refundPendingOrders = useMemo(
    () => adminOrders.filter((order) => order.status === "refund_pending"),
    [adminOrders],
  );

  const refundedOrders = useMemo(
    () => adminOrders.filter((order) => order.status === "refunded"),
    [adminOrders],
  );

  const actionableOrders = useMemo(
    () =>
      adminOrders.filter((order) =>
        ["failed", "manual_review_required", "refund_pending", "refunded"].includes(order.status),
      ),
    [adminOrders],
  );

  const alertBadgeCount = autoRetryOrders.length + manualReviewOrders.length + refundPendingOrders.length;
  const actionBadgeCount = manualReviewOrders.length + refundPendingOrders.length;

  async function handleRetry(orderId: string) {
    try {
      setActioningOrderId(orderId);
      setActionError("");
      setActionMessage("");

      const response = await fetch("/api/admin/orders/retry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to retry order.");
      }

      setActionMessage(`订单 ${orderId} 已触发手动重试。`);
      await refreshAdminOrdersOnly();
    } catch (retryError) {
      setActionError(retryError instanceof Error ? retryError.message : "Failed to retry order.");
    } finally {
      setActioningOrderId("");
    }
  }

  async function handleRefund(orderId: string) {
    const reason = window.prompt("请输入退款原因。", "Manual refund after compensation failed.") || "";

    if (!reason.trim()) {
      return;
    }

    try {
      setActioningOrderId(orderId);
      setActionError("");
      setActionMessage("");

      const response = await fetch("/api/admin/orders/refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          reason: reason.trim(),
        }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to refund order.");
      }

      setActionMessage(`订单 ${orderId} 已提交 Stripe 退款。`);
      await refreshAdminOrdersOnly();
    } catch (refundError) {
      setActionError(refundError instanceof Error ? refundError.message : "Failed to refund order.");
    } finally {
      setActioningOrderId("");
    }
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_45%,#e2e8f0_100%),radial-gradient(circle_at_top,rgba(168,85,247,0.10),transparent_36%),radial-gradient(circle_at_right,rgba(59,130,246,0.08),transparent_28%)]" />

      <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
        <div className="mb-8 rounded-[32px] border border-white/70 bg-white/78 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                NDJC 后台控制台
              </div>
              <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.05em] text-slate-950 md:text-5xl">运营数据总后台</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 md:text-base">
                单页面 + 顶部切换 Tab。当前项目里能直接读取到的前端云端、支付订单与 App 云端真实数据，已统一接入这个后台页。
              </p>
              <div className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-400">
                {data?.generatedAt ? `Last sync · ${new Date(data.generatedAt).toLocaleString()}` : "Waiting for first load"}
              </div>
            </div>

            {!isCoreTab(tab) ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {summaryMetrics.length > 0 ? (
                  summaryMetrics.map((metric) => (
                    <MetricCard key={metric.title} title={metric.title} value={metric.value} hint={metric.hint} />
                  ))
                ) : (
                  <>
                    <MetricCard title="当前排队" value={loading ? "..." : "-"} hint="builds" />
                    <MetricCard title="有效商户" value={loading ? "..." : "-"} hint="stores" />
                    <MetricCard title="未来 7 天到期" value={loading ? "..." : "-"} hint="stores.service_end_at" />
                    <MetricCard title="今日构建失败" value={loading ? "..." : "-"} hint="builds" />
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mb-8 flex gap-3 overflow-x-auto pb-1">
          {tabs.map((item) => {
            const isActive = tab === item.key;
            const badgeCount =
              item.key === "alerts"
                ? alertBadgeCount
                : item.key === "actions"
                  ? actionBadgeCount
                  : 0;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition-all ${
                  isActive
                    ? "bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.20)]"
                    : "border border-white/70 bg-white/80 text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.05)] hover:text-slate-900"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  {item.label}
                  {badgeCount > 0 ? (
                    <span className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                      isActive ? "bg-white/15 text-white" : "bg-red-50 text-red-600"
                    }`}>
                      {badgeCount}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-[-0.03em] text-slate-950">{activeTab?.label}</h2>
            <p className="mt-1 text-sm text-slate-500">
              真实接口模式。上方新增了 4 个核心模块 Tab，直接复用现有 overview 接口返回内容；原有统计项目与原有 Tab 先全部保留不动。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill>单页面控制台</Pill>
            <Pill>顶部 Tab 切换</Pill>
            <Pill>真实数据优先</Pill>
            {alertBadgeCount > 0 ? <Pill>待处置支付异常 {alertBadgeCount}</Pill> : null}
          </div>
        </div>

        {actionMessage ? (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {actionMessage}
          </div>
        ) : null}

        {actionError ? (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}

        {loading ? (
          <SectionCard title="正在加载后台数据" description="正在从前端 Supabase、App 云端 Supabase 读取可接数据。">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="读取 profiles" value="..." />
              <MetricCard title="读取 builds" value="..." />
              <MetricCard title="读取 user_operation_logs" value="..." />
              <MetricCard title="读取 stores" value="..." />
            </div>
          </SectionCard>
        ) : error ? (
          <SectionCard title="后台数据加载失败" description="先修环境变量或权限，再刷新这个页面。">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          </SectionCard>
        ) : (
          <div className="space-y-6">
            {activeData.metrics.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {activeData.metrics.map((metric) => (
                  <MetricCard key={metric.title} title={metric.title} value={metric.value} hint={metric.hint} />
                ))}
              </div>
            ) : null}

            {activeData.tables && activeData.tables.length > 0
              ? activeData.tables.map((table) => (
                  <SectionCard key={table.title} title={table.title} description={table.description}>
                    <SimpleTable headers={table.headers} rows={table.rows} />
                  </SectionCard>
                ))
              : null}

            {tab === "actions" ? (
              <SectionCard
                title="支付订单人工处理面板"
                description="这里接的是真实 web_stripe_orders。自动补偿中、人工处理中、待退款、已退款都会出现在这里。"
              >
                <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard title="自动补偿中" value={String(autoRetryOrders.length)} hint="pending_retry / retrying" />
                  <MetricCard title="人工处理中" value={String(manualReviewOrders.length)} hint="manual_review_required" />
                  <MetricCard title="退款处理中" value={String(refundPendingOrders.length)} hint="refund_pending" />
                  <MetricCard title="已退款" value={String(refundedOrders.length)} hint="refunded" />
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void refreshAdminOrdersOnly();
                    }}
                    className="inline-flex h-[40px] items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-[0_6px_14px_rgba(15,23,42,0.05)] transition hover:bg-slate-50"
                  >
                    刷新异常订单
                  </button>

                  {ordersLoading ? (
                    <span className="text-sm text-slate-500">正在刷新订单...</span>
                  ) : null}

                  {ordersError ? (
                    <span className="text-sm text-rose-600">{ordersError}</span>
                  ) : null}
                </div>

                <div className="space-y-4">
                  {actionableOrders.length > 0 ? (
                    actionableOrders.map((order) => {
                      const statusMeta = getOrderStatusMeta(order);
                      const secondaryIdMeta = getSecondaryIdMeta(order);
                      const canRetry =
                        order.status === "failed" || order.status === "manual_review_required";
                      const canRefund =
                        order.status === "failed" ||
                        order.status === "manual_review_required" ||
                        order.status === "refund_pending";

                      return (
                        <div
                          key={order.id}
                          className="rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-base font-bold text-slate-900">{formatOrderKind(order.order_kind)}</div>
                                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.className}`}>
                                  {statusMeta.label}
                                </span>
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                  订单 ID · {order.id}
                                </span>
                              </div>

                              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">金额</div>
                                  <div className="mt-2 text-sm font-semibold text-slate-900">
                                    {formatMoney(order.amount_total, order.currency)}
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">
                                    {secondaryIdMeta.label}
                                  </div>
                                  <div className="mt-2 break-all text-sm font-semibold text-slate-900">
                                    {secondaryIdMeta.value}
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">STORE ID</div>
                                  <div className="mt-2 break-all text-sm font-semibold text-slate-900">
                                    {order.store_id || "-"}
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">ORDER ID</div>
                                  <div className="mt-2 break-all text-sm font-semibold text-slate-900">
                                    {order.id}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <Pill>用户 {order.user_id}</Pill>
                                <Pill>支付时间 {formatDateTime(order.paid_at)}</Pill>
                                <Pill>失败时间 {formatDateTime(order.failed_at)}</Pill>
                                <Pill>重试次数 {String(order.retry_count || 0)}</Pill>
                                <Pill>人工重试 {String(order.manual_retry_count || 0)}</Pill>
                                <Pill>下一次自动补偿 {formatDateTime(order.next_retry_at)}</Pill>
                                <Pill>管理员通知 {formatDateTime(order.admin_notified_at)}</Pill>
                              </div>

                              {order.compensation_note ? (
                                <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700">
                                  {order.compensation_note}
                                </div>
                              ) : null}

                              {order.error ? (
                                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                  {order.error}
                                </div>
                              ) : null}

                              {order.refund_reason ? (
                                <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                  退款原因：{order.refund_reason}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap gap-3 lg:w-[220px] lg:flex-col">
                              <button
                                type="button"
                                disabled={!canRetry || actioningOrderId === order.id}
                                onClick={() => {
                                  void handleRetry(order.id);
                                }}
                                className={`inline-flex h-[40px] w-[180px] items-center justify-center rounded-full px-5 text-sm font-semibold transition ${
                                  canRetry
                                    ? "border border-sky-200 bg-gradient-to-r from-sky-100 to-sky-50 text-sky-700 shadow-[0_8px_18px_rgba(14,165,233,0.10)] hover:-translate-y-0.5 hover:shadow-[0_12px_22px_rgba(14,165,233,0.14)]"
                                    : "border border-slate-200 bg-slate-100 text-slate-400"
                                }`}
                              >
                                {actioningOrderId === order.id ? "处理中..." : "Retry"}
                              </button>

                              <button
                                type="button"
                                disabled={!canRefund || actioningOrderId === order.id}
                                onClick={() => {
                                  void handleRefund(order.id);
                                }}
                                className={`inline-flex h-[40px] w-[180px] items-center justify-center rounded-full px-5 text-sm font-semibold transition ${
                                  canRefund
                                    ? "border border-red-200 bg-red-50 text-red-600 shadow-[0_6px_14px_rgba(239,68,68,0.06)] hover:bg-red-100"
                                    : "border border-slate-200 bg-slate-100 text-slate-400"
                                }`}
                              >
                                {actioningOrderId === order.id ? "处理中..." : "Refund"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      当前没有需要人工处理的支付异常订单。
                    </div>
                  )}
                </div>
              </SectionCard>
            ) : null}

            {activeData.notes && activeData.notes.length > 0 ? <EmptyState lines={activeData.notes} /> : null}

            {tab === "chat" ? (
              <SectionCard title="聊天操作面板" description="下方保留原站内聊天处理面板，统计与操作同页使用。">
                <AdminChatPanel />
              </SectionCard>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
