"use client";

import { useEffect, useMemo, useState } from "react";

const tabs = [
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
    <SectionCard title="当前未接入的数据" description="这部分不是页面没做好，而是项目里目前还没有可直接读取的正式数据表。">
      <div className="flex flex-wrap gap-3">
        {lines.map((line) => (
          <Pill key={line}>{line}</Pill>
        ))}
      </div>
    </SectionCard>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminOverviewResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/admin/overview", {
          method: "GET",
          cache: "no-store",
        });

        const json = (await response.json()) as AdminOverviewResponse;

        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Failed to load admin overview.");
        }

        if (!cancelled) {
          setData(json);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load admin overview.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeTab = useMemo(() => tabs.find((item) => item.key === tab), [tab]);
  const activeData = (data?.tabs?.[tab] || { metrics: [], tables: [], notes: [] }) as TabData;
  const summaryMetrics = data?.summaryMetrics || [];

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
                单页面 + 顶部切换 Tab。当前已把项目里现阶段能直接读到的真实数据全部接上，读不到正式表的数据会明确显示未接入。
              </p>
              <div className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-400">
                {data?.generatedAt ? `Last sync · ${new Date(data.generatedAt).toLocaleString()}` : "Waiting for first load"}
              </div>
            </div>

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
          </div>
        </div>

        <div className="mb-8 flex gap-3 overflow-x-auto pb-1">
          {tabs.map((item) => {
            const isActive = tab === item.key;
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
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-[-0.03em] text-slate-950">{activeTab?.label}</h2>
            <p className="mt-1 text-sm text-slate-500">
              真实接口模式。当前页面显示的是现有项目表里已经能直接接上的数据。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill>单页面控制台</Pill>
            <Pill>顶部 Tab 切换</Pill>
            <Pill>真实数据优先</Pill>
          </div>
        </div>

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

            {activeData.notes && activeData.notes.length > 0 ? <EmptyState lines={activeData.notes} /> : null}
          </div>
        )}
      </div>
    </main>
  );
}