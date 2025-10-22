// lib/ndjc/orchestrator.ts
// (strict mode aligned with Contract V1 hard constraints, using .txt prompt file)

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";
import registryJson from "@/lib/ndjc/anchors/registry.circle-basic.json";
import rulesJson from "@/lib/ndjc/rules/ndjc-rules.json";

/* =========================================================
 * Orchestrator (strict Contract V1 pipeline)
 * =======================================================*/

export async function orchestrate(req: NdjcRequest) {
  const runId = req.run_id ?? `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const templateKey = req.template_key ?? "circle-basic";

  /* ---------- build system prompt ---------- */
  const registry = registryJson;
  const rules = rulesJson;

  const sysPrompt =
    "You are an expert language model tasked with generating an NDJC Contract V1 JSON. " +
    "Follow the schema strictly, fill every anchor with a non-empty, Android-buildable value.";

  /* ---------- read contract prompt text (.txt file) ---------- */
  const promptPath = path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.en.txt");
  let promptText = "";
  try {
    promptText = await fs.readFile(promptPath, "utf8");
  } catch (e: any) {
    throw new Error(`[orchestrate] Prompt file not found or unreadable: ${promptPath}\n${e.message}`);
  }

  /* ---------- merge all into a full system prompt ---------- */
  const fullPrompt =
    `${sysPrompt}\n\n---CONTRACT SPEC---\n${promptText}\n\n` +
    `Registry keys:\n${JSON.stringify(registry.required)}\n\n` +
    `Rules:\n${JSON.stringify(rules.gradle ?? {})}\n\n` +
    `User request:\n${req.requirement}`;

  /* ---------- build chat message ---------- */
  const msgs = [
    { role: "system", content: fullPrompt },
    { role: "user", content: req.requirement ?? "" }
  ] as const;

  /* ---------- call LLM ---------- */
  const model = process.env.NDJC_MODEL || "groq";
  const trace: any = { model, runId, step: "orchestrate-online" };

  let rawText = "";
  try {
    const r = await callGroqChat(msgs, { temperature: 0 });
    rawText = typeof r === "string" ? r : (r as any)?.text ?? "";
  } catch (e: any) {
    trace.error = e?.message ?? e;
    throw new Error(`[orchestrate] LLM call failed: ${trace.error}`);
  }

  /* ---------- parse JSON ---------- */
  let contract: any;
  try {
    contract = JSON.parse(rawText);
  } catch {
    throw new Error("Invalid JSON returned by LLM (not parsable).");
  }

  /* ---------- strict validation ---------- */
  validateContract(contract, registry);

  /* ---------- output ---------- */
  return {
    ok: true,
    runId,
    step: "orchestrate-online",
    contract
  };
}

/* =========================================================
 * Validation helpers
 * =======================================================*/

function validateContract(contract: any, registry: any) {
  if (!contract || typeof contract !== "object") {
    throw new Error("Contract V1 must be a JSON object.");
  }

  const groups = ["metadata", "anchorsGrouped", "files"];
  for (const key of groups) {
    if (!(key in contract)) {
      throw new Error(`Missing top-level key: ${key}`);
    }
  }

  const anchorsGrouped = contract.anchorsGrouped ?? {};
  for (const group of ["text", "block", "list", "if", "hook", "gradle"]) {
    const items = anchorsGrouped[group];
    if (!items || typeof items !== "object") {
      throw new Error(`Missing or invalid group: ${group}`);
    }
    for (const [k, v] of Object.entries(items)) {
      if (v === "" || v == null || v === "__NDJC_PLACEHOLDER__") {
        throw new Error(`Empty or placeholder value for anchor: ${k}`);
      }
    }
  }

  // Gradle-specific validation
  const gradle = anchorsGrouped.gradle ?? {};
  const appId = gradle.applicationId;
  if (appId && !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId))
    throw new Error(`Invalid applicationId: ${appId}`);

  const perms = gradle.permissions ?? [];
  for (const p of perms) {
    if (!/^android\.permission\.[A-Z_]+$/.test(p))
      throw new Error(`Invalid permission: ${p}`);
  }
}
