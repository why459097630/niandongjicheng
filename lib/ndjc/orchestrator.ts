// lib/ndjc/orchestrator.ts
//
// NDJC two-phase orchestrator (token-slimmed prompts)
//
// Phase 1: ask LLM for config spec only (text / list / if / gradle)
// Phase 2: ask LLM for implementation (block / hook) using locked Phase 1 spec
//
// Slim version goals:
// - We STOP blasting huge prompt walls (no giant contract_v1.phase1.en.txt / phase2 full text).
// - We STOP inlining giant schema fragments and repeating userNeed twice.
// - We ONLY send minimal hard rules + skeleton + (for phase1) critical schema + need.
//
// RUNTIME BEHAVIOR:
// - If process.env.VERCEL is set => treat FS as read-only, DO NOT write to disk.
// - Otherwise (local runner) we persist debug artifacts into requests/<runId>/.
//
// PUBLIC API:
//   orchestrateTwoPhase(req: NdjcRequest)
//   orchestrate(req: NdjcRequest)   // legacy alias
//
// RETURN SHAPE:
// {
//   ok: boolean,
//   runId: string,
//   plan: any | null,              // merged final contract (phase2)
//   phase1Spec: any,               // locked phase1 spec
//   violations: string[],          // if phase2 failed validation
//   usage: { ... },                // prompt/completion token approx per phase
//   debug: { phase1Raw, phase1Clean, phase2Raw }  // in-memory "build log"
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

type UsageReport = {
  runId: string;
  phase1?: PhaseUsage | null;
  phase2?: PhaseUsage | null;
  total_tokens_all_phases: number;
  timestamp_utc: string;
};

type Phase1Result = {
  raw: any;
  clean: any;
  runId: string;
  usage: PhaseUsage;
};

type Phase2Result = {
  raw: any;
  final: any | null;
  violations: string[];
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
  const phase1 = await runPhase1(req);

  // maybe persist Phase1 artifacts locally
  let runDir = "";
  if (canWriteToDisk()) {
    const baseDir =
      process.env.NDJC_REQUESTS_DIR || path.join(process.cwd(), "requests");
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

  // ---------- Phase 2 ----------
  const phase2 = await runPhase2(req, phase1.clean);

  // maybe persist Phase2
  if (canWriteToDisk()) {
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

  // ---------- usage summary ----------
  const usageReport: UsageReport = {
    runId: phase1.runId,
    phase1: phase1.usage,
    phase2: phase2.usage,
    total_tokens_all_phases:
      (phase1.usage?.total_tokens ?? 0) +
      (phase2.usage?.total_tokens ?? 0),
    timestamp_utc: new Date().toISOString(),
  };

  if (canWriteToDisk()) {
    const baseDir =
      process.env.NDJC_REQUESTS_DIR || path.join(process.cwd(), "requests");
    const runDir2 = path.join(baseDir, phase1.runId);
    await fs.writeFile(
      path.join(runDir2, "01_usage.json"),
      JSON.stringify(usageReport, null, 2),
      "utf8"
    );
  }

  return {
    ok: !!phase2.final,
    runId: phase1.runId,
    plan: phase2.final,
    phase1Spec: phase1.clean,
    violations: phase2.final ? [] : phase2.violations,
    usage: usageReport,
    debug: {
      phase1Raw: phase1.raw,
      phase1Clean: phase1.clean,
      phase2Raw: phase2.raw,
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

/**
 * We now build a SLIM system/user message pair.
 *
 * system: just the hard behavioral rules, compressed.
 * user:   one JSON blob bundling:
 *   - need (userNeed)
 *   - skeletonPhase1 (final desired shape / keys / groups for phase1)
 *   - schemaCorePhase1 (critical constraints that must pass guardPhase1)
 */
async function runPhase1(req: NdjcRequest): Promise<Phase1Result> {
  const templateKey = req.template_key ?? "circle-basic";
  const userNeed = (req.requirement ?? "").trim();

  // --- build skeleton (phase1)
  const skeletonP1 = buildSkeletonPhase1(registryP1);
  const skeletonPhase1Str = stableStringify(skeletonP1);

  // --- build minimal schema core for Phase1
  const schemaCoreP1 = buildSchemaCorePhase1(registryP1);
  const schemaCoreP1Str = stableStringify(schemaCoreP1);

  // SYSTEM MESSAGE (slim)
  const sysHeaderPhase1 = [
    "You are NDJC Phase 1.",
    "Goal: Produce EXACTLY ONE valid JSON object and NOTHING ELSE.",
    '',
    // Top-level contract shape
    'Top-level keys in this exact order: "metadata" -> "anchorsGrouped" -> "files".',
    '"files" MUST be an empty array [].',
    '',
    // Allowed groups for Phase1
    'anchorsGrouped MUST contain ONLY these groups: "text","list","if","gradle".',
    'DO NOT output "block" or "hook" in Phase1.',
    '',
    // Filling requirements
    "You MUST fill every anchor shown in skeletonPhase1.",
    "Use native JSON types: booleans as true/false (not strings), numbers as numbers (not strings).",
    "Objects must be real JSON objects, not stringified.",
    "URLs must be https:// when required.",
    "Package IDs must be valid Android package names (lowercase dot segments).",
    "Locale tags in gradle.resConfigs must match ^[a-z]{2}(-r[A-Z]{2,3})?$ such as 'en' or 'zh-rCN'.",
    "gradle.permissions must include at least 'android.permission.INTERNET' and only valid android.permission.* constants.",
    "LIST:ROUTES must contain at least one valid route id matching ^[a-z][a-z0-9_-]*$.",
    "NDJC:BUILD_META:RUNID must match ^run_[0-9]{8}_[0-9]{3}$.",
    '',
    // Forbidden placeholders
    "NEVER use placeholders/filler like: lorem, tbd, n/a, -, ready, content ready for rendering...",
    '',
    // Output discipline
    "Return ONLY the final JSON object, with correct key order.",
    "No markdown fences, no commentary, no backticks.",
  ].join("\n");

  // USER MESSAGE (all data for model to reason about)
  // We pack userNeed + skeletonPhase1 + schemaCorePhase1
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

  // parse + ensure structure
  const rawJson = parseAndEnsureTopLevel(llmText);

  // sanitize/normalize
  const clean = sanitizePhase1(rawJson, registryP1, templateKey);

  // unify runId
  const runIdGuess =
    clean?.metadata?.["NDJC:BUILD_META:RUNID"] ||
    clean?.anchorsGrouped?.text?.["NDJC:BUILD_META:RUNID"] ||
    `run_${genDateStamp()}_000`;

  if (!clean.metadata) clean.metadata = {};
  clean.metadata["NDJC:BUILD_META:RUNID"] = runIdGuess;

  if (!clean.anchorsGrouped) clean.anchorsGrouped = {};
  if (!clean.anchorsGrouped.text) clean.anchorsGrouped.text = {};
  clean.anchorsGrouped.text["NDJC:BUILD_META:RUNID"] = runIdGuess;

  // final guard
  guardPhase1(clean, registryP1);

  return {
    raw: rawJson,
    clean,
    runId: runIdGuess,
    usage,
  };
}

/* =========================================================
 * PHASE 2 (SLIM PROMPT)
 * =======================================================*/

/**
 * Phase2 slim prompt:
 *
 * system: strict rules for block/hook only.
 * user:   bundle:
 *   - need (userNeed)
 *   - lockedSpecFromPhase1 (text/list/if/gradle we must NOT change)
 *   - skeletonPhase2 (phase2 final shape with empty block/hook)
 *
 * We explicitly do NOT resend giant prompt texts or duplicate userNeed.
 */
async function runPhase2(
  req: NdjcRequest,
  phase1Clean: any
): Promise<Phase2Result> {
  const userNeed = (req.requirement ?? "").trim();

  // Build final skeleton for Phase2 (text/list/if/gradle locked from phase1; block/hook empty)
  const skeletonP2 = buildSkeletonPhase2(registryP2, phase1Clean);

  // We'll also pass a compact "lockedSpec" = the frozen text/list/if/gradle from phase1Clean
  const lockedSpec = {
    metadata: phase1Clean?.metadata || {},
    anchorsGrouped: {
      text: phase1Clean?.anchorsGrouped?.text || {},
      list: phase1Clean?.anchorsGrouped?.list || {},
      if: phase1Clean?.anchorsGrouped?.if || {},
      gradle: phase1Clean?.anchorsGrouped?.gradle || {},
    },
  };

  // SYSTEM MESSAGE for Phase2 (slim rules)
  const sysHeaderPhase2 = [
    "You are NDJC Phase 2.",
    "Goal: Produce EXACTLY ONE valid JSON object and NOTHING ELSE.",
    "",
    'Top-level keys in this exact order: "metadata" -> "anchorsGrouped" -> "files".',
    '"files" MUST be an empty array [].',
    "",
    "anchorsGrouped MUST contain ALL of these groups:",
    '"text","list","if","gradle","block","hook".',
    "",
    "CRITICAL LOCK RULE:",
    "You MUST copy text/list/if/gradle EXACTLY from lockedSpec. Do not modify their values or keys.",
    "You MUST fill EVERY key in anchorsGrouped.block and anchorsGrouped.hook in skeletonPhase2.",
    "",
    "BLOCK RULES:",
    "- Each block value must be a Kotlin/Jetpack Compose snippet (string).",
    '- It should look like @Composable fun ... { ... Text("...") ... } or use Compose calls like Text( ), Column{ }, Row{ }.',
    "- It should be at least ~40 characters of code, not just a label.",
    "- Do not output placeholders like lorem / tbd / n/a / ready / content ready.",
    "",
    "HOOK RULES:",
    '- Each hook value must be either "noop", a simple string (like "gradle_task:uploadMedia"),',
    '  or a small object { "type": "...", "value": "..." }.',
    "- Hooks must be syntactically valid JSON.",
    "",
    "RETURN RULES:",
    "Return ONLY the final JSON (no commentary, no markdown fences).",
  ].join("\n");

  // USER MESSAGE for Phase2:
  // We pack userNeed, lockedSpec (text/list/if/gradle from phase1),
  // and skeletonPhase2 (desired final shape with block/hook placeholders).
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

  // parse model output
  const rawJson = parseAndEnsureTopLevel(llmText);

  // validate and merge with phase1
  const { final, violations } = validatePhase2(rawJson, phase1Clean, registryP2);

  return {
    raw: rawJson,
    final,
    violations,
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

  // approximate token usage if not provided
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

/* =========================================================
 * SKELETON BUILDERS
 * =======================================================*/

// Phase1 skeleton: only text / list / if / gradle
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

// Phase2 skeleton: lock phase1 text/list/if/gradle; create empty block/hook
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
 * (critical constraints we actually enforce in guardPhase1)
 * =======================================================*/

function buildSchemaCorePhase1(regP1: any) {
  // We keep only the constraints that guardPhase1() will hard-reject on
  // and those needed so LLM outputs passable values.

  // RUNID regex
  const runIdRule = "^run_[0-9]{8}_[0-9]{3}$";

  // packageId / applicationId regex
  const pkgRule = "^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$";

  // https URL rule for DATA_SOURCE
  const httpsRule = "^https://[\\w.-]+(:\\d+)?(/.*)?$";

  // route item regex
  const routeRule = "^[a-z][a-z0-9_-]*$";

  // locale tag regex
  const localeRule = "^[a-z]{2}(-r[A-Z]{2,3})?$";

  // permission regex
  const permRule = "^android\\.permission\\.[A-Z_]+$";

  // minimal required groups we actually depend on
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

  // ensure THEME_COLORS / STRINGS_EXTRA become real objects if present
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

  // Gradle sanity
  const g = out.anchorsGrouped.gradle;
  g.applicationId = ensurePkg(
    g.applicationId ||
      out.anchorsGrouped.text["NDJC:PACKAGE_NAME"] ||
      "com.example.ndjc"
  );

  // resConfigs
  let resCfgs: string[] = Array.isArray(g.resConfigs)
    ? g.resConfigs.map(String)
    : [];
  resCfgs = resCfgs.filter((x: string) => LOCALE_ITEM.test(x));
  if (!resCfgs.length) resCfgs = ["en"];
  g.resConfigs = resCfgs;

  // permissions
  let perms: string[] = Array.isArray(g.permissions)
    ? g.permissions.map(String)
    : [];
  perms = perms.filter((p: string) => PERM_REGEX.test(p));
  if (!perms.length) perms = ["android.permission.INTERNET"];
  g.permissions = perms;

  // metadata normative info
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
  if (
    !clean.anchorsGrouped ||
    typeof clean.anchorsGrouped !== "object"
  ) {
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
      violations: [
        "Phase2: anchorsGrouped missing or not object",
      ],
    };
  }

  const locked = phase1Clean.anchorsGrouped || {};
  const got = phase2Raw.anchorsGrouped || {};

  // enforce lock: text/list/if/gradle must match exactly
  const groupsToLock = ["text", "list", "if", "gradle"] as const;
  for (const g of groupsToLock) {
    const beforeStr = stableStringify(locked[g] || {});
    const afterStr = stableStringify(got[g] || {});
    if (beforeStr !== afterStr) {
      violations.push(`Phase2: group "${g}" was modified`);
    }
  }

  // ensure block/hook exist
  if (!got.block || typeof got.block !== "object") {
    violations.push("Phase2: block group missing/invalid");
  }
  if (!got.hook || typeof got.hook !== "object") {
    violations.push("Phase2: hook group missing/invalid");
  }

  // block validation with explicit typing
  if (got.block) {
    for (const [rawName, rawVal] of Object.entries(got.block)) {
      const anchorName: string = String(rawName);
      const val: unknown = rawVal;

      // length / string check
      if (typeof val !== "string" || val.trim().length < 10) {
        violations.push(
          `Phase2: block ${anchorName} too short or not string`
        );
        continue;
      }

      // check compose-ish content
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

  // hook validation with explicit typing
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

  // merge locked groups + new block/hook into final
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
