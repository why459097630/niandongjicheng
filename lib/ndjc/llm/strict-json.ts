// lib/ndjc/llm/strict-json.ts
// 作用：
// 1) 可靠地从 LLM 返回的文本中提取“严格 JSON”（去除 ```json 代码块、前后噪声等）。
// 2) 提供一个轻量级的 Contract v1 校验器（如果你没有单独的 validators.ts，就从这里导入）。
//
// 使用：
//   import { parseStrictJson, validateContractV1 } from '@/lib/ndjc/llm/strict-json';

export type StrictParseOk = { ok: true; data: any };
export type StrictParseErr = { ok: false; error: string };

/** 去除围栏与噪声，并尝试提取最外层 JSON 对象/数组 */
function normalizeRaw(raw: string): string {
  let t = String(raw ?? '');

  // 去掉常见围栏 ```json ... ```
  t = t.trim()
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/```$/i, '');

  // 去掉一些模型爱加的前缀，比如 "json\n"、"JSON:\n"
  t = t.replace(/^(?:json|JSON)\s*:\s*/i, '').replace(/^(?:json|JSON)\s*\n/i, '');

  // 如果包含多余解释文本，尝试截取首个 “{” 或 “[” 到最后一个 “}” 或 “]”
  // 仅当整体 parse 失败时使用
  return t;
}

/** 从 LLM 原文中“尽量严格”地解析出 JSON */
export function parseStrictJson(raw: string): StrictParseOk | StrictParseErr {
  const firstPass = normalizeRaw(raw);

  // 先直接尝试
  try {
    const data = JSON.parse(firstPass);
    return { ok: true, data };
  } catch {}

  // 失败：尝试在文本中截取最外层 JSON 片段
  const s = firstPass;
  const objStart = s.indexOf('{');
  const arrStart = s.indexOf('[');
  let start = -1;
  if (objStart >= 0 && arrStart >= 0) start = Math.min(objStart, arrStart);
  else start = Math.max(objStart, arrStart); // 其中之一
  if (start >= 0) {
    // 从末尾找与之对应的结束符
    const objEnd = s.lastIndexOf('}');
    const arrEnd = s.lastIndexOf(']');
    let end = -1;
    if (objEnd >= 0 && arrEnd >= 0) end = Math.max(objEnd, arrEnd);
    else end = Math.max(objEnd, arrEnd);
    if (end > start) {
      const slice = s.slice(start, end + 1).trim();
      try {
        const data = JSON.parse(slice);
        return { ok: true, data };
      } catch (e: any) {
        return { ok: false, error: `JSON parse failed after slice: ${e?.message || String(e)}` };
      }
    }
  }

  return { ok: false, error: 'JSON parse failed: not a valid JSON payload' };
}

/* ───────────────────────────── Contract v1 轻量校验 ───────────────────────────── */

export type ValidationIssue = { code: string; message: string; path: string };
export type ValidationResult =
  | { ok: true; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * 极简版本的 Contract v1 校验器：
 * - 只校验“必需的顶层元数据”是否合理，其他锚点字段宽松通过，避免频繁 400。
 * - 需要更严格的校验可以在 CI 端补充。
 *
 * 期望结构（最小集）：
 * {
 *   "metadata": {
 *     "template": string,
 *     "appName": string,
 *     "packageId": string,
 *     "mode": "A" | "B"
 *   },
 *   "anchors"?: { text?: object, block?: object, list?: object, if?: object, gradle?: object },
 *   "resources"?: object,
 *   "hooks"?: object,
 *   "files"?: array
 * }
 */
export async function validateContractV1(data: any): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string, path: string) =>
    issues.push({ code, message, path });

  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    push('E_TYPE_ROOT', 'Root must be a JSON object', '<root>');
    return { ok: false, issues };
  }

  const md = (data as any).metadata;
  if (!md || typeof md !== 'object') {
    push('E_META_MISSING', 'metadata is required', 'metadata');
    return { ok: false, issues };
  }

  // template
  if (typeof md.template !== 'string' || !md.template.trim()) {
    push('E_META_TEMPLATE', 'metadata.template must be a non-empty string', 'metadata.template');
  }
  // appName
  if (typeof md.appName !== 'string' || !md.appName.trim()) {
    push('E_META_APPNAME', 'metadata.appName must be a non-empty string', 'metadata.appName');
  }
  // packageId
  if (typeof md.packageId !== 'string' || !md.packageId.trim()) {
    push('E_META_PACKAGE', 'metadata.packageId must be a non-empty string', 'metadata.packageId');
  } else {
    // 只做非常宽松的包名检查（包含点）
    if (!md.packageId.includes('.')) {
      push('W_META_PACKAGE_FORMAT', 'packageId looks unusual (missing dot)', 'metadata.packageId');
    }
  }
  // mode
  if (md.mode !== 'A' && md.mode !== 'B') {
    push('E_META_MODE', 'metadata.mode must be "A" or "B"', 'metadata.mode');
  }

  // anchors（若给，需为对象）
  if ('anchors' in data && (typeof data.anchors !== 'object' || data.anchors == null || Array.isArray(data.anchors))) {
    push('E_ANCHORS_TYPE', 'anchors must be an object', 'anchors');
  }

  // hooks/resources（若给，需为对象）
  if ('hooks' in data && (typeof data.hooks !== 'object' || data.hooks == null || Array.isArray(data.hooks))) {
    push('E_HOOKS_TYPE', 'hooks must be an object', 'hooks');
  }
  if ('resources' in data && (typeof data.resources !== 'object' || data.resources == null || Array.isArray(data.resources))) {
    push('E_RES_TYPE', 'resources must be an object', 'resources');
  }

  return { ok: issues.filter(i => i.code.startsWith('E_')).length === 0, issues };
}
