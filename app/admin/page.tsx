"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminChatPanel from "@/components/chat/AdminChatPanel";

const tabs = [
  { key: "overview_core", label: "核心总览" },
  { key: "revenue_core", label: "核心收入" },
  { key: "users_core", label: "核心用户" },
  { key: "system_core", label: "核心系统" },
  { key: "actions", label: "后台管理操作" },
  { key: "history", label: "历史记录管理" },
  { key: "content", label: "内容与使用情况" },
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
  pageSize = 10,
}: {
  headers: string[];
  rows: string[][];
  pageSize?: number;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(startIndex, startIndex + pageSize);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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
            {pagedRows.length > 0 ? (
              pagedRows.map((row, rowIndex) => (
                <tr key={`${safePage}-${rowIndex}`} className="border-t border-slate-100 text-slate-700">
                  {row.map((cell, cellIndex) => (
                    <td key={`${safePage}-${rowIndex}-${cellIndex}`} className="px-4 py-3 whitespace-nowrap">
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

      {rows.length > pageSize ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 bg-slate-50/70 px-4 py-3 text-sm">
          <div className="text-slate-500">
            显示第 {startIndex + 1}-{Math.min(startIndex + pageSize, rows.length)} 条，共 {rows.length} 条
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={safePage === 1}
              className={`inline-flex h-[34px] items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                safePage === 1
                  ? "border border-slate-200 bg-slate-100 text-slate-400"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              上一页
            </button>

            <span className="min-w-[72px] text-center text-slate-600">
              {safePage} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={safePage === totalPages}
              className={`inline-flex h-[34px] items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                safePage === totalPages
                  ? "border border-slate-200 bg-slate-100 text-slate-400"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ lines }: { lines: string[] }) {
  return (
    <SectionCard title="当前说明" description="这里只显示当前 Tab 的补充说明。当前页面优先展示已接入的真实统计数据。">
      <div className="space-y-3 text-sm text-slate-600">
        {lines.map((line) => (
          <div key={line} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            {line}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<TabKey>("overview_core");
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [orders, setOrders] = useState<AdminOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actioningOrderId, setActioningOrderId] = useState<string | null>(null);
  const [actionsFilter, setActionsFilter] = useState<"all" | "generate_app" | "renew_cloud">("all");
  const [actionsStatusFilter, setActionsStatusFilter] = useState<
    "all" | "manual_review_required" | "refund_pending" | "pending_retry" | "failed"
  >("all");
  const [actionsPage, setActionsPage] = useState(1);
  const actionsPageSize = 8;

  const fetchAdminData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [overviewRes, ordersRes] = await Promise.all([
        fetch("/api/admin/overview", { cache: "no-store" }),
        fetch("/api/admin/orders", { cache: "no-store" }),
      ]);

      const overviewJson: AdminOverviewResponse = await overviewRes.json();
      const ordersJson: AdminOrdersResponse = await ordersRes.json();

      if (!overviewRes.ok || !overviewJson.ok) {
        throw new Error(overviewJson.error || "读取 admin overview 失败。");
      }

      if (!ordersRes.ok || !ordersJson.ok) {
        throw new Error(ordersJson.error || "读取 admin orders 失败。");
      }

      setOverview(overviewJson);
      setOrders(Array.isArray(ordersJson.items) ? ordersJson.items : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "读取 admin 数据失败。";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAdminData();
  }, [fetchAdminData]);

  const activeData = useMemo(() => {
    if (!overview?.tabs) {
      return null;
    }

    return overview.tabs[tab] || null;
  }, [overview, tab]);

  const filteredActionableOrders = useMemo(() => {
    return orders.filter((order) => {
      const byKind = actionsFilter === "all" ? true : order.order_kind === actionsFilter;

      const statusBucket =
        order.status === "manual_review_required" || order.compensation_status === "manual_review_required"
          ? "manual_review_required"
          : order.status === "refund_pending"
            ? "refund_pending"
            : order.compensation_status === "pending_retry" || order.compensation_status === "retrying"
              ? "pending_retry"
              : order.status === "failed"
                ? "failed"
                : "other";

      const byStatus = actionsStatusFilter === "all" ? true : statusBucket === actionsStatusFilter;

      return byKind && byStatus;
    });
  }, [orders, actionsFilter, actionsStatusFilter]);

  useEffect(() => {
    setActionsPage(1);
  }, [actionsFilter, actionsStatusFilter]);

  const actionsTotalPages = Math.max(1, Math.ceil(filteredActionableOrders.length / actionsPageSize));
  const safeActionsPage = Math.min(actionsPage, actionsTotalPages);
  const pagedActionableOrders = filteredActionableOrders.slice(
    (safeActionsPage - 1) * actionsPageSize,
    safeActionsPage * actionsPageSize,
  );

  const handleRetry = useCallback(async (orderId: string) => {
    try {
      setActioningOrderId(orderId);
      setActionMessage(null);

      const res = await fetch("/api/admin/orders/retry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "重试失败。");
      }

      setActionMessage("已触发人工重试。订单状态稍后会自动刷新。");
      await fetchAdminData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "重试失败。";
      setActionMessage(message);
    } finally {
      setActioningOrderId(null);
    }
  }, [fetchAdminData]);

  const handleRefund = useCallback(async (orderId: string) => {
    const reason = window.prompt("请输入退款原因。", "Manual refund after compensation failed.") || "";

    if (!reason.trim()) {
      return;
    }

    try {
      setActioningOrderId(orderId);
      setActionMessage(null);

      const res = await fetch("/api/admin/orders/refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId, reason }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "退款失败。");
      }

      setActionMessage("已提交退款处理。订单状态稍后会自动刷新。");
      await fetchAdminData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "退款失败。";
      setActionMessage(message);
    } finally {
      setActioningOrderId(null);
    }
  }, [fetchAdminData]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(191,219,254,0.32),transparent_42%),linear-gradient(180deg,#f8fbff_0%,#eef5ff_44%,#f8fafc_100%)] px-4 py-8 text-slate-900 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-[32px] border border-white/70 bg-white/82 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-sky-700">
                NDJC Admin Console
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-[-0.05em] text-slate-900 md:text-4xl">后台管理总览</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">
                这里只显示已真实接入的数据。核心页保留最关键指标，非核心页承接历史记录、内容使用、支付异常处理和站内聊天操作。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <Pill>生成时间 {formatDateTime(overview?.generatedAt)}</Pill>
              <button
                type="button"
                onClick={() => {
                  void fetchAdminData();
                }}
                className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:bg-slate-50"
              >
                刷新数据
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/70 bg-white/82 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl md:p-5">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => {
              const isActive = item.key === tab;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={`inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                    isActive
                      ? "bg-slate-900 text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>

        {loading ? (
          <SectionCard title="正在加载" description="正在读取后台真实数据，请稍候。">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-3xl bg-slate-100" />
              ))}
            </div>
          </SectionCard>
        ) : error ? (
          <SectionCard title="读取失败" description="后台接口返回了错误信息。">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          </SectionCard>
        ) : !activeData ? (
          <SectionCard title="暂无数据" description="当前 Tab 没有可展示的数据块。">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">请检查 admin overview 接口返回的 tabs 结构。</div>
          </SectionCard>
        ) : (
          <div className="space-y-6">
            {tab !== "chat" ? (
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {(tab.includes("_core") ? activeData.metrics : overview?.summaryMetrics || []).map((metric) => (
                  <MetricCard key={metric.title} title={metric.title} value={metric.value} hint={metric.hint} />
                ))}
              </section>
            ) : null}

            {tab !== "actions" && activeData.tables && activeData.tables.length > 0 ? (
              <div className="space-y-6">
                {activeData.tables.map((table) => (
                  <SectionCard key={table.title} title={table.title} description={table.description}>
                    <SimpleTable headers={table.headers} rows={table.rows} />
                  </SectionCard>
                ))}
              </div>
            ) : null}

            {tab === "actions" ? (
              <SectionCard title="支付异常与人工处理" description="这里只保留需要管理员处理的支付异常订单。可在此查看失败构建、自动补偿、人工重试与退款处理状态。">
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={actionsFilter}
                    onChange={(event) => setActionsFilter(event.target.value as typeof actionsFilter)}
                    className="h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 outline-none"
                  >
                    <option value="all">全部类型</option>
                    <option value="generate_app">付费构建</option>
                    <option value="renew_cloud">云端续费</option>
                  </select>

                  <select
                    value={actionsStatusFilter}
                    onChange={(event) => setActionsStatusFilter(event.target.value as typeof actionsStatusFilter)}
                    className="h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 outline-none"
                  >
                    <option value="all">全部状态</option>
                    <option value="manual_review_required">人工处理中</option>
                    <option value="refund_pending">退款处理中</option>
                    <option value="pending_retry">自动补偿中</option>
                    <option value="failed">失败待处理</option>
                  </select>
                </div>

                {actionMessage ? (
                  <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">{actionMessage}</div>
                ) : null}

                <div className="mt-5 space-y-4">
                  {pagedActionableOrders.length > 0 ? (
                    pagedActionableOrders.map((order) => {
                      const secondaryIdMeta = getSecondaryIdMeta(order);
                      const statusMeta = getOrderStatusMeta(order);
                      const canRetry =
                        order.status === "failed" ||
                        order.status === "manual_review_required" ||
                        order.compensation_status === "manual_review_required";
                      const canRefund =
                        order.status === "manual_review_required" ||
                        order.compensation_status === "manual_review_required" ||
                        order.status === "refund_pending";
                      const showRetryMeta = order.status !== "refunded";
                      const showCompensationMeta =
                        order.status !== "refunded" &&
                        order.status !== "processed" &&
                        (order.compensation_status === "pending_retry" ||
                          order.compensation_status === "retrying" ||
                          !!order.next_retry_at);
                      const showAdminNoticeMeta =
                        order.status !== "refunded" &&
                        order.status !== "processed" &&
                        !!order.admin_notified_at;

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
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">用户</div>
                                  <div className="mt-2 break-all text-sm font-semibold text-slate-900">
                                    {order.user_id}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <Pill>支付时间 {formatDateTime(order.paid_at)}</Pill>
                                <Pill>失败时间 {formatDateTime(order.failed_at)}</Pill>
                                {showRetryMeta ? <Pill>重试次数 {String(order.retry_count || 0)}</Pill> : null}
                                {showRetryMeta ? <Pill>人工重试 {String(order.manual_retry_count || 0)}</Pill> : null}
                                {showCompensationMeta ? <Pill>下一次自动补偿 {formatDateTime(order.next_retry_at)}</Pill> : null}
                                {showAdminNoticeMeta ? <Pill>管理员通知 {formatDateTime(order.admin_notified_at)}</Pill> : null}
                              </div>

                              {order.status === "refunded" ? (
                                <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                  <div className="font-semibold text-red-700">退款已完成</div>
                                  {order.refund_reason ? <div className="mt-1">原因：{order.refund_reason}</div> : null}
                                </div>
                              ) : order.status === "refund_pending" ? (
                                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                  <div className="font-semibold text-rose-700">退款处理中</div>
                                  {order.refund_reason ? <div className="mt-1">原因：{order.refund_reason}</div> : null}
                                </div>
                              ) : null}

                              {order.compensation_note && order.status !== "refunded" ? (
                                <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700">
                                  {order.compensation_note}
                                </div>
                              ) : null}

                              {order.error && order.status !== "refunded" ? (
                                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                  {order.error}
                                </div>
                              ) : null}

                              {order.refund_reason && order.status !== "refunded" && order.status !== "refund_pending" ? (
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
                      当前筛选条件下没有需要人工处理的支付异常订单。
                    </div>
                  )}
                </div>

                {filteredActionableOrders.length > actionsPageSize ? (
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActionsPage((prev) => Math.max(1, prev - 1))}
                      disabled={safeActionsPage === 1}
                      className={`inline-flex h-[36px] items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                        safeActionsPage === 1
                          ? "border border-slate-200 bg-slate-100 text-slate-400"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      上一页
                    </button>

                    <span className="min-w-[72px] text-center text-sm text-slate-600">
                      {safeActionsPage} / {actionsTotalPages}
                    </span>

                    <button
                      type="button"
                      onClick={() => setActionsPage((prev) => Math.min(actionsTotalPages, prev + 1))}
                      disabled={safeActionsPage === actionsTotalPages}
                      className={`inline-flex h-[36px] items-center justify-center rounded-full px-4 text-sm font-semibold transition ${
                        safeActionsPage === actionsTotalPages
                          ? "border border-slate-200 bg-slate-100 text-slate-400"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      下一页
                    </button>
                  </div>
                ) : null}
              </SectionCard>
            ) : null}

            {tab !== "chat" && activeData.notes && activeData.notes.length > 0 ? <EmptyState lines={activeData.notes} /> : null}

            {tab === "chat" ? (
              <SectionCard title="聊天操作面板" description="这里只保留站内聊天操作，聊天统计已并入“内容与使用情况”页。">
                <AdminChatPanel />
              </SectionCard>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
