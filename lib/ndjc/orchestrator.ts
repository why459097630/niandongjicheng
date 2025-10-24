// lib/ndjc/orchestrator.ts
//
// NDJC two-phase orchestrator
//
// Phase 1: ask LLM for config spec only (text / if / list / gradle)
//   - prompt: contract_v1.phase1.en.txt
//   - registry: registry.circle-basic.phase1.json
//   - sanitize + guard (hard-stop if invalid)
//   - (本地时) writes requests/<runId>/02_phase1_raw.json, 02_phase1_clean.json
//
// Phase 2: ask LLM for implementation (block / hook) using locked Phase 1 spec
//   - prompt: contract_v1.phase2.en.txt
//   - registry: registry.circle-basic.phase2.json
//   - validate phase2 doesn't mutate text/if/list/gradle, and block/hook obey rules
//   - (本地时) writes 03_phase2_raw.json and 03_phase2_plan.json (or plan-violations.json)
//
// Also writes token usage to (本地时) 01_usage.json
//
// IMPORTANT:
// - In serverless / Vercel (process.env.VERCEL is set), we DO NOT write to disk.
//   We just return all data in-memory (plan, usage, debug, etc.).
//
// - We export BOTH orchestrateTwoPhase() (new) and orchestrate() (compat).
//   orchestrate(req) just calls orchestrateTwoPhase(req), so existing code keeps working.

import fsOrig from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

import registryP1 from "@/lib/ndjc/anchors/registry.circle-basic.phase1.json";
import registryP2 from "@/lib/ndjc/anchors/registry.circle-basic.phase2.json";

/* ----------------- types ----------------- */

type ChatRole = "system" | "user";
type ChatMessage = { role: ChatRole; content: string };

type PhaseUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
};

type UsageReport = {
  runId: string;
  phase1?: PhaseUsage | null;
  phase2?: PhaseUsage | null;
  total_tokens_all_phases: number;
  timestamp_utc: string;
};

type Phase1Result = {
  raw: any;          // raw LLM json (parsed)
  clean: any;        // sanitized & guarded config spec
  runId: string;     // final runId
  usage: PhaseUsage; // usage from LLM / approx
};

type Phase2Result = {
  raw: any;          // raw LLM json (parsed)
  final: any | null; // validated merged plan or null if invalid
  violations: string[];
  usage: PhaseUsage;
};

const PKG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const PERM_REGEX = /^android\.permission\.[A-Z_]+$/;
const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2,3})?$/;

/* =========================================================
 * PUBLIC EXPORTS
 * =======================================================*/

// helper: decide if we can write to local disk
function canWriteToDisk() {
  // On Vercel / serverless this is typically set, and FS is read-only / ephemeral.
  if (process.env.VERCEL) return false;
  return true;
}

// New main entrypoint
export async function orchestrateTwoPhase(req: NdjcRequest) {
  // 1. Phase 1 (config spec)
  const phase1 = await runPhase1(req);

  // ---- persist phase1 output IF AND ONLY IF we can write ----
  let runDir = "";
  if (canWriteToDisk()) {
    const baseDir = process.env.NDJC_REQUESTS_DIR || path.join(process.cwd(), "requests");
    runDir = path.join(baseDir, phase1.runId);

    await fs.mkdir(runDir, { recursive: true });

    await fs.writeFile(
      path.join(runDir, "02_phase1_raw.json"),
      JSON.stringify(phase1.raw, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "02_phase1_clean.json"),
      JSON.stringify(phase1.clean, null, 2),
      "utf8"
    );
  }

  // 2. Phase 2 (implementation)
  const phase2 = await runPhase2(req, phase1.clean, phase1.runId);

  // ---- persist phase2 output IF AND ONLY IF we can write ----
  if (canWriteToDisk()) {
    // runDir already computed above
    await fs.writeFile(
      path.join(runDir, "03_phase2_raw.json"),
      JSON.stringify(phase2.raw, null, 2),
      "utf8"
    );

    if (phase2.final) {
      await fs.writeFile(
        path.join(runDir, "03_phase2_plan.json"),
        JSON.stringify(phase2.final, null, 2),
        "utf8"
      );
    } else {
      const vioPayload = {
        errors: phase2.violations,
        note: "Phase2 validation failed. No 03_phase2_plan.json emitted.",
      };
      await fs.writeFile(
        path.join(runDir, "plan-violations.json"),
        JSON.stringify(vioPayload, null, 2),
        "utf8"
      );
    }
  }

  // 3. token usage report (this we ALWAYS compute in memory)
  const usageReport: UsageReport = {
    runId: phase1.runId,
    phase1: phase1.usage,
    phase2: phase2.usage,
    total_tokens_all_phases:
      (phase1.usage?.total_tokens ?? 0) +
      (phase2.usage?.total_tokens ?? 0),
    timestamp_utc: new Date().toISOString(),
  };

  // ---- persist usage report IF AND ONLY IF we can write ----
  if (canWriteToDisk()) {
    const baseDir = process.env.NDJC_REQUESTS_DIR || path.join(process.cwd(), "requests");
    const runDir2 = path.join(baseDir, phase1.runId);
    await fs.writeFile(
      path.join(runDir2, "01_usage.json"),
      JSON.stringify(usageReport, null, 2),
      "utf8"
    );
  }

  // 4. Return for caller (API / CLI / etc.)
  //    We *also* include debug info so frontend can treat it like build log
  return {
    ok: !!phase2.final,
    runId: phase1.runId,

    // ready-to-materialize final plan (block/hook + locked text/if/list/gradle)
    plan: phase2.final,

    // locked phase1 spec (text/if/list/gradle) for introspection
    phase1Spec: phase1.clean,

    // if validation failed, list why
    violations: phase2.final ? [] : phase2.violations,

    // token usage etc.
    usage: usageReport,

    // debug bundle replacing on-disk logs in serverless mode
    debug: {
      phase1Raw: phase1.raw,
      phase1Clean: phase1.clean,
      phase2Raw: phase2.raw,
    },
  };
}

// Legacy entrypoint for backwards compatibility.
// This lets existing code that does `import { orchestrate }` keep working.
export async function orchestrate(req: NdjcRequest) {
  return orchestrateTwoPhase(req);
}

/* =========================================================
 * Phase1
 * =======================================================*/
async function runPhase1(req: NdjcRequest): Promise<Phase1Result> {
  const templateKey = req.template_key ?? "circle-basic";
  const userNeed = (req.requirement ?? "").trim();

  // Build skeleton for phase1: text / if / list / gradle
  const skeletonP1 = buildSkeletonPhase1(registryP1);
  const skeletonJson = stableStringify(skeletonP1);

  // Build schema fragment
  const schemaFragP1 = buildSchemaFragmentPhase1(registryP1);
  const schemaFragJson = stableStringify(schemaFragP1);

  // Read phase1 prompt text
  const promptPath = path.join(
    process.cwd(),
    "lib/ndjc/prompts/contract_v1.phase1.en.txt"
  );
  const promptText = await fs.readFile(promptPath, "utf8");

  // Inject placeholders
  const injectedPrompt = injectPromptPlaceholders(promptText, {
    SKELETON_JSON: skeletonJson,
    SCHEMA_FRAGMENT: schemaFragJson,
    PLACEHOLDER_BLACKLIST: JSON.stringify(
      registryP1.placeholderBlacklist ?? []
    ),
    USER_NEED: userNeed,
    PHASE1_SPEC_JSON: "", // not used yet in phase1
  });

  // System message for phase1
  const sysHeader =
    "You are NDJC Phase 1. Output config only (text/if/list/gradle). Do NOT output block/hook.\n" +
    'Return EXACTLY ONE valid JSON object with top-level keys "metadata","anchorsGrouped","files" in that order.\n' +
    '"files" MUST be [].\n' +
    "No markdown fences. No commentary.";

  const msgs: ChatMessage[] = [
    { role: "system", content: sysHeader + "\n" + injectedPrompt },
    { role: "user", content: userNeed },
  ];

  const { text: llmText, usage } = await runGroqChat(msgs);

  // Parse LLM JSON
  const phase1Raw = parseAndEnsureTopLevel(llmText);

  // Sanitize & guard
  const phase1Clean = sanitizePhase1(phase1Raw, registryP1, templateKey);

  // Determine runId
  const runId =
    phase1Clean?.metadata?.["NDJC:BUILD_META:RUNID"] ||
    phase1Clean?.anchorsGrouped?.text?.["NDJC:BUILD_META:RUNID"] ||
    `run_${genDateStamp()}_000`;

  // force runId back into spec for consistency
  phase1Clean.metadata = phase1Clean.metadata || {};
  phase1Clean.metadata["NDJC:BUILD_META:RUNID"] = runId;

  if (!phase1Clean.anchorsGrouped?.text) {
    phase1Clean.anchorsGrouped.text = {};
  }
  phase1Clean.anchorsGrouped.text["NDJC:BUILD_META:RUNID"] = runId;

  // Final guard (throws if still invalid)
  guardPhase1(phase1Clean, registryP1);

  return {
    raw: phase1Raw,
    clean: phase1Clean,
    runId,
    usage,
  };
}

/* =========================================================
 * Phase2
 * =======================================================*/
async function runPhase2(
  req: NdjcRequest,
  phase1Clean: any,
  runId: string
): Promise<Phase2Result> {
  const userNeed = (req.requirement ?? "").trim();

  // Skeleton for phase2:
  // text/if/list/gradle are pre-filled from phase1Clean (locked),
  // and block/hook are empty.
  const skeletonP2 = buildSkeletonPhase2(registryP2, phase1Clean);
  const skeletonJson = stableStringify(skeletonP2);

  // Schema fragment for phase2
  const schemaFragP2 = buildSchemaFragmentPhase2(registryP2);
  const schemaFragJson = stableStringify(schemaFragP2);

  // Read phase2 prompt text
  const promptPath = path.join(
    process.cwd(),
    "lib/ndjc/prompts/contract_v1.phase2.en.txt"
  );
  const promptText = await fs.readFile(promptPath, "utf8");

  // Inject placeholders (phase2 gets PHASE1_SPEC_JSON)
  const injectedPrompt = injectPromptPlaceholders(promptText, {
    SKELETON_JSON: skeletonJson,
    SCHEMA_FRAGMENT: schemaFragJson,
    PLACEHOLDER_BLACKLIST: JSON.stringify(
      registryP2.placeholderBlacklist ?? []
    ),
    USER_NEED: userNeed,
    PHASE1_SPEC_JSON: stableStringify(phase1Clean),
  });

  const sysHeader =
    "You are NDJC Phase 2. You ONLY fill block/hook. You MUST NOT modify text/if/list/gradle from PHASE1_SPEC_JSON.\n" +
    'Return EXACTLY ONE valid JSON object with top-level keys "metadata","anchorsGrouped","files" in that order.\n' +
    '"files" MUST be [].\n' +
    "No markdown fences. No commentary.";

  const msgs: ChatMessage[] = [
    { role: "system", content: sysHeader + "\n" + injectedPrompt },
    { role: "user", content: userNeed },
  ];

  const { text: llmText, usage } = await runGroqChat(msgs);

  // Parse LLM JSON for phase2
  const phase2Raw = parseAndEnsureTopLevel(llmText);

  // Validate and merge
  const { final, violations } = validatePhase2(
    phase2Raw,
    phase1Clean,
    registryP2
  );

  return {
    raw: phase2Raw,
    final,
    violations,
    usage,
  };
}

/* =========================================================
 * runGroqChat wrapper with usage extraction
 * =======================================================*/
async function runGroqChat(
  msgs: ChatMessage[]
): Promise<{ text: string; usage: PhaseUsage }> {
  // We assume callGroqChat(msgs) returns either a string or something like {text, usage}.
  const r: any = await callGroqChat(msgs);

  // Extract text
  const text =
    typeof r === "string"
      ? r
      : typeof r?.text === "string"
      ? r.text
      : // if your groqChat returns OpenAI-style, adapt here:
        (r?.choices?.[0]?.message?.content as string) ||
        "";

  // crude fallback usage if provider doesn't return usage tokens
  const promptJoined = msgs.map((m) => m.content).join("\n");
  const approxTokens = (s: string) => Math.ceil((s ?? "").length / 4);
  const promptTok = (r?.usage?.prompt_tokens as number) ?? approxTokens(promptJoined);
  const completionTok = (r?.usage?.completion_tokens as number) ?? approxTokens(text);
  const totalTok = (r?.usage?.total_tokens as number) ?? (promptTok + completionTok);

  const usage: PhaseUsage = {
    prompt_tokens: promptTok,
    completion_tokens: completionTok,
    total_tokens: totalTok,
    model: (r?.usage?.model as string) ?? "gpt-5-thinking",
  };

  return { text, usage };
}

/* =========================================================
 * Skeleton builders
 * =======================================================*/

// Phase1 skeleton only has config groups
function buildSkeletonPhase1(regP1: any) {
  const metadata: Record<string, any> = {
    "NDJC:BUILD_META:RUNID": "",
  };

  const gText: Record<string, any> = {};
  (regP1.text ?? []).forEach((k: string) => {
    gText[k] = "";
  });

  const gIf: Record<string, any> = {};
  (regP1.if ?? []).forEach((k: string) => {
    gIf[k] = false;
  });

  const gList: Record<string, any> = {};
  (regP1.list ?? []).forEach((k: string) => {
    gList[k]]`;
