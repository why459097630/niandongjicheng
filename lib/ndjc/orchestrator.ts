// lib/ndjc/orchestrator.ts
//
// NDJC two-phase orchestrator
//
// Phase 1: ask LLM for config spec only (text / list / if / gradle)
// Phase 2: ask LLM for implementation (block / hook) using locked Phase 1 spec
//
// IMPORTANT RUNTIME BEHAVIOR:
// - On Vercel/serverless (process.env.VERCEL is set), FS is read-only.
//   We MUST NOT write to disk there.
// - Locally (dev box / self-host runner), we DO write /requests/<runId> artifacts.
//
// PUBLIC API:
//   orchestrateTwoPhase(req: NdjcRequest)
//   orchestrate(req: NdjcRequest)   // legacy alias
//
// RETURN SHAPE:
// {
//   ok: boolean,
//   runId: string,
//   plan: any | null,
//   phase1Spec: any,
//   violations: string[],
//   usage: { ... },
//   debug: { phase1Raw, phase1Clean, phase2Raw }
// }

import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

import registryP1 from "@/lib/ndjc/anchors/registry.circle-basic.phase1.json";
import registryP2 from "@/lib/ndjc/anchors/registry.circle-basic.phase2.json";

/* ----------------- small helper regexes ----------------- */

const PKG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const PERM_REGEX = /^android\.permission\.[A-Z_]+$/;
const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2,3})?$/;

/* ----------------- usage types ----------------- */

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

// detect if we are allowed to write to disk
function canWriteToDisk() {
  // Vercel serverless functions expose process.env.VERCEL,
  // and their filesystem is effectively read-only (/var/task).
  if (process.env.VERCEL) return false;
  return true;
}

// main entry for callers
export async function orchestrateTwoPhase(req: NdjcRequest) {
  // 1. Phase 1: infer basic config spec
  const phase1 = await runPhase1(req);

  // 2. Optionally persist phase1 artifacts locally (if allowed)
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

  // 3. Phase 2: generate block/hook impl using locked phase1 spec
  const phase2 = await runPhase2(req, phase1.clean);

  // 4. Optionally persist phase2 artifacts
  if (canWriteToDisk()) {
    // runDir computed above
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

  // 5. Build usage report (always in memory; may also save locally)
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

  // 6. Return to API caller. debug acts like "build log" for serverless
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

// legacy export so old code that imports { orchestrate } still works
export async function orchestrate(req: NdjcRequest) {
  return orchestrateTwoPhase(req);
}

/* =========================================================
 * PHASE 1
 * =======================================================*/

async function runPhase1(req: NdjcRequest): Promise<Phase1Result> {
  const templateKey = req.template_key ?? "circle-basic";
  const userNeed = (req.requirement ?? "").trim();

  // build skeleton + schema fragment for phase1
  const skeletonP1 = buildSkeletonPhase1(registryP1);
  const skeletonJson = stableStringify(skeletonP1);
  const schemaFragP1 = buildSchemaFragmentPhase1(registryP1);
  const schemaFragJson = stableStringify(schemaFragP1);

  // read phase1 prompt
  const promptPath = path.join(
    process.cwd(),
    "lib/ndjc/prompts/contract_v1.phase1.en.txt"
  );
  const promptText = await fs.readFile(promptPath, "utf8");

  // inject placeholders
  const injected = injectPromptPlaceholders(promptText, {
    SKELETON_JSON: skeletonJson,
    SCHEMA_FRAGMENT: schemaFragJson,
    PLACEHOLDER_BLACKLIST: JSON.stringify(
      registryP1.placeholderBlacklist ?? []
    ),
    USER_NEED: userNeed,
    PHASE1_SPEC_JSON: "", // phase1 doesn't have a prior spec
  });

  const sysHeader =
    "You are NDJC Phase 1. Produce config only (text/list/if/gradle). Do NOT include block/hook.\n" +
    'Return EXACTLY ONE valid JSON object with top-level keys "metadata","anchorsGrouped","files" in that order.\n' +
    '"files" MUST be [].\n' +
    "No markdown fences. No commentary.";

  const msgs: ChatMessage[] = [
    { role: "system", content: sysHeader + "\n" + injected },
    { role: "user", content: userNeed },
  ];

  const { text: llmText, usage } = await runGroqChat(msgs);

  // parse + normalize structure
  const rawJson = parseAndEnsureTopLevel(llmText);

  // sanitize / fill defaults / normalize types
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

  // final guard (throws on fatal schema break)
  guardPhase1(clean, registryP1);

  return {
    raw: rawJson,
    clean,
    runId: runIdGuess,
    usage,
  };
}

/* =========================================================
 * PHASE 2
 * =======================================================*/

async function runPhase2(
  req: NdjcRequest,
  phase1Clean: any
): Promise<Phase2Result> {
  const userNeed = (req.requirement ?? "").trim();

  // skeleton for phase2:
  // - text/list/if/gradle are locked from phase1Clean
  // - block/hook are empty slots
  const skeletonP2 = buildSkeletonPhase2(registryP2, phase1Clean);
  const skeletonJson = stableStringify(skeletonP2);

  const schemaFragP2 = buildSchemaFragmentPhase2(registryP2);
  const schemaFragJson = stableStringify(schemaFragP2);

  const promptPath = path.join(
    process.cwd(),
    "lib/ndjc/prompts/contract_v1.phase2.en.txt"
  );
  const promptText = await fs.readFile(promptPath, "utf8");

  const injected = injectPromptPlaceholders(promptText, {
    SKELETON_JSON: skeletonJson,
    SCHEMA_FRAGMENT: schemaFragJson,
    PLACEHOLDER_BLACKLIST: JSON.stringify(
      registryP2.placeholderBlacklist ?? []
    ),
    USER_NEED: userNeed,
    PHASE1_SPEC_JSON: stableStringify(phase1Clean),
  });

  const sysHeader =
    "You are NDJC Phase 2. ONLY produce block/hook. Do NOT change the locked values of text/list/if/gradle in PHASE1_SPEC_JSON.\n" +
    'Return EXACTLY ONE valid JSON object with top-level keys "metadata","anchorsGrouped","files" in that order.\n' +
    '"files" MUST be [].\n' +
    "No markdown fences. No commentary.";

  const msgs: ChatMessage[] = [
    { role: "system", content: sysHeader + "\n" + injected },
    { role: "user", content: userNeed },
  ];

  const { text: llmText, usage } = await runGroqChat(msgs);

  // parse model output
  const rawJson = parseAndEnsureTopLevel(llmText);

  // validate/merge
  const { final, violations } = validatePhase2(
    rawJson,
    phase1Clean,
    registryP2
  );

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

  // try to normalize text
  const text =
    typeof r === "string"
      ? r
      : typeof r?.text === "string"
      ? r.text
      : (r?.choices?.[0]?.message?.content as string) || "";

  // approximate usage if provider doesn't return detailed usage
  const promptJoined = msgs.map((m) => m.content).join("\n");
  const approxTokens = (s: string) => Math.ceil((s ?? "").length / 4);

  const promptTok =
    (r?.usage?.prompt_tokens as number) ?? approxTokens(promptJoined);
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

  // text anchors
  const gText: Record<string, any> = {};
  (regP1.text ?? []).forEach((k: string) => {
    gText[k] = "";
  });

  // list anchors
  const gList: Record<string, any> = {};
  (regP1.list ?? []).forEach((k: string) => {
    gList[k] = [];
  });

  // if anchors (boolean feature toggles)
  const gIf: Record<string, any> = {};
  (regP1.if ?? []).forEach((k: string) => {
    gIf[k] = false;
  });

  // gradle group
  const gGradle: Record<string, any> = {
    applicationId: "",
    resConfigs: [],
    permissions: [],
  };

  const anchorsGrouped = {
    text: gText,
    list: gList,
    if: gIf,
    gradle: gGradle,
  };

  return {
    metadata,
    anchorsGrouped,
    files: [],
  };
}

// Phase2 skeleton: lock text/list/if/gradle from phase1Clean; create empty block/hook
function buildSkeletonPhase2(regP2: any, phase1Clean: any) {
  const locked = phase1Clean?.anchorsGrouped || {};

  const gText = { ...(locked.text || {}) };
  const gList = { ...(locked.list || {}) };
  const gIf = { ...(locked.if || {}) };
  const gGradle = { ...(locked.gradle || {}) };

  // block anchors from regP2
  const gBlock: Record<string, any> = {};
  (regP2.block ?? []).forEach((k: string) => {
    gBlock[k] = "";
  });

  // hook anchors from regP2
  const gHook: Record<string, any> = {};
  (regP2.hook ?? []).forEach((k: string) => {
    gHook[k] = "noop";
  });

  const metadata: Record<string, any> = {
    "NDJC:BUILD_META:RUNID":
      phase1Clean?.metadata?.["NDJC:BUILD_META:RUNID"] || "",
  };

  const anchorsGrouped = {
    text: gText,
    list: gList,
    if: gIf,
    gradle: gGradle,
    block: gBlock,
    hook: gHook,
  };

  return {
    metadata,
    anchorsGrouped,
    files: [],
  };
}

/* =========================================================
 * SCHEMA FRAGMENTS
 * =======================================================*/

function buildSchemaFragmentPhase1(regP1: any) {
  return {
    required: regP1.required ?? {},
    placeholderBlacklist: regP1.placeholderBlacklist ?? [],
    topLevelOrder: ["metadata", "anchorsGrouped", "files"],
    valueFormat: {
      text: {
        "NDJC:BUILD_META:RUNID": { regex: "^run_[0-9]{8}_[0-9]{3}$" },
        "NDJC:PACKAGE_NAME": {
          regex: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$",
        },
        "NDJC:DATA_SOURCE": {
          regex: "^https://[\\w.-]+(:\\d+)?(/.*)?$",
        },
      },
      list: {
        "LIST:ROUTES": {
          itemRegex: "^[a-z][a-z0-9_-]*$",
          minItems: 1,
        },
      },
      gradle: {
        applicationId: {
          regex: "^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$",
        },
        resConfigs: {
          itemRegex: "^[a-z]{2}(-r[A-Z]{2,3})?$",
          minItems: 1,
        },
        permissions: {
          itemRegex: "^android\\.permission\\.[A-Z_]+$",
          minItems: 1,
        },
      },
    },
  };
}

function buildSchemaFragmentPhase2(regP2: any) {
  return {
    required: regP2.required ?? {},
    placeholderBlacklist: regP2.placeholderBlacklist ?? [],
    topLevelOrder: ["metadata", "anchorsGrouped", "files"],
    blockRules: {
      mustContainComposable: true,
    },
    hookRules: {
      allowNoop: true,
    },
  };
}

/* =========================================================
 * SANITIZE + GUARD PHASE1
 * =======================================================*/

function sanitizePhase1(rawJson: any, regP1: any, templateKey: string) {
  const out: any = {
    metadata: rawJson.metadata || {},
    anchorsGrouped: rawJson.anchorsGrouped || {},
    files: [],
  };

  // Ensure groups exist
  out.anchorsGrouped.text = out.anchorsGrouped.text || {};
  out.anchorsGrouped.list = out.anchorsGrouped.list || {};
  out.anchorsGrouped.if = out.anchorsGrouped.if || {};
  out.anchorsGrouped.gradle = out.anchorsGrouped.gradle || {};

  // Coerce IF to booleans
  for (const k of Object.keys(out.anchorsGrouped.if)) {
    out.anchorsGrouped.if[k] = toBool(out.anchorsGrouped.if[k]);
  }

  // THEME_COLORS / STRINGS_EXTRA normalize to objects
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

  // Gradle normalization
  const g = out.anchorsGrouped.gradle;
  g.applicationId = ensurePkg(
    g.applicationId ||
      out.anchorsGrouped.text["NDJC:PACKAGE_NAME"] ||
      "com.example.ndjc"
  );

  // resConfigs fallback
  let resCfgs: string[] = Array.isArray(g.resConfigs)
    ? g.resConfigs.map(String)
    : [];
  resCfgs = resCfgs.filter((x: string) => LOCALE_ITEM.test(x));
  if (!resCfgs.length) resCfgs = ["en"];
  g.resConfigs = resCfgs;

  // permissions fallback
  let perms: string[] = Array.isArray(g.permissions)
    ? g.permissions.map(String)
    : [];
  perms = perms.filter((p: string) => PERM_REGEX.test(p));
  if (!perms.length) perms = ["android.permission.INTERNET"];
  g.permissions = perms;

  // fill metadata helpers
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
  // minimal fatal checks

  if (
    !clean.anchorsGrouped ||
    typeof clean.anchorsGrouped !== "object"
  ) {
    throw new Error("Phase1 guard: anchorsGrouped missing/invalid");
  }

  // runId format
  const rid =
    clean.metadata?.["NDJC:BUILD_META:RUNID"] ||
    clean.anchorsGrouped?.text?.["NDJC:BUILD_META:RUNID"];
  if (rid && !/^run_[0-9]{8}_[0-9]{3}$/.test(rid)) {
    throw new Error(
      `Phase1 guard: RUNID invalid (${rid}). Must match ^run_YYYYMMDD_NNN$`
    );
  }

  // gradle.applicationId
  const appId = clean.anchorsGrouped.gradle?.applicationId;
  if (!appId || !PKG_REGEX.test(appId)) {
    throw new Error(
      `Phase1 guard: gradle.applicationId invalid (${appId})`
    );
  }

  // LIST:ROUTES basic validity
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
 * VALIDATE PHASE2
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

  // text/list/if/gradle must not change
  const groupsToLock = ["text", "list", "if", "gradle"] as const;
  for (const g of groupsToLock) {
    const beforeStr = stableStringify(locked[g] || {});
    const afterStr = stableStringify(got[g] || {});
    if (beforeStr !== afterStr) {
      violations.push(`Phase2: group "${g}" was modified`);
    }
  }

  // block/hook must exist
  if (!got.block || typeof got.block !== "object") {
    violations.push("Phase2: block group missing/invalid");
  }
  if (!got.hook || typeof got.hook !== "object") {
    violations.push("Phase2: hook group missing/invalid");
  }

  // light block validation
  if (got.block) {
    for (const [anchorName, val] of Object.entries(got.block)) {
      if (typeof val !== "string" || val.trim().length < 10) {
        violations.push(
          `Phase2: block ${anchorName} too short or not string`
        );
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

  // basic hook validation
  if (got.hook) {
    for (const [anchorName, val] of Object.entries(got.hook)) {
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

  // merge with locked config
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

function injectPromptPlaceholders(
  text: string,
  vars: {
    SKELETON_JSON: string;
    SCHEMA_FRAGMENT: string;
    PLACEHOLDER_BLACKLIST: string;
    USER_NEED: string;
    PHASE1_SPEC_JSON: string;
  }
): string {
  let out = text;
  out = out.replaceAll("[[SKELETON_JSON]]", vars.SKELETON_JSON);
  out = out.replaceAll("[[SCHEMA_FRAGMENT]]", vars.SCHEMA_FRAGMENT);
  out = out.replaceAll(
    "[[PLACEHOLDER_BLACKLIST]]",
    vars.PLACEHOLDER_BLACKLIST
  );
  out = out.replaceAll("[[USER_NEED]]", vars.USER_NEED);
  out = out.replaceAll("[[PHASE1_SPEC_JSON]]", vars.PHASE1_SPEC_JSON);
  return out;
}

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
      // swallow parse error
    }
  }
  return { ...fallbackObj };
}
