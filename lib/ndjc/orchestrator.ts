// lib/ndjc/orchestrator.ts
//
// NDJC two-phase orchestrator (token-slimmed prompts)
//
// Phase 1: ask LLM for config spec only (text / list / if / gradle)
// Phase 2: ask LLM for implementation (block / hook) using locked Phase 1 spec
//
// Slim version goals:
// - We STOP blasting huge prompt walls.
// - We ONLY send minimal hard rules + skeleton + need.
// - We capture per-phase raw / checked / usage so the API+CI can write debug logs.
//
// RUNTIME BEHAVIOR:
// - If process.env.VERCEL is set => treat FS as read-only, DO NOT write to disk.
// - Otherwise (local runner) we persist debug artifacts into requests/<runId>/.
//
// PUBLIC API:
//   orchestrateTwoPhase(req: NdjcRequest)
//   orchestrate(req: NdjcRequest)   // alias
//
// RETURN SHAPE (IMPORTANT for route.ts and CI):
// {
//   ok: boolean,
//   runId: string,
//
//   // high-level build info
//   plan: any | null,          // merged final plan (phase2_checked if valid, else null)
//   phase1Spec: any,           // phase1_checked
//   violations: string[],      // phase2 validation failures
//
//   // phase1 / phase2 debug
//   phase1_raw: any,
//   phase1_checked: any,
//   phase1_issues: string[],   // currently [] (we hard-throw instead of soft-warn in guardPhase1)
//
//   phase2_raw: any,
//   phase2_checked: any | null,
//   phase2_issues: string[],   // same as violations
//
//   usage: {
//     phase1_in: number,
//     phase1_out: number,
//     phase1_total: number,
//     phase2_in: number,
//     phase2_out: number,
//     phase2_total: number,
//     total_in: number,
//     total_out: number,
//     total: number,
//     model_phase1: string,
//     model_phase2: string,
//     timestamp_utc: string,
//   },
//
//   trace: { ...same debug fields duplicated for convenience ... }
// }

import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

import registryP1 from "@/lib/ndjc/anchors/registry.circle-basic.phase1.json";
import registryP2 from "@/lib/ndjc/anchors/registry.circle-basic.phase2.json";

/* ----------------- core regex helpers ----------------- */

const PKG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const PERM_REGEX = /^android\.permission\.[A-Z_]+$/;
const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2,3})?$/;

/* ----------------- usage reporting types ----------------- */

type ChatRole = "system" | "user";
type ChatMessage = { role: ChatRole; content: string };

type PhaseUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
};

type Phase1Result = {
  runId: string;
  phase1_raw: any;
  phase1_checked: any;
  phase1_issues: string[]; // keep array for symmetry (guardPhase1 throws instead of collecting)
  usage: PhaseUsage;
};

type Phase2Result = {
  phase2_raw: any;
  phase2_checked: any | null;
  phase2_issues: string[];
  usage: PhaseUsage;
};

/* =========================================================
 * PUBLIC EXPORTS
 * =======================================================*/

function canWriteToDisk() {
  // Vercel serverless FS is effectively read-only
  if (process.env.VERCEL) return false;
  return true;
}

export async function orchestrateTwoPhase(req: NdjcRequest) {
  // ---------- Phase 1 ----------
  const p1 = await runPhase1(req);

  // ---------- Phase 2 ----------
  const p2 = await runPhase2(req, p1.phase1_checked);

  // ---------- usage summary for route.ts / CI ----------
  const usageSummary = buildUsageSummary(p1.usage, p2.usage);

  // ---------- maybe persist locally (dev env only) ----------
  if (canWriteToDisk()) {
    const baseDir =
      process.env.NDJC_REQUESTS_DIR || path.join(process.cwd(), "requests");
    const runDir = path.join(baseDir, p1.runId);
    await fs.mkdir(runDir, { recursive: true });

    // per-phase raw/checked
    await fs.writeFile(
      path.join(runDir, "00_phase1_raw.json"),
      JSON.stringify(
        { runId: p1.runId, stage: "phase1", kind: "raw", data: p1.phase1_raw },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "00_phase1_checked.json"),
      JSON.stringify(
        {
          runId: p1.runId,
          stage: "phase1",
          kind: "checked",
          data: p1.phase1_checked,
          issues: p1.phase1_issues,
        },
        null,
        2
      ),
      "utf8"
    );

    await fs.writeFile(
      path.join(runDir, "00_phase2_raw.json"),
      JSON.stringify(
        { runId: p1.runId, stage: "phase2", kind: "raw", data: p2.phase2_raw },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "00_phase2_checked.json"),
      JSON.stringify(
        {
          runId: p1.runId,
          stage: "phase2",
          kind: "checked",
          data: p2.phase2_checked,
          issues: p2.phase2_issues,
        },
        null,
        2
      ),
      "utf8"
    );

    // combined quick look
    const debugTwoPhase = {
      runId: p1.runId,
      timestamp: new Date().toISOString(),
      phase1: {
        raw: p1.phase1_raw,
        checked: p1.phase1_checked,
        issues: p1.phase1_issues,
      },
      phase2: {
        raw: p2.phase2_raw,
        checked: p2.phase2_checked,
        issues: p2.phase2_issues,
      },
      usage: usageSummary,
    };
    await fs.writeFile(
      path.join(runDir, "00_debug_two_phase.json"),
      JSON.stringify(debugTwoPhase, null, 2),
      "utf8"
    );

    // token breakdown
    await fs.writeFile(
      path.join(runDir, "00_token_usage.json"),
      JSON.stringify(usageSummary, null, 2),
      "utf8"
    );

    // also expose final contract/plan shape like old flow did (02_/03_...)
    await fs.writeFile(
      path.join(runDir, "01_contract.json"),
      JSON.stringify(p1.phase1_checked, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "02_plan.json"),
      JSON.stringify(p2.phase2_checked ?? {}, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(runDir, "03_apply_result.json"),
      JSON.stringify(
        {
          status: p2.phase2_checked ? "ok" : "invalid",
          note: p2.phase2_checked
            ? "ready for materialize"
            : "phase2 validation failed, see issues",
          issues: p2.phase2_issues,
        },
        null,
        2
      ),
      "utf8"
    );
  }

  // ---------- final API return ----------
  const ok = !!p2.phase2_checked;
  const mergedPlan = p2.phase2_checked; // final usable plan if ok, else null

  return {
    ok,
    runId: p1.runId,

    // high-level
    plan: mergedPlan,
    phase1Spec: p1.phase1_checked,
    violations: p2.phase2_issues,

    // debug blobs for route.ts (will get written to GH)
    phase1_raw: p1.phase1_raw,
    phase1_checked: p1.phase1_checked,
    phase1_issues: p1.phase1_issues,
    phase2_raw: p2.phase2_raw,
    phase2_checked: p2.phase2_checked,
    phase2_issues: p2.phase2_issues,

    // usage summary
    usage: usageSummary,

    // trace (compat with older route.ts expectations)
    trace: {
      phase1_raw: p1.phase1_raw,
      phase1_checked: p1.phase1_checked,
      phase1_issues: p1.phase1_issues,
      phase2_raw: p2.phase2_raw,
      phase2_checked: p2.phase2_checked,
      phase2_issues: p2.phase2_issues,
      usage: usageSummary,
    },
  };
}

// legacy alias
export async function orchestrate(req: NdjcRequest) {
  return orchestrateTwoPhase(req);
}

/* =========================================================
 * PHASE 1  (SLIM PROMPT)
 * =======================================================*/

async function runPhase1(req: NdjcRequest): Promise<Phase1Result> {
  const templateKey = req.template_key ?? "circle-basic";
  const userNeed = (req.requirement ?? "").trim();

  // skeleton + schema core
  const skeletonP1 = buildSkeletonPhase1(registryP1);
  const schemaCoreP1 = buildSchemaCorePhase1(registryP1);

  const sysHeaderPhase1 = [
    "You are NDJC Phase 1.",
    "Goal: Produce EXACTLY ONE valid JSON object and NOTHING ELSE.",
    "",
    'Top-level keys in this exact order: "metadata" -> "anchorsGrouped" -> "files".',
    '"files" MUST be an empty array [].',
    "",
    'anchorsGrouped MUST contain ONLY "text","list","if","gradle".',
    'DO NOT output "block" or "hook" in Phase1.',
    "",
    "You MUST fill every anchor in skeletonPhase1.",
    "Use correct JSON types (booleans true/false, arrays [], objects {}).",
    "Package/applicationId must match ^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$ .",
    "gradle.permissions must include android.permission.INTERNET and only android.permission.*.",
    "gradle.resConfigs must be locale tags like en or zh-rCN.",
    "LIST:ROUTES must have >=1 valid route id like 'home' (^[a-z][a-z0-9_-]*$).",
    "NDJC:BUILD_META:RUNID must match ^run_[0-9]{8}_[0-9]{3}$.",
    "",
    "NEVER output placeholders (lorem, tbd, n/a, ready...).",
    "Return ONLY JSON (no markdown fences).",
  ].join("\n");

  const userMsgPhase1Obj = {
    need: userNeed,
    skeletonPhase1: skeletonP1,
    schemaCorePhase1: schemaCoreP1,
  };
  const userMsgPhase1 = stableStringify(userMsgPhase1Obj);

  const msgs: ChatMessage[] = [
    { role: "system", content: sysHeaderPhase1 },
    { role: "user", content: userMsgPhase1 },
  ];

  const { text: llmText, usage } = await runGroqChat(msgs);

  // raw JSON from model
  const rawJson = parseAndEnsureTopLevel(llmText);

  // normalize / sanitize
  const checked = sanitizePhase1(rawJson, registryP1, templateKey);

  // derive runId and enforce guard
  const runIdGuess =
    checked?.metadata?.["NDJC:BUILD_META:RUNID"] ||
    checked?.anchorsGrouped?.text?.["NDJC:BUILD_META:RUNID"] ||
    `run_${genDateStamp()}_000`;

  if (!checked.metadata) checked.metadata = {};
  checked.metadata["NDJC:BUILD_META:RUNID"] = runIdGuess;

  if (!checked.anchorsGrouped) checked.anchorsGrouped = {};
  if (!checked.anchorsGrouped.text) checked.anchorsGrouped.text = {};
  checked.anchorsGrouped.text["NDJC:BUILD_META:RUNID"] = runIdGuess;

  // guard throws on invalid -> if it doesn't throw, no issues
  guardPhase1(checked, registryP1);

  return {
    runId: runIdGuess,
    phase1_raw: rawJson,
    phase1_checked: checked,
    phase1_issues: [], // guardPhase1() throws instead of collecting
    usage,
  };
}

/* =========================================================
 * PHASE 2 (SLIM PROMPT)
 * =======================================================*/

async function runPhase2(
  req: NdjcRequest,
  phase1Clean: any
): Promise<Phase2Result> {
  const userNeed = (req.requirement ?? "").trim();

  // skeleton2 with locked text/list/if/gradle + empty block/hook
  const skeletonP2 = buildSkeletonPhase2(registryP2, phase1Clean);

  // lockedSpec (must not change)
  const lockedSpec = {
    metadata: phase1Clean?.metadata || {},
    anchorsGrouped: {
      text: phase1Clean?.anchorsGrouped?.text || {},
      list: phase1Clean?.anchorsGrouped?.list || {},
      if: phase1Clean?.anchorsGrouped?.if || {},
      gradle: phase1Clean?.anchorsGrouped?.gradle || {},
    },
  };

  const sysHeaderPhase2 = [
    "You are NDJC Phase 2.",
    "Goal: Produce EXACTLY ONE valid JSON object and NOTHING ELSE.",
    "",
    'Top-level keys in this exact order: "metadata" -> "anchorsGrouped" -> "files".',
    '"files" MUST be an empty array [].',
    "",
    'anchorsGrouped MUST contain ALL groups: "text","list","if","gradle","block","hook".',
    "",
    "CRITICAL LOCK RULE:",
    "You MUST copy text/list/if/gradle EXACTLY from lockedSpec. DO NOT MODIFY them.",
    "You MUST fill EVERY key in anchorsGrouped.block and anchorsGrouped.hook in skeletonPhase2.",
    "",
    "BLOCK RULES:",
    "- Each block value: Jetpack Compose snippet string (@Composable ... Text(...), Column{ }, Row{ } ...).",
    "- It must be > ~40 chars of plausible Compose UI code, not just a label.",
    "- No placeholders like lorem/tbd/n/a/ready/etc.",
    "",
    "HOOK RULES:",
    '- Each hook value must be "noop", a short string like "gradle_task:uploadMedia",',
    '  or a small object { "type": "...", "value": "..." }.',
    "",
    "RETURN RULES:",
    "Return ONLY JSON. No commentary, no markdown fences.",
  ].join("\n");

  const userMsgPhase2Obj = {
    need: userNeed,
    lockedSpec,
    skeletonPhase2: skeletonP2,
  };
  const userMsgPhase2 = stableStringify(userMsgPhase2Obj);

  const msgs: ChatMessage[] = [
    { role: "system", content: sysHeaderPhase2 },
    { role: "user", content: userMsgPhase2 },
  ];

  const { text: llmText, usage } = await runGroqChat(msgs);

  // model raw
  const rawJson = parseAndEnsureTopLevel(llmText);

  // validate & merge with locked groups
  const { final, violations } = validatePhase2(rawJson, phase1Clean, registryP2);

  return {
    phase2_raw: rawJson,
    phase2_checked: final,
    phase2_issues: violations,
    usage,
  };
}

/* =========================================================
 * LLM CALL WRAPPER
 * =======================================================*/

async function runGroqChat(
  msgs: ChatMessage[]
): Promise<{ text: string; usage: PhaseUsage }> {
  const r: any = await callGroqChat(msgs);

  // unify text extraction
  const text =
    typeof r === "string"
      ? r
      : typeof r?.text === "string"
      ? r.text
      : (r?.choices?.[0]?.message?.content as string) || "";

  // fallback approximate token usage
  const concatPrompt = msgs.map((m) => m.content).join("\n");
  const approxTokens = (s: string) => Math.ceil((s ?? "").length / 4);

  const promptTok =
    (r?.usage?.prompt_tokens as number) ?? approxTokens(concatPrompt);
  const completionTok =
    (r?.usage?.completion_tokens as number) ?? approxTokens(text);
  const totalTok =
    (r?.usage?.total_tokens as number) ?? promptTok + completionTok;

  const usage: PhaseUsage = {
    prompt_tokens: promptTok,
    completion_tokens: completionTok,
    total_tokens: totalTok,
    model: (r?.usage?.model as string) ?? "gpt-5-thinking",
  };

  return { text, usage };
}

/* helper to summarize two PhaseUsage blocks into what route.ts / CI expects */
function buildUsageSummary(p1: PhaseUsage, p2: PhaseUsage) {
  const phase1_in = p1?.prompt_tokens ?? 0;
  const phase1_out = p1?.completion_tokens ?? 0;
  const phase1_total = p1?.total_tokens ?? phase1_in + phase1_out;

  const phase2_in = p2?.prompt_tokens ?? 0;
  const phase2_out = p2?.completion_tokens ?? 0;
  const phase2_total = p2?.total_tokens ?? phase2_in + phase2_out;

  const total_in = phase1_in + phase2_in;
  const total_out = phase1_out + phase2_out;
  const total = phase1_total + phase2_total;

  return {
    phase1_in,
    phase1_out,
    phase1_total,
    phase2_in,
    phase2_out,
    phase2_total,
    total_in,
    total_out,
    total,
    model_phase1: p1?.model ?? "unknown",
    model_phase2: p2?.model ?? "unknown",
    timestamp_utc: new Date().toISOString(),
  };
}

/* =========================================================
 * SKELETON BUILDERS
 * =======================================================*/

function buildSkeletonPhase1(regP1: any) {
  const metadata: Record<string, any> = {
    "NDJC:BUILD_META:RUNID": "",
  };

  const gText: Record<string, any> = {};
  (regP1.text ?? []).forEach((k: string) => {
    gText[k] = "";
  });

  const gList: Record<string, any> = {};
  (regP1.list ?? []).forEach((k: string) => {
    gList[k] = [];
  });

  const gIf: Record<string, any> = {};
  (regP1.if ?? []).forEach((k: string) => {
    gIf[k] = false;
  });

  const gGradle: Record<string, any> = {
    applicationId: "",
    resConfigs: [],
    permissions: [],
  };

  return {
    metadata,
    anchorsGrouped: {
      text: gText,
      list: gList,
      if: gIf,
      gradle: gGradle,
    },
    files: [],
  };
}

// lock text/list/if/gradle from phase1; create empty block/hook
function buildSkeletonPhase2(regP2: any, phase1Clean: any) {
  const locked = phase1Clean?.anchorsGrouped || {};

  const gText = { ...(locked.text || {}) };
  const gList = { ...(locked.list || {}) };
  const gIf = { ...(locked.if || {}) };
  const gGradle = { ...(locked.gradle || {}) };

  const gBlock: Record<string, any> = {};
  (regP2.block ?? []).forEach((k: string) => {
    gBlock[k] = "";
  });

  const gHook: Record<string, any> = {};
  (regP2.hook ?? []).forEach((k: string) => {
    gHook[k] = "noop";
  });

  const metadata: Record<string, any> = {
    "NDJC:BUILD_META:RUNID":
      phase1Clean?.metadata?.["NDJC:BUILD_META:RUNID"] || "",
  };

  return {
    metadata,
    anchorsGrouped: {
      text: gText,
      list: gList,
      if: gIf,
      gradle: gGradle,
      block: gBlock,
      hook: gHook,
    },
    files: [],
  };
}

/* =========================================================
 * PHASE1 "SCHEMA CORE"
 * (only constraints we truly enforce in guardPhase1)
 * =======================================================*/

function buildSchemaCorePhase1(regP1: any) {
  const runIdRule = "^run_[0-9]{8}_[0-9]{3}$";
  const pkgRule = "^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$";
  const httpsRule = "^https://[\\w.-]+(:\\d+)?(/.*)?$";
  const routeRule = "^[a-z][a-z0-9_-]*$";
  const localeRule = "^[a-z]{2}(-r[A-Z]{2,3})?$";
  const permRule = "^android\\.permission\\.[A-Z_]+$";

  const required = regP1.required ?? {};

  return {
    required,
    valueFormatCore: {
      "NDJC:BUILD_META:RUNID": { regex: runIdRule },
      "NDJC:PACKAGE_NAME": { regex: pkgRule },
      "NDJC:DATA_SOURCE": { regex: httpsRule },
      "LIST:ROUTES": { itemRegex: routeRule, minItems: 1 },
      "gradle.applicationId": { regex: pkgRule },
      "gradle.resConfigs": { itemRegex: localeRule, minItems: 1 },
      "gradle.permissions": { itemRegex: permRule, minItems: 1 },
    },
    notes: [
      "gradle.permissions must include android.permission.INTERNET.",
      "gradle.resConfigs must contain at least one valid locale like en or zh-rCN.",
    ],
  };
}

/* =========================================================
 * SANITIZE + GUARD PHASE1
 * =======================================================*/

function sanitizePhase1(rawJson: any, _regP1: any, templateKey: string) {
  const out: any = {
    metadata: rawJson.metadata || {},
    anchorsGrouped: rawJson.anchorsGrouped || {},
    files: [],
  };

  out.anchorsGrouped.text = out.anchorsGrouped.text || {};
  out.anchorsGrouped.list = out.anchorsGrouped.list || {};
  out.anchorsGrouped.if = out.anchorsGrouped.if || {};
  out.anchorsGrouped.gradle = out.anchorsGrouped.gradle || {};

  // normalize IF group booleans
  for (const k of Object.keys(out.anchorsGrouped.if)) {
    out.anchorsGrouped.if[k] = toBool(out.anchorsGrouped.if[k]);
  }

  // THEME_COLORS / STRINGS_EXTRA to proper objects
  if (out.anchorsGrouped.text["NDJC:THEME_COLORS"] !== undefined) {
    out.anchorsGrouped.text["NDJC:THEME_COLORS"] = normalizeJsonObject(
      out.anchorsGrouped.text["NDJC:THEME_COLORS"],
      { primary: "#7C3AED", secondary: "#10B981" }
    );
  }
  if (out.anchorsGrouped.text["NDJC:STRINGS_EXTRA"] !== undefined) {
    out.anchorsGrouped.text["NDJC:STRINGS_EXTRA"] = normalizeJsonObject(
      out.anchorsGrouped.text["NDJC:STRINGS_EXTRA"],
      {}
    );
  }

  // gradle.applicationId / resConfigs / permissions cleanup
  const g = out.anchorsGrouped.gradle;
  g.applicationId = ensurePkg(
    g.applicationId ||
      out.anchorsGrouped.text["NDJC:PACKAGE_NAME"] ||
      "com.example.ndjc"
  );

  let resCfgs: string[] = Array.isArray(g.resConfigs)
    ? g.resConfigs.map(String)
    : [];
  resCfgs = resCfgs.filter((x: string) => LOCALE_ITEM.test(x));
  if (!resCfgs.length) resCfgs = ["en"];
  g.resConfigs = resCfgs;

  let perms: string[] = Array.isArray(g.permissions)
    ? g.permissions.map(String)
    : [];
  perms = perms.filter((p: string) => PERM_REGEX.test(p));
  if (!perms.length) perms = ["android.permission.INTERNET"];
  g.permissions = perms;

  // metadata normalization
  out.metadata.template =
    templateKey || out.metadata.template || "circle-basic";
  out.metadata.appName =
    out.metadata.appName ||
    out.anchorsGrouped.text["NDJC:APP_LABEL"] ||
    "NDJC App";
  out.metadata.packageId = g.applicationId;
  out.metadata.mode = rawJson?.metadata?.mode === "B" ? "B" : "A";

  return out;
}

function guardPhase1(clean: any, _regP1: any) {
  if (!clean.anchorsGrouped || typeof clean.anchorsGrouped !== "object") {
    throw new Error("Phase1 guard: anchorsGrouped missing/invalid");
  }

  const rid =
    clean.metadata?.["NDJC:BUILD_META:RUNID"] ||
    clean.anchorsGrouped?.text?.["NDJC:BUILD_META:RUNID"];
  if (rid && !/^run_[0-9]{8}_[0-9]{3}$/.test(rid)) {
    throw new Error(
      `Phase1 guard: RUNID invalid (${rid}). Must match ^run_YYYYMMDD_NNN$`
    );
  }

  const appId = clean.anchorsGrouped.gradle?.applicationId;
  if (!appId || !PKG_REGEX.test(appId)) {
    throw new Error(
      `Phase1 guard: gradle.applicationId invalid (${appId})`
    );
  }

  const routes = clean.anchorsGrouped.list?.["LIST:ROUTES"];
  if (
    !Array.isArray(routes) ||
    routes.length === 0 ||
    !routes.every((r: any) => /^[a-z][a-z0-9_-]*$/.test(String(r)))
  ) {
    throw new Error("Phase1 guard: LIST:ROUTES invalid or empty");
  }
}

/* =========================================================
 * VALIDATE / MERGE PHASE2
 * =======================================================*/

function validatePhase2(
  phase2Raw: any,
  phase1Clean: any,
  _regP2: any
): { final: any | null; violations: string[] } {
  const violations: string[] = [];

  if (
    !phase2Raw ||
    typeof phase2Raw !== "object" ||
    !phase2Raw.anchorsGrouped
  ) {
    return {
      final: null,
      violations: ["Phase2: anchorsGrouped missing or not object"],
    };
  }

  const locked = phase1Clean.anchorsGrouped || {};
  const got = phase2Raw.anchorsGrouped || {};

  // locked groups must match exactly
  const groupsToLock = ["text", "list", "if", "gradle"] as const;
  for (const g of groupsToLock) {
    const beforeStr = stableStringify(locked[g] || {});
    const afterStr = stableStringify(got[g] || {});
    if (beforeStr !== afterStr) {
      violations.push(`Phase2: group "${g}" was modified`);
    }
  }

  // require block/hook
  if (!got.block || typeof got.block !== "object") {
    violations.push("Phase2: block group missing/invalid");
  }
  if (!got.hook || typeof got.hook !== "object") {
    violations.push("Phase2: hook group missing/invalid");
  }

  // block validation
  if (got.block) {
    for (const [rawName, rawVal] of Object.entries(got.block)) {
      const anchorName: string = String(rawName);
      const val: unknown = rawVal;

      if (typeof val !== "string" || val.trim().length < 10) {
        violations.push(
          `Phase2: block ${anchorName} too short or not string`
        );
        continue;
      }

      if (
        !/@Composable/.test(val) &&
        !/Text\(/.test(val) &&
        !/Column\(/.test(val) &&
        !/Row\(/.test(val)
      ) {
        violations.push(
          `Phase2: block ${anchorName} missing Compose UI calls`
        );
      }
    }
  }

  // hook validation
  if (got.hook) {
    for (const [rawName, rawVal] of Object.entries(got.hook)) {
      const anchorName: string = String(rawName);
      const val: unknown = rawVal;

      if (
        typeof val !== "string" &&
        !(val && typeof val === "object")
      ) {
        violations.push(
          `Phase2: hook ${anchorName} must be string or object`
        );
      }
    }
  }

  if (violations.length > 0) {
    return { final: null, violations };
  }

  // merge locked groups + new block/hook into final plan
  const merged = {
    metadata: {
      ...phase2Raw.metadata,
      "NDJC:BUILD_META:RUNID":
        phase1Clean.metadata?.["NDJC:BUILD_META:RUNID"],
    },
    anchorsGrouped: {
      text: locked.text || {},
      list: locked.list || {},
      if: locked.if || {},
      gradle: locked.gradle || {},
      block: got.block || {},
      hook: got.hook || {},
    },
    files: [],
  };

  return { final: merged, violations: [] };
}

/* =========================================================
 * LOW-LEVEL HELPERS
 * =======================================================*/

function parseAndEnsureTopLevel(text: string): any {
  if (!text) throw new Error("LLM returned empty text");

  // allow accidental ```json fences
  const fenced =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;

  const parsed = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("LLM output is not an object");
  }

  if (!("metadata" in parsed)) parsed.metadata = {};
  if (!("anchorsGrouped" in parsed)) parsed.anchorsGrouped = {};
  if (!("files" in parsed)) parsed.files = [];

  if (!parsed.anchorsGrouped || typeof parsed.anchorsGrouped !== "object") {
    parsed.anchorsGrouped = {};
  }
  if (!Array.isArray(parsed.files)) {
    parsed.files = [];
  }

  return parsed;
}

function stableStringify(obj: any) {
  return JSON.stringify(obj, null, 2);
}

function genDateStamp() {
  const d = new Date();
  const year = d.getUTCFullYear().toString().padStart(4, "0");
  const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const da = d.getUTCDate().toString().padStart(2, "0");
  return `${year}${mo}${da}`;
}

function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  if (
    ["true", "1", "yes", "y", "on", "enabled", "enable", "open", "是"].includes(
      s
    )
  )
    return true;
  if (
    [
      "false",
      "0",
      "no",
      "n",
      "off",
      "disabled",
      "disable",
      "close",
      "否",
    ].includes(s)
  )
    return false;
  return false;
}

function ensurePkg(v?: string, fallback = "com.example.ndjc") {
  let s = (v || "").trim().toLowerCase();
  s = s
    .replace(/[^a-z0-9_.]+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.+/g, ".");
  return PKG_REGEX.test(s) ? s : fallback;
}

function normalizeJsonObject(
  input: any,
  fallbackObj: Record<string, any>
) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input;
  }
  if (typeof input === "string") {
    try {
      const obj = JSON.parse(input);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return obj;
      }
    } catch {
      // ignore parse error
    }
  }
  return { ...fallbackObj };
}
