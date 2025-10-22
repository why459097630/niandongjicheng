// lib/ndjc/orchestrator.ts
// (strict mode aligned with Contract V1 hard constraints, using .txt prompt file)

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";
import registryJson from "@/lib/ndjc/anchors/registry.circle-basic.json";
import rulesJson from "@/lib/ndjc/rules/ndjc-rules.json";

/** Local chat types to satisfy TS (callGroqChat expects mutable array) */
type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

/* =========================================================
 * Orchestrator (strict Contract V1 pipeline)
 * =======================================================*/

export async function orchestrate(req: NdjcRequest) {
  const runId =
    req.runId ?? `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const templateKey = req.template_key ?? "circle-basic";

  /* ---------- build system prompt ---------- */
  const registry = registryJson;
  const rules = rulesJson;

  const sysPrompt =
    "You are an expert language model tasked with generating an NDJC Contract V1 JSON. " +
    "Follow the schema strictly, return JSON only (no markdown), and fill every anchor with a non-empty, Android-buildable value.";

  /* ---------- read contract prompt text (.txt file) ---------- */
  const promptPath = path.join(
    process.cwd(),
    "lib/ndjc/prompts/contract_v1.en.txt"
  );
  let promptText = "";
  try {
    promptText = await fs.readFile(promptPath, "utf8");
  } catch (e: any) {
    throw new Error(
      `[orchestrate] Prompt file not found or unreadable: ${promptPath}\n${e.message}`
    );
  }

  /* ---------- merge all into a full system prompt ---------- */
  const fullPrompt =
    `${sysPrompt}\n\n---CONTRACT SPEC---\n${promptText}\n\n` +
    `Registry required keys:\n${JSON.stringify(registry.required ?? {}, null, 2)}\n\n` +
    `Gradle rules:\n${JSON.stringify(rules.gradle ?? {}, null, 2)}\n\n` +
    (req.requirement ? `User requirement:\n${req.requirement}\n` : "");

  /* ---------- build chat message (mutable array, no "as const") ---------- */
  const msgs: ChatMessage[] = [
    { role: "system", content: fullPrompt },
    { role: "user", content: req.requirement ?? "" },
  ];

  /* ---------- call LLM ---------- */
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
    throw new Error(
      "Invalid JSON returned by LLM (not parsable). Ensure the model outputs JSON only."
    );
  }

  /* ---------- strict validation (top-level keys) ---------- */
  validateTopLevel(contract);

  /* ---------- NEW: force-complete metadata (avoid 422 in contract-validate) ---------- */
  // Prefer LLM -> fall back to inputs/anchors -> final defaults
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
    template: templateKey || contract?.metadata?.template || "circle-basic",
    appName: String(appLabel),
    packageId: String(applicationId),
    mode: "B", // we are in strict B pipeline
  };

  /* ---------- continue strict validation ---------- */
  validateAnchorsNonEmpty(contract);
  validateGradle(contract);

  /* ---------- output ---------- */
  return {
    ok: true,
    runId,
    step: "orchestrate-online",
    contract,
  };
}

/* =========================================================
 * Helpers
 * =======================================================*/

function tryParseJson(text: string): any {
  if (!text) throw new Error("empty");
  // allow fenced code but prefer raw JSON
  const m =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  return JSON.parse(raw);
}

function trimForTrace(s: string, max = 4000) {
  if (!s) return s;
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (${s.length - max} more chars)`;
}

function validateTopLevel(contract: any) {
  if (!contract || typeof contract !== "object") {
    throw new Error("Contract V1 must be a JSON object.");
  }
  const requiredTop = ["metadata", "anchorsGrouped", "files"];
  for (const key of requiredTop) {
    if (!(key in contract)) {
      throw new Error(`Missing top-level key: ${key}`);
    }
  }
}

function validateAnchorsNonEmpty(contract: any) {
  const grouped = contract.anchorsGrouped ?? {};
  const groups: Array<"text" | "block" | "list" | "if" | "hook" | "gradle"> = [
    "text",
    "block",
    "list",
    "if",
    "hook",
    "gradle",
  ];
  for (const g of groups) {
    const dict = grouped[g];
    if (!dict || typeof dict !== "object") {
      throw new Error(`Missing or invalid group: ${g}`);
    }
    for (const [k, v] of Object.entries(dict)) {
      if (v == null) throw new Error(`Null value at ${g}:${k}`);
      if (typeof v === "string" && v.trim() === "")
        throw new Error(`Empty string at ${g}:${k}`);
      if (v === "__NDJC_PLACEHOLDER__")
        throw new Error(`Placeholder not allowed at ${g}:${k}`);
      if (Array.isArray(v) && v.length === 0)
        throw new Error(`Empty array at ${g}:${k}`);
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
  const resConfigs: string[] = Array.isArray(gradle.resConfigs)
    ? gradle.resConfigs
    : [];
  if (!resConfigs.length || !resConfigs.every((x) => LOCALE_ITEM.test(x))) {
    throw new Error(`Invalid gradle.resConfigs: ${JSON.stringify(resConfigs)}`);
  }
  const perms: string[] = Array.isArray(gradle.permissions)
    ? gradle.permissions
    : [];
  if (!perms.length || !perms.every((p) => PERM_REGEX.test(p))) {
    throw new Error(`Invalid gradle.permissions: ${JSON.stringify(perms)}`);
  }
}
