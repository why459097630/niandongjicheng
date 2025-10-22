// lib/ndjc/orchestrator.ts (strict mode aligned with ContractV1 hard constraints)

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";
import registryJson from "@/lib/ndjc/anchors/registry.circle-basic.json";
import rulesJson from "@/lib/ndjc/rules/ndjc-rules.json";

/**
 * === 改动要点 ===
 * 1. 移除全部占位符逻辑（__NDJC_PLACEHOLDER__），禁止空串/空数组/空对象。
 * 2. skeleton 用 registry.defaults + required 构建，确保全值。
 * 3. validateByRules：严格校验 regex/enum/minLen，不自动补值；不合规则 FAIL_CLOSE。
 * 4. 布尔值统一为 Boolean；禁止字符串 "true"/"false"。
 * 5. 拼提示词时嵌入 registry.valueFormat / required / defaults，明确 LLM 值域。
 */

type AnchorGroup = "text" | "block" | "list" | "if" | "hook" | "gradle";

type Registry = {
  template: string;
  schemaVersion?: string;
  text: string[];
  block: string[];
  list: string[];
  if: string[];
  hook: string[];
  required?: Partial<Record<AnchorGroup, string[]>>;
  defaults?: any;
  valueFormat?: any;
};

export type OrchestrateInput = NdjcRequest & {
  requirement?: string;
  appName?: string;
  homeTitle?: string;
  mainButtonText?: string;
  packageId?: string;
  locales?: string[];
  permissions?: string[];
  intentHost?: string | null;
  contract?: "v1" | "legacy";
};

export type OrchestrateOutput = {
  template: string;
  mode: "B";
  appName: string;
  homeTitle: string;
  mainButtonText: string;
  packageId: string;
  locales: string[];
  resConfigs?: string;
  permissionsXml?: string;
  intentFiltersXml?: string;
  contract: any;
  raw: string;
  parsed: any;
  _trace?: any;
};

const ROOT = process.cwd();
const PKG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2})?$/;
const PERM_ITEM = /^android\.permission\.[A-Z_]+$/;

function ensurePackageId(v?: string, fallback = "com.example.ndjc") {
  let s = (v || "").trim();
  if (!s) return fallback;
  s = s.replace(/[^a-z0-9_.]+/gi, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".").toLowerCase();
  if (!PKG_REGEX.test(s)) return fallback;
  return s;
}

function mkPermissionsXml(perms?: string[]) {
  if (!perms?.length) return undefined;
  return perms.map(p => `<uses-permission android:name="${p}"/>`).join("\n");
}

function mkIntentFiltersXml(host?: string | null) {
  const h = (host || "").trim();
  if (!h) return undefined;
  return `<intent-filter>
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="${h}"/>
</intent-filter>`;
}

async function readText(filePath: string) {
  const abs = path.join(ROOT, filePath.replace(/^@\/+/, ""));
  return fs.readFile(abs, "utf8");
}

async function readTextAndHash(filePath: string) {
  const abs = path.join(ROOT, filePath.replace(/^@\/+/, ""));
  const raw = await fs.readFile(abs, "utf8");
  const sha = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  return { abs, raw, sha, size: Buffer.byteLength(raw) };
}

/** registry 与 rules 载入 */
async function loadRegistry(): Promise<Registry> {
  const j = JSON.parse(JSON.stringify(registryJson)) as Registry;
  j.required ||= {};
  j.defaults ||= {};
  j.valueFormat ||= {};
  return j;
}

async function loadRules() {
  return JSON.parse(JSON.stringify(rulesJson));
}

/** 严格校验函数 —— 按 registry.valueFormat 执行 regex/enum 检查 */
function validateAgainstRegistry(group: AnchorGroup, key: string, val: any, reg: Registry): boolean {
  const vf = reg.valueFormat?.[group]?.[key];
  if (!vf) return val !== "" && val != null;
  if (vf.enum) return vf.enum.includes(val);
  if (vf.regex) return new RegExp(vf.regex).test(String(val));
  if (vf.minLen && String(val).length < vf.minLen) return false;
  if (vf.itemRegex && Array.isArray(val)) return val.every((x) => new RegExp(vf.itemRegex).test(String(x)));
  return true;
}

/** 主函数 */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg = await loadRegistry();
  const rules = await loadRules();
  const sysPrompt = await readText("lib/ndjc/prompts/contract_v1.en.json");

  let appName = input.appName || "NDJC App";
  let homeTitle = input.homeTitle || "Home";
  let mainButtonText = input.mainButtonText || "Create";
  let packageId = ensurePackageId(input.packageId, "com.example.ndjc");
  const locales = input.locales?.length ? input.locales : ["en"];
  const permissions = input.permissions?.length ? input.permissions : ["android.permission.INTERNET"];

  /** skeleton：直接使用 registry.defaults */
  const skeleton = {
    metadata: { template: reg.template || "circle-basic", appName, packageId, mode: "B" as const },
    anchors: {
      text: Object.fromEntries(
        reg.text.map((k) => [k, reg.defaults?.text?.[k] ?? ""])
      ),
      block: Object.fromEntries(
        reg.block.map((k) => [k, reg.defaults?.block?.[k] ?? ""])
      ),
      list: Object.fromEntries(
        reg.list.map((k) => [k, reg.defaults?.list?.[k] ?? []])
      ),
      if: Object.fromEntries(
        reg.if.map((k) => [k, false])
      ),
      hook: Object.fromEntries(
        reg.hook.map((k) => [k, reg.defaults?.hook?.[k] ?? ""])
      ),
      gradle: {
        applicationId: packageId,
        resConfigs: locales,
        permissions
      }
    },
    files: []
  };

  /** 拼提示词：嵌入必填与值域规则 */
  const valueRules = JSON.stringify(reg.valueFormat, null, 2);
  const requiredRules = JSON.stringify(reg.required, null, 2);

  const userPrompt = [
    "Return STRICT JSON only (no markdown).",
    "All anchors must have valid values; no empty, placeholder, or null entries.",
    "Every value must conform to Android build standards and allow direct APK packaging.",
    "No '<' or '>' in any string.",
    "Mirror SKELETON exactly (no missing or extra keys).",
    "Registry required keys:",
    requiredRules,
    "Registry value format rules:",
    valueRules,
    "SKELETON:",
    JSON.stringify(skeleton, null, 2),
    input.requirement ? `User requirement: ${input.requirement}` : ""
  ].join("\n");

  /** 执行 LLM */
  const msgs = [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt }
  ];

  const _trace: any = { model: process.env.NDJC_MODEL || "groq", mode: "strict-onecall" };

  const r = await callGroqChat(msgs, { temperature: 0 });
  const rawText = typeof r === "string" ? r : (r as any)?.text ?? "";

  let json: any;
  try {
    const m = rawText.match(/```json\s*([\s\S]*?)```/i) || rawText.match(/```\s*([\s\S]*?)```/);
    json = JSON.parse(m ? m[1] : rawText);
  } catch {
    throw new Error("LLM did not return valid JSON.");
  }

  /** 严格验证每个值 */
  const anchors = json?.anchors || {};
  for (const g of ["text","block","list","if","hook","gradle"] as AnchorGroup[]) {
    const groupData: any = (anchors as any)[g];
    const keys: string[] = (reg as any)[g] || [];
    for (const k of keys) {
      const val = groupData?.[k];
      const ok = validateAgainstRegistry(g, k, val, reg);
      if (!ok) throw new Error(`Invalid value for ${g}:${k} → ${JSON.stringify(val)}`);
      if (val === "" || val == null || (Array.isArray(val) && !val.length))
        throw new Error(`Empty value forbidden at ${g}:${k}`);
    }
  }

  /** 输出 */
  const permissionsXml = mkPermissionsXml(anchors.gradle?.permissions);
  const intentFiltersXml = mkIntentFiltersXml(input.intentHost);
  const resConfigs = (anchors.gradle?.resConfigs || []).join(",");

  const outContract = {
    metadata: json?.metadata || skeleton.metadata,
    anchors,
    files: json?.files || []
  };

  const out: OrchestrateOutput = {
    template: reg.template || "circle-basic",
    mode: "B",
    appName,
    homeTitle,
    mainButtonText,
    packageId,
    locales,
    resConfigs,
    permissionsXml,
    intentFiltersXml,
    contract: outContract,
    raw: rawText,
    parsed: outContract,
    _trace
  };

  return out;
}
