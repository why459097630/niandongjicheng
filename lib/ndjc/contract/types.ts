// lib/ndjc/types.ts

/** 伴生文件（方案B） */
export type Companion = {
  path: string;
  content: string;
  overwrite?: boolean;
  kind?: 'kotlin' | 'xml' | 'json' | 'md' | 'txt' | 'gradle' | 'properties' | 'pro';
  /** 可选：若内容是 base64，可声明编码；不声明则按 utf8 写入 */
  encoding?: 'utf8' | 'base64';
};

/** 资源锚点结构（与 generator.ts 的 resources 对齐） */
export type NdjcResources = {
  values?: {
    strings?: Record<string, string>;
    colors?: Record<string, string>;
    dimens?: Record<string, string>;
  };
  /** 会写入 res/values/strings.xml 尾部（若不存在同名键） */
  stringsExtraXml?: Record<string, string>;
  /** 写入 res/drawable/{name}.{ext}；默认按内容推断 xml/png，可用 ext 指定 */
  drawable?: Record<string, { content: string; encoding?: 'utf8' | 'base64'; ext?: string }>;
  /** 写入 res/raw/{filename or key}.{ext}；默认按内容推断 .json/.txt，可用 filename 指定 */
  raw?: Record<string, { content: string; encoding?: 'utf8' | 'base64'; filename?: string }>;
};

/** 前端/调用端传入（或者 LLM 抽取时也会复用这套键） */
export type NdjcRequest = {
  /** 可选：本次运行的唯一标识（不传则由后端生成） */
  runId?: string;

  /** 模板选择（你现有 three 模板的枚举，保留兼容） */
  template?: 'core' | 'simple' | 'form' | string;

  /** 兼容后端使用的模板键（如 circle-basic 等） */
  template_key?: string;

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

  /** —— 新增：直接传递计划字段（便于直连 Contract/LLM） —— */
  anchors?: Record<string, any>;           // 文本锚点 NDJC:*
  blocks?: Record<string, string>;         // 块锚点 NDJC:BLOCK:* / BLOCK:*
  lists?: Record<string, any[]>;           // 列表锚点 LIST:*
  conditions?: Record<string, boolean>;    // 条件锚点 IF:*
  hooks?: Record<string, string>;          // HOOK:*（等价于一种块占位）
  resources?: NdjcResources;               // 资源锚点
  features?: Record<string, any>;          // 功能开关，兜底进 LIST:FEATURE_FLAGS
  routes?: Array<string | { path: string; name?: string; icon?: string }>; // 路由，兜底进 LIST:ROUTES
};

/** 编排（orchestrator）产物，供 generator 使用 */
export type NdjcOrchestratorOutput = {
  // 基本信息
  template: 'core' | 'simple' | 'form' | string;
  mode: 'A' | 'B';
  allowCompanions: boolean;

  appName: string;
  homeTitle: string;
  mainButtonText: string;
  packageId: string;

  // 多语言 & Gradle 相关（保持兼容）
  locales: string[];
  resConfigs?: string;
  proguardExtra?: string;
  packagingRules?: string;

  // 块锚点注入的 XML 片段（保持兼容）
  permissionsXml?: string;
  intentFiltersXml?: string;
  themeOverridesXml?: string;

  // 方案B
  companions: Companion[];

  /** —— 新增：直接输出计划字段，generator.buildPlan 会统一吞噬 —— */
  anchors?: Record<string, any>;
  blocks?: Record<string, string>;
  lists?: Record<string, any[]>;
  conditions?: Record<string, boolean>;
  hooks?: Record<string, string>;
  resources?: NdjcResources;
  features?: Record<string, any>;
  routes?: Array<string | { path: string; name?: string; icon?: string }>;

  /** 可选：路由/日志需要 */
  runId?: string;
  preset_used?: string;
  template_key?: string;

  /** 可选：用于 route.ts 落盘调试 */
  _trace?: any;
};

/** 单个锚点的变更记录 */
export type AnchorChange = {
  file: string;          // 冗余保留
  marker: string;        // NDJC:XXX / BLOCK:XXX / LIST:XXX / HOOK:XXX / IF:XXX / RES:...
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
