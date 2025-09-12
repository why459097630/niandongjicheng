// lib/ndjc/types.ts

/** 伴生文件（方案B） */
export type Companion = {
  path: string;
  content: string;
  overwrite?: boolean;
  kind?: 'kotlin' | 'xml' | 'json' | 'md' | 'txt';
};

/** 前端/调用端传入（或者 LLM 抽取时也会复用这套键） */
export type NdjcRequest = {
  /** 模板选择：默认 core */
  template?: 'core' | 'simple' | 'form';

  /** 自然语言需求 */
  requirement?: string;

  /** 工作模式：A 仅抽字段；B 允许伴生代码 */
  mode?: 'A' | 'B';
  /** 仅 B 模式有效：是否允许伴生文件 */
  allowCompanions?: boolean;

  /** 可直接给，也可由 LLM 抽出 */
  appName?: string;
  homeTitle?: string;
  mainButtonText?: string;
  packageId?: string;
  packageName?: string;

  /** 扩展字段（用于锚点替换/Gradle 注入） */
  permissions?: string[];       // Android 权限名
  intentHost?: string | null;   // 深链 host
  locales?: string[];           // e.g. ["en","zh-rCN","zh-rTW"]
  resConfigs?: string;          // 逗号分隔的 locale 列表
  proguardExtra?: string;       // Gradle 中 files(...) 的附加片段
  packagingRules?: string;      // Gradle packaging{} 片段
  themeOverridesXml?: string;   // 主题覆盖 XML 片段（可选）

  /** 方案B：伴生文件 */
  _companions?: Companion[];
};

/** 编排（orchestrator）产物，供 generator 使用 */
export type NdjcOrchestratorOutput = {
  template: 'core' | 'simple' | 'form';
  mode: 'A' | 'B';
  allowCompanions: boolean;

  appName: string;
  homeTitle: string;
  mainButtonText: string;
  packageId: string;

  // 多语言 & Gradle 相关
  locales: string[];
  resConfigs?: string;
  proguardExtra?: string;
  packagingRules?: string;

  // 块锚点注入的 XML 片段
  permissionsXml?: string;
  intentFiltersXml?: string;
  themeOverridesXml?: string;

  // 方案B
  companions: Companion[];
};

/** 单个锚点的变更记录 */
export type AnchorChange = {
  file: string;          // 冗余保留
  marker: string;        // NDJC:XXX 或 BLOCK:XXX
  found: boolean;        // 是否找到该标记
  replacedCount: number; // 替换次数
  beforeSample?: string; // 变更前附近内容（便于审计）
  afterSample?: string;  // 变更后附近内容
};

/** 每个文件的变更结果 */
export type ApplyResult = {
  file: string;
  changes: AnchorChange[];
};
