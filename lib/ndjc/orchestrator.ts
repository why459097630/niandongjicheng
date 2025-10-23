// lib/ndjc/orchestrator.ts
// Strict Contract V1 orchestrator — JSON-only, no placeholders, no stringification side-effects.

import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";
import registryJson from "@/lib/ndjc/anchors/registry.circle-basic.json";

/** ---------------- types ---------------- */
type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

/* =========================================================
 * Orchestrator (strict Contract V1 pipeline, JSON-only)
 * =======================================================*/
export async function orchestrate(req: NdjcRequest) {
  const runId = req.runId ?? `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const templateKey = req.template_key ?? "circle-basic";
  const registry = registryJson as any;

  /* ---------- build system prompt ---------- */
  const sysPrompt =
    "You are an expert NDJC Contract v1 generator.\n" +
    "Return EXACTLY ONE valid JSON object and nothing else (no Markdown or code fences).\n" +
    "Top-level keys in this exact order: metadata → anchorsGrouped → files.\n" +
    "anchorsGrouped includes EXACTLY six groups: text, block, list, if, hook, gradle.\n" +
    "All values MUST be Android-buildable. No placeholders such as 'ready', 'lorem', 'tbd', 'n/a', '-', 'content ready for rendering'.\n" +
    "Booleans/integers MUST be native types (not strings). Objects MUST be JSON objects (not stringified JSON).\n" +
    "The `files` array MUST be empty.\n";

  /* ---------- read contract prompt text (.txt) ---------- */
  const promptPath = path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.en.txt");
  let promptText = "";
  try {
    promptText = await fs.readFile(promptPath, "utf8");
  } catch (e: any) {
    throw new Error(`[orchestrate] Prompt file not found or unreadable: ${promptPath}\n${e.message}`);
  }

  /* ---------- merge into full system prompt ---------- */
  const fullPrompt =
    `${sysPrompt}\n---CONTRACT SPEC---\n${promptText}\n\n` +
    `Registry required keys:\n${JSON.stringify(registry.required ?? {}, null, 2)}\n\n` +
    (req.requirement ? `User requirement:\n${req.requirement}\n` : "");

  const msgs: ChatMessage[] = [
    { role: "system", content: fullPrompt },
    { role: "user", content: req.requirement ?? "" },
  ];

  /* ---------- call LLM (JSON-only expectations) ---------- */
  const model = process.env.NDJC_MODEL || "groq";
  const trace: any = { model, runId, templateKey, step: "orchestrate-online" };

  let rawText = "";
  try {
    const r = await callGroqChat(msgs, { temperature: 0 });
    rawText = typeof r === "string" ? r : (r as any)?.text ?? "";
    trace.raw = trimForTrace(rawText);
  } catch (e: any) {
    trace.error = e?.message ?? e;
    throw new Error(`[orchestrate] LLM call failed: ${trace.error}`);
  }

  /* ---------- parse JSON ---------- */
  let contract: any;
  try {
    contract = tryParseJson(rawText);
  } catch {
    throw new Error("Invalid JSON returned by LLM (not parsable). Ensure the model outputs JSON only.");
  }

  /* ---------- top-level validation ---------- */
  validateTopLevel(contract);

  /* ---------- metadata: minimal, no mode flag, no forced stringification ---------- */
  const grouped = contract.anchorsGrouped ?? {};
  const appLabel =
    req.appName ??
    grouped?.text?.["NDJC:APP_LABEL"] ??
    contract?.metadata?.appName ??
    "NDJC App";

  const applicationId =
    grouped?.gradle?.applicationId ??
    contract?.metadata?.packageId ??
    "com.example.ndjc";

  contract.metadata = {
    ...(contract.metadata ?? {}),
    template: contract?.metadata?.template ?? templateKey,
    appName: typeof appLabel === "string" ? appLabel : String(appLabel ?? "NDJC App"),
    packageId: typeof applicationId === "string" ? applicationId : String(applicationId ?? "com.example.ndjc"),
  };

  /* ---------- JSON-only: ensure files is an empty array ---------- */
  contract.files = [];

  /* ---------- light normalization (no placeholder/default injecting) ---------- */
  normalizeContract(contract);

  /* ---------- strict validation (non-empty & gradle) ---------- */
  validateAnchorsNonEmpty(contract);
  validateGradle(contract);

  /* ---------- output ---------- */
  return {
    ok: true,
    runId,
    step: "orchestrate-online",
    contract,
    trace,
  };
}

/* =========================================================
 * Normalization (safe; no placeholders; no stringification)
 * =======================================================*/
function normalizeContract(contract: any) {
  const g = contract.anchorsGrouped ?? {};
  g.text ||= {};
  g.block ||= {};
  g.list ||= {};
  g.if ||= {};
  g.hook ||= {};
  g.gradle ||= {};

  // THEME_COLORS / STRINGS_EXTRA: keep as objects if possible (no stringified JSON).
  if (g.text["NDJC:THEME_COLORS"] != null) {
    g.text["NDJC:THEME_COLORS"] = normalizeJsonObject(g.text["NDJC:THEME_COLORS"], {
      primary: "#7C3AED",
      secondary: "#10B981",
    });
  }
  if (g.text["NDJC:STRINGS_EXTRA"] != null) {
    g.text["NDJC:STRINGS_EXTRA"] = normalizeJsonObject(g.text["NDJC:STRINGS_EXTRA"], {});
  }

  // IF group: coerce to boolean safely (model is expected to return booleans already).
  if (g.if && typeof g.if === "object") {
    for (const k of Object.keys(g.if)) {
      g.if[k] = toBool(g.if[k]);
    }
  }

  // Gradle.applicationId: normalize to valid package or fallback.
  g.gradle.applicationId = ensurePkg(g.gradle.applicationId, "com.example.ndjc");

  // resConfigs: filter to valid locale items; fallback to ["en"].
  const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2})?$/;
  let res: string[] = Array.isArray(g.gradle.resConfigs) ? g.gradle.resConfigs.map(String) : [];
  res = res.filter((x) => LOCALE_ITEM.test(x));
  if (!res.length) res = ["en"];
  g.gradle.resConfigs = res;

  // permissions: keep only valid Android permission constants; fallback to INTERNET.
  const PERM = /^android\.permission\.[A-Z_]+$/;
  let perms: string[] = Array.isArray(g.gradle.permissions) ? g.gradle.permissions.map(String) : [];
  perms = perms.filter((p) => PERM.test(p));
  if (!perms.length) perms = ["android.permission.INTERNET"];
  g.gradle.permissions = perms;

  contract.anchorsGrouped = g;

  // Sync NDJC:PACKAGE_NAME from applicationId if missing.
  if (!g.text["NDJC:PACKAGE_NAME"]) {
    g.text["NDJC:PACKAGE_NAME"] = g.gradle.applicationId;
  }
}

/* =========================================================
 * Validation helpers
 * =======================================================*/
function tryParseJson(text: string): any {
  if (!text) throw new Error("empty");
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  return JSON.parse(raw);
}

function trimForTrace(s: string, max = 4000) {
  if (!s) return s;
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (${s.length - max} more chars)`;
}

function validateTopLevel(contract: any) {
  if (!contract || typeof contract !== "object") throw new Error("Contract V1 must be a JSON object.");
  const requiredTop = ["metadata", "anchorsGrouped", "files"];
  for (const key of requiredTop) {
    if (!(key in contract)) throw new Error(`Missing top-level key: ${key}`);
  }
}

function validateAnchorsNonEmpty(contract: any) {
  const grouped = contract.anchorsGrouped ?? {};
  const groups: Array<"text" | "block" | "list" | "if" | "hook" | "gradle"> = ["text", "block", "list", "if", "hook", "gradle"];
  for (const g of groups) {
    const dict = grouped[g];
    if (!dict || typeof dict !== "object") throw new Error(`Missing or invalid group: ${g}`);
    for (const [k, v] of Object.entries(dict)) {
      if (v == null) throw new Error(`Null value at ${g}:${k}`);
      if (typeof v === "string" && v.trim() === "") throw new Error(`Empty string at ${g}:${k}`);
      if (Array.isArray(v) && v.length === 0) throw new Error(`Empty array at ${g}:${k}`);
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) {
        throw new Error(`Empty object at ${g}:${k}`);
      }
    }
  }
}

const PKG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PERM_REGEX = /^android\.permission\.[A-Z_]+$/;
const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2})?$/;

function validateGradle(contract: any) {
  const gradle = contract.anchorsGrouped?.gradle ?? {};
  const appId = gradle.applicationId;
  if (!appId || typeof appId !== "string" || !PKG_REGEX.test(appId)) {
    throw new Error(`Invalid gradle.applicationId: ${appId}`);
  }
  const resConfigs: string[] = Array.isArray(gradle.resConfigs) ? gradle.resConfigs : [];
  if (!resConfigs.length || !resConfigs.every((x) => LOCALE_ITEM.test(x))) {
    throw new Error(`Invalid gradle.resConfigs: ${JSON.stringify(resConfigs)}`);
  }
  const perms: string[] = Array.isArray(gradle.permissions) ? gradle.permissions : [];
  if (!perms.length || !perms.every((p) => PERM_REGEX.test(p))) {
    throw new Error(`Invalid gradle.permissions: ${JSON.stringify(perms)}`);
  }
}

/* =========================================================
 * Small utils
 * =======================================================*/
function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  if (["true", "1", "yes", "y", "on", "enabled", "enable", "open", "是"].includes(s)) return true;
  if (["false", "0", "no", "n", "off", "disabled", "disable", "close", "否"].includes(s)) return false;
  return false;
}

function ensurePkg(v?: string, fallback = "com.example.ndjc") {
  let s = (v || "").trim().toLowerCase();
  s = s.replace(/[^a-z0-9_.]+/g, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".");
  return /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(s) ? s : fallback;
}

function normalizeJsonObject(input: any, fallback: Record<string, any>) {
  // Already object
  if (input && typeof input === "object" && !Array.isArray(input)) return input;
  // String that is JSON
  if (typeof input === "string") {
    const s = input.trim();
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch {
      // not json, ignore
    }
  }
  // Fallback
  return { ...fallback };
}
