// lib/ndjc/orchestrator.ts
//
// NDJC two-phase orchestrator
//
// Phase 1: ask LLM for contract config only (text / if / list / gradle)
//   - prompt: contract_v1.phase1.en.txt
//   - registry: registry.circle-basic.phase1.json
//   - sanitize + guard (hard stop if invalid)
//   - write 02_phase1_raw.json + 02_phase1_clean.json
//
// Phase 2: ask LLM for implementation (block / hook) based on locked Phase 1 spec
//   - prompt: contract_v1.phase2.en.txt
//   - registry: registry.circle-basic.phase2.json
//   - validate that phase2 didn't mutate locked groups
//   - write 03_phase2_raw.json + 03_phase2_plan.json
//
// Orchestrator also:
//   - creates requests/<runId>/
//   - writes 01_usage.json with per-phase token usage
//   - writes plan-violations.json on validation fail
//
// NOTE: this file assumes groqChat(msgs) returns {text, usage?} or string.
// If your groqChat is different, adjust runGroqChat() accordingly.

import fsOrig from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

import registryP1 from "@/lib/ndjc/anchors/registry.circle-basic.phase1.json";
import registryP2 from "@/lib/ndjc/anchors/registry.circle-basic.phase2.json";

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
  usage: PhaseUsage; // usage from LLM
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
 * PUBLIC ENTRYPOINT
 * =======================================================*/
export async function orchestrateTwoPhase(req: NdjcRequest) {
  // 1. Phase1 (config spec)
  const phase1 = await runPhase1(req);

  // 2. Persist phase1 raw + clean
  const baseDir = process.env.NDJC_REQUESTS_DIR || path.join(process.cwd(), "requests");
  const runDir = path.join(baseDir, phase1.runId);
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

  // If phase1.clean failed guard (shouldn't happen because we throw), we would've already bailed.

  // 3. Phase2 (implementation) using cleaned phase1 spec
  const phase2 = await runPhase2(req, phase1.clean, phase1.runId);

  // 4. Persist phase2 raw
  await fs.writeFile(
    path.join(runDir, "03_phase2_raw.json"),
    JSON.stringify(phase2.raw, null, 2),
    "utf8"
  );

  // 5. Persist validated or violations
  if (phase2.final) {
    // success
    await fs.writeFile(
      path.join(runDir, "03_phase2_plan.json"),
      JSON.stringify(phase2.final, null, 2),
      "utf8"
    );
  } else {
    // failed validation
    const vioPayload = {
      errors: phase2.violations,
      note: "Phase2 result failed validation. No 03_phase2_plan.json emitted.",
    };
    await fs.writeFile(
      path.join(runDir, "plan-violations.json"),
      JSON.stringify(vioPayload, null, 2),
      "utf8"
    );
  }

  // 6. Write usage (01_usage.json). We do it AFTER phase2 so it includes both phases.
  const usageReport: UsageReport = {
    runId: phase1.runId,
    phase1: phase1.usage,
    phase2: phase2.usage,
    total_tokens_all_phases:
      (phase1.usage?.total_tokens ?? 0) + (phase2.usage?.total_tokens ?? 0),
    timestamp_utc: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(runDir, "01_usage.json"),
    JSON.stringify(usageReport, null, 2),
    "utf8"
  );

  // 7. Return orchestrator summary to caller (e.g. CLI / API)
  return {
    ok: !!phase2.final,
    runId: phase1.runId,
    phase1Spec: phase1.clean,
    plan: phase2.final,
    violations: phase2.final ? [] : phase2.violations,
    usage: usageReport,
  };
}

/* =========================================================
 * Phase1
 * =======================================================*/
async function runPhase1(req: NdjcRequest): Promise<Phase1Result> {
  const templateKey = req.template_key ?? "circle-basic";
  const userNeed = (req.requirement ?? "").trim();

  // Build skeleton where anchorsGrouped only has text/if/list/gradle
  const skeletonP1 = buildSkeletonPhase1(registryP1);
  const skeletonJson = stableStringify(skeletonP1);

  // Build schema fragment from registry.phase1 (valueFormat, required, etc.)
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
  });

  // System content for phase1
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

  // We now sanitize+guard to get final spec
  const phase1Clean = sanitizePhase1(phase1Raw, registryP1, templateKey);

  // Derive runId
  const runId =
    phase1Clean?.metadata?.["NDJC:BUILD_META:RUNID"] ||
    phase1Clean?.anchorsGrouped?.text?.["NDJC:BUILD_META:RUNID"] ||
    `run_${genDateStamp()}_000`;

  // Enforce final runId on spec (so downstream is consistent)
  phase1Clean.metadata = phase1Clean.metadata || {};
  phase1Clean.metadata["NDJC:BUILD_META:RUNID"] = runId;

  if (!phase1Clean.anchorsGrouped?.text) {
    phase1Clean.anchorsGrouped.text = {};
  }
  phase1Clean.anchorsGrouped.text["NDJC:BUILD_META:RUNID"] = runId;

  // Guard (hard fail if invalid)
  guardPhase1(phase1Clean, registryP1);

  // Return
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
  const templateKey = req.template_key ?? "circle-basic";
  const userNeed = (req.requirement ?? "").trim();

  // Build skeleton where anchorsGrouped includes ALL groups:
  // text/if/list/gradle (pre-filled from phase1Clean) + empty block/hook.
  const skeletonP2 = buildSkeletonPhase2(registryP2, phase1Clean);
  const skeletonJson = stableStringify(skeletonP2);

  // Build schema fragment from registry.phase2 (valueFormat for block/hook + required blocks)
  const schemaFragP2 = buildSchemaFragmentPhase2(registryP2);
  const schemaFragJson = stableStringify(schemaFragP2);

  // Read phase2 prompt text
  const promptPath = path.join(
    process.cwd(),
    "lib/ndjc/prompts/contract_v1.phase2.en.txt"
  );
  const promptText = await fs.readFile(promptPath, "utf8");

  // Inject placeholders: includes PHASE1_SPEC_JSON for locked config
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

  // Phase2 raw
  const phase2Raw = parseAndEnsureTopLevel(llmText);

  // Validate: phase2Raw must (1) keep text/if/list/gradle same as phase1Clean, (2) generate block/hook correctly.
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
async function runGroqChat(msgs: ChatMessage[]): Promise<{ text: string; usage: PhaseUsage }> {
  // callGroqChat is user-provided. We normalize result.
  const r: any = await callGroqChat(msgs);

  // Guess shape:
  // - maybe r is string
  // - maybe r = { text: string, usage:{prompt_tokens,...} }
  const text =
    typeof r === "string"
      ? r
      : typeof r?.text === "string"
      ? r.text
      : "";

  // crude fallback usage if provider didn't return usage
  // (we approximate tokens ~= chars/4)
  const approxTokens = (s: string) => Math.ceil((s ?? "").length / 4);
  const promptTok = approxTokens(msgs.map(m => m.content).join("\n"));
  const completionTok = approxTokens(text);

  const usage: PhaseUsage = {
    prompt_tokens:
      (r?.usage?.prompt_tokens as number) ?? promptTok,
    completion_tokens:
      (r?.usage?.completion_tokens as number) ?? completionTok,
    total_tokens:
      (r?.usage?.total_tokens as number) ??
      (promptTok + completionTok),
    model:
      (r?.usage?.model as string) ??
      "gpt-5-thinking", // per system instruction
  };

  return { text, usage };
}

/* =========================================================
 * Skeleton builders
 * =======================================================*/

// phase1 skeleton only: text / if / list / gradle
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
    gList[k] = [];
  });

  const gGradle: Record<string, any> = {
    applicationId: "",
    resConfigs: [],
    permissions: [],
  };

  const anchorsGrouped = {
    text: gText,
    if: gIf,
    list: gList,
    gradle: gGradle,
  };

  return {
    metadata,
    anchorsGrouped,
    files: [],
  };
}

// phase2 skeleton has ALL groups, but text/if/list/gradle prefilled from phase1Clean
function buildSkeletonPhase2(regP2: any, phase1Clean: any) {
  // phase1Clean is already {metadata, anchorsGrouped:{ text,if,list,gradle }, files:[]}

  // clone shallow
  const lockedText = { ...(phase1Clean?.anchorsGrouped?.text ?? {}) };
  const lockedIf = { ...(phase1Clean?.anchorsGrouped?.if ?? {}) };
  const lockedList = { ...(phase1Clean?.anchorsGrouped?.list ?? {}) };
  const lockedGradle = { ...(phase1Clean?.anchorsGrouped?.gradle ?? {}) };

  // create empty block/hook groups from registryP2
  const gBlock: Record<string, any> = {};
  (regP2.block ?? []).forEach((k: string) => {
    gBlock[k] = "";
  });

  const gHook: Record<string, any> = {};
  (regP2.hook ?? []).forEach((k: string) => {
    gHook[k] = "noop";
  });

  // skeleton metadata should include runId field as known
  const metadata = {
    ...(phase1Clean?.metadata ?? {}),
  };

  const anchorsGrouped = {
    text: lockedText,
    if: lockedIf,
    list: lockedList,
    gradle: lockedGradle,
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
 * Schema fragments
 * =======================================================*/

// Phase1 schema: rules for text/if/list/gradle only
function buildSchemaFragmentPhase1(regP1: any) {
  return {
    required: regP1.required ?? {},
    crossField: regP1.crossField ?? {},
    valueFormat: regP1.valueFormat ?? {},
    placeholderBlacklist: regP1.placeholderBlacklist ?? [],
    topLevelOrder: regP1.topLevelOrder ?? ["metadata", "anchorsGrouped", "files"],
  };
}

// Phase2 schema: rules for block/hook (and we still need required blocks)
function buildSchemaFragmentPhase2(regP2: any) {
  return {
    required: regP2.required ?? {},
    valueFormat: regP2.valueFormat ?? {},
    placeholderBlacklist: regP2.placeholderBlacklist ?? [],
    topLevelOrder: regP2.topLevelOrder ?? ["metadata", "anchorsGrouped", "files"],
  };
}

/* =========================================================
 * sanitize + guard for Phase1
 * =======================================================*/

// Try to coerce phase1Raw into a clean, schema-respecting spec
function sanitizePhase1(phase1Raw: any, regP1: any, templateKey: string) {
  const clean = cloneJson(phase1Raw);

  // ensure structure
  if (!clean || typeof clean !== "object") {
    throw new Error("Phase1 sanitize: not an object");
  }
  ensurePhase1Shape(clean);

  // fill defaults from registry for text/list/gradle
  applyDefaultsPhase1(clean, regP1);

  // normalize booleans in IF
  const ifGroup = clean.anchorsGrouped.if;
  for (const k of Object.keys(ifGroup)) {
    ifGroup[k] = toBool(ifGroup[k]);
  }

  // normalize THEME_COLORS & STRINGS_EXTRA etc.
  const textGroup = clean.anchorsGrouped.text;
  if ("NDJC:THEME_COLORS" in textGroup) {
    textGroup["NDJC:THEME_COLORS"] = normalizeJsonObject(
      textGroup["NDJC:THEME_COLORS"],
      { primary: "#7C3AED", secondary: "#10B981" }
    );
  }
  if ("NDJC:STRINGS_EXTRA" in textGroup) {
    textGroup["NDJC:STRINGS_EXTRA"] = normalizeJsonObject(
      textGroup["NDJC:STRINGS_EXTRA"],
      {}
    );
  }

  // compute final package/applicationId
  const desiredPkg =
    textGroup["NDJC:PACKAGE_NAME"] ||
    clean.metadata?.packageId ||
    "com.example.ndjc";
  const finalPkg = ensurePkg(desiredPkg, "com.example.ndjc");

  // sync gradle.applicationId + text.NDJC:PACKAGE_NAME
  clean.anchorsGrouped.gradle.applicationId = finalPkg;
  textGroup["NDJC:PACKAGE_NAME"] = finalPkg;

  // resConfigs sanitization
  let resConfigs = clean.anchorsGrouped.gradle.resConfigs;
  if (!Array.isArray(resConfigs)) resConfigs = [];
  resConfigs = resConfigs
    .map((x: any) => String(x))
    .filter((x: string) => LOCALE_ITEM.test(x));
  if (!resConfigs.length) {
    // try defaults
    const def = regP1.defaults?.gradle?.resConfigs ?? ["en"];
    resConfigs = def.filter((x: string) => LOCALE_ITEM.test(x));
    if (!resConfigs.length) resConfigs = ["en"];
  }
  clean.anchorsGrouped.gradle.resConfigs = resConfigs;

  // permissions sanitization
  let perms = clean.anchorsGrouped.gradle.permissions;
  if (!Array.isArray(perms)) perms = [];
  perms = perms
    .map((x: any) => String(x).trim())
    .filter((p: string) => PERM_REGEX.test(p));
  if (!perms.includes("android.permission.INTERNET")) {
    perms.push("android.permission.INTERNET");
  }
  clean.anchorsGrouped.gradle.permissions = perms;

  // fill metadata
  clean.metadata = clean.metadata || {};
  clean.metadata.template = templateKey;
  clean.metadata.packageId = finalPkg;
  clean.metadata.appName =
    textGroup["NDJC:APP_LABEL"] ||
    clean.metadata.appName ||
    "NDJC App";

  // NDJC:BUILD_META:RUNID
  const runIdRaw =
    textGroup["NDJC:BUILD_META:RUNID"] ||
    clean.metadata["NDJC:BUILD_META:RUNID"] ||
    "auto";
  clean.metadata["NDJC:BUILD_META:RUNID"] = coerceRunId(runIdRaw);
  textGroup["NDJC:BUILD_META:RUNID"] =
    clean.metadata["NDJC:BUILD_META:RUNID"];

  // done
  return clean;
}

// apply defaults for text/list/gradle from registry.phase1.defaults
function applyDefaultsPhase1(clean: any, regP1: any) {
  const g = clean.anchorsGrouped;
  const defsText = regP1.defaults?.text ?? {};
  const defsList = regP1.defaults?.list ?? {};
  const defsGradle = regP1.defaults?.gradle ?? {};

  // text
  Object.keys(defsText).forEach((k) => {
    if (!existsNonEmpty(g.text[k])) {
      g.text[k] = defsText[k];
    }
  });

  // list
  Object.keys(defsList).forEach((k) => {
    if (!Array.isArray(g.list[k]) || g.list[k].length === 0) {
      g.list[k] = defsList[k];
    }
  });

  // gradle
  Object.keys(defsGradle).forEach((k) => {
    const cur = (g.gradle as any)[k];
    if (!existsNonEmpty(cur)) {
      (g.gradle as any)[k] = defsGradle[k];
    }
  });
}

// guard: throw if any must-have field is still invalid
function guardPhase1(clean: any, regP1: any) {
  const g = clean.anchorsGrouped;
  // required fields (phase1 cares about text/list/gradle)
  const req = regP1.required ?? {};
  const reqTextKeys: string[] = req.text ?? [];
  const reqListKeys: string[] = req.list ?? [];
  const reqGradleKeys: string[] = req.gradle ?? [];

  // check text
  for (const key of reqTextKeys) {
    if (!existsNonEmpty(g.text[key])) {
      throw new Error(`Phase1 guard: missing required text.${key}`);
    }
  }

  // check list
  for (const key of reqListKeys) {
    if (!Array.isArray(g.list[key]) || g.list[key].length === 0) {
      throw new Error(`Phase1 guard: missing required list.${key}`);
    }
  }

  // check gradle (specific shape)
  for (const key of reqGradleKeys) {
    const cur = (g.gradle as any)[key];
    if (!existsNonEmpty(cur)) {
      throw new Error(`Phase1 guard: missing required gradle.${key}`);
    }
  }

  // packageId / applicationId format
  if (!PKG_REGEX.test(g.gradle.applicationId)) {
    throw new Error(`Phase1 guard: invalid packageId ${g.gradle.applicationId}`);
  }

  // NDJC:DATA_SOURCE must be https://...
  if (!/^https:\/\//.test(g.text["NDJC:DATA_SOURCE"] ?? "")) {
    throw new Error(`Phase1 guard: NDJC:DATA_SOURCE must start with https://`);
  }

  // runId pattern
  const runId = g.text["NDJC:BUILD_META:RUNID"];
  if (!/^run_[0-9]{8}_[0-9]{3}$/.test(runId)) {
    throw new Error(`Phase1 guard: invalid RUNID ${runId}`);
  }
}

/* =========================================================
 * Phase2 validation
 * =======================================================*/

function validatePhase2(phase2Raw: any, phase1Clean: any, regP2: any) {
  const violations: string[] = [];
  const finalPlan = cloneJson(phase2Raw);

  // basic structural check
  ensurePhase2Shape(finalPlan);

  // 1. text/if/list/gradle must match exactly what we had in phase1Clean
  lockAndCompareGroups(finalPlan, phase1Clean, violations, [
    "text",
    "if",
    "list",
    "gradle",
  ]);

  // 2. block/hook must exist, must satisfy required, and must be code/non-noop as required
  const reqBlockKeys: string[] = regP2.required?.block ?? [];
  const hasBlockGroup = finalPlan.anchorsGrouped.block && typeof finalPlan.anchorsGrouped.block === "object";
  if (!hasBlockGroup) {
    violations.push("Phase2: missing anchorsGrouped.block");
  }

  // ensure each required block anchor present + non-empty + passes basic code regex if provided
  for (const bKey of reqBlockKeys) {
    const val = finalPlan.anchorsGrouped.block?.[bKey];
    if (!val || typeof val !== "string" || !val.trim()) {
      violations.push(`Phase2: required block.${bKey} missing or empty`);
    } else {
      // optional regex check if registry has valueFormat.block[bKey].regex
      const vf = regP2.valueFormat?.block?.[bKey];
      if (vf?.regex) {
        const r = new RegExp(vf.regex);
        if (!r.test(val)) {
          violations.push(`Phase2: block.${bKey} failed regex`);
        }
      }
      // placeholder blacklist
      if (containsForbiddenPlaceholder(val, regP2.placeholderBlacklist)) {
        violations.push(`Phase2: block.${bKey} contains forbidden placeholder text`);
      }
    }
  }

  // 3. hook group
  const hasHookGroup = finalPlan.anchorsGrouped.hook && typeof finalPlan.anchorsGrouped.hook === "object";
  if (!hasHookGroup) {
    violations.push("Phase2: missing anchorsGrouped.hook");
  } else {
    // check at least they're not ALL "noop" if feature is enabled
    enforceHookFeatureConsistency(
      finalPlan,
      phase1Clean,
      violations
    );
  }

  // 4. forbid feature leakage:
  // if IF:ENABLE_COMMENTS=false in phase1, then block.COMMENTS_SCREEN should not implement full comment UI.
  // We'll do a heuristic: if disabled, but code snippet still looks "interactive"
  const ifFlags = phase1Clean.anchorsGrouped.if || {};
  checkFeatureLeak(
    finalPlan,
    ifFlags,
    "IF:ENABLE_COMMENTS",
    ["BLOCK:COMMENTS_SCREEN", "BLOCK:COMMENT_ITEM"],
    violations
  );
  checkFeatureLeak(
    finalPlan,
    ifFlags,
    "IF:ENABLE_LIKES",
    ["BLOCK:LIKE_BUTTON"],
    violations
  );
  checkFeatureLeak(
    finalPlan,
    ifFlags,
    "IF:ENABLE_POSTING",
    ["BLOCK:POST_COMPOSER", "BLOCK:UPLOAD_MEDIA", "BLOCK:POST_CARD"],
    violations
  );
  checkFeatureLeak(
    finalPlan,
    ifFlags,
    "IF:SHOW_NOTIFICATIONS",
    ["BLOCK:NOTIFICATIONS_SCREEN"],
    violations
  );

  if (violations.length > 0) {
    return {
      final: null,
      violations,
    };
  }

  // success
  return {
    final: finalPlan,
    violations: [],
  };
}

function lockAndCompareGroups(
  finalPlan: any,
  phase1Clean: any,
  violations: string[],
  groups: string[]
) {
  const fpG = finalPlan.anchorsGrouped;
  const p1G = phase1Clean.anchorsGrouped;

  for (const grp of groups) {
    if (!fpG[grp]) {
      // must exist; copy locked group in to keep plan structurally valid
      fpG[grp] = cloneJson(p1G[grp] || {});
      continue;
    }
    // ensure same keys+values
    const aKeys = Object.keys(fpG[grp]);
    const bKeys = Object.keys(p1G[grp] || {});
    // same size?
    if (aKeys.length !== bKeys.length) {
      violations.push(`Phase2: group "${grp}" keycount mismatch`);
    }
    for (const k of bKeys) {
      if (!(k in fpG[grp])) {
        violations.push(`Phase2: group "${grp}" missing key "${k}"`);
        continue;
      }
      // deep-compare value JSON
      if (!deepEqualJson(fpG[grp][k], p1G[grp][k])) {
        violations.push(
          `Phase2: group "${grp}" key "${k}" modified between phase1 and phase2`
        );
      }
    }
  }

  // also ensure finalPlan.metadata at least carries runId
  const p1RunId =
    phase1Clean.metadata?.["NDJC:BUILD_META:RUNID"] ||
    phase1Clean.anchorsGrouped?.text?.["NDJC:BUILD_META:RUNID"];
  if (p1RunId) {
    if (!finalPlan.metadata) finalPlan.metadata = {};
    finalPlan.metadata["NDJC:BUILD_META:RUNID"] = p1RunId;
  }
}

function enforceHookFeatureConsistency(
  finalPlan: any,
  phase1Clean: any,
  violations: string[]
) {
  const hooks = finalPlan.anchorsGrouped.hook || {};
  const ifFlags = phase1Clean.anchorsGrouped.if || {};

  // Helpers
  function isActive(flagName: string) {
    return !!toBool(ifFlags[flagName]);
  }

  // For posting
  if (isActive("IF:ENABLE_POSTING")) {
    // at least one of POST_SUBMIT / UPLOAD_MEDIA not "noop"
    const postSubmit = hooks["HOOK:POST_SUBMIT"];
    const uploadMedia = hooks["HOOK:UPLOAD_MEDIA"];
    if (isAllNoop([postSubmit, uploadMedia])) {
      violations.push(
        "Phase2: posting enabled but HOOK:POST_SUBMIT / HOOK:UPLOAD_MEDIA are all noop"
      );
    }
  }

  // For comments
  if (isActive("IF:ENABLE_COMMENTS")) {
    const fetchComments = hooks["HOOK:FETCH_COMMENTS"];
    const commentSubmit = hooks["HOOK:COMMENT_SUBMIT"];
    if (isAllNoop([fetchComments, commentSubmit])) {
      violations.push(
        "Phase2: comments enabled but comment hooks are all noop"
      );
    }
  }

  // For likes
  if (isActive("IF:ENABLE_LIKES")) {
    const likeToggle = hooks["HOOK:LIKE_TOGGLE"];
    if (isAllNoop([likeToggle])) {
      violations.push(
        "Phase2: likes enabled but HOOK:LIKE_TOGGLE is noop"
      );
    }
  }

  // For notifications
  if (isActive("IF:SHOW_NOTIFICATIONS")) {
    const notifHook = hooks["HOOK:FETCH_NOTIFICATIONS"];
    if (isAllNoop([notifHook])) {
      violations.push(
        "Phase2: notifications enabled but HOOK:FETCH_NOTIFICATIONS is noop"
      );
    }
  } else {
    // if notifications disabled, FETCH_NOTIFICATIONS should be noop
    const notifHook = hooks["HOOK:FETCH_NOTIFICATIONS"];
    if (!isAllNoop([notifHook])) {
      violations.push(
        "Phase2: notifications disabled but HOOK:FETCH_NOTIFICATIONS is not noop"
      );
    }
  }
}

function checkFeatureLeak(
  finalPlan: any,
  ifFlags: Record<string, any>,
  flagName: string,
  blockKeys: string[],
  violations: string[]
) {
  const enabled = toBool(ifFlags[flagName]);
  if (enabled) return; // user wants the feature -> block UI allowed
  const blocks = finalPlan.anchorsGrouped.block || {};
  for (const bKey of blockKeys) {
    const val = blocks[bKey];
    if (!val) continue;
    // Heuristic: if feature disabled but code snippet looks "functional UI"
    // we'll flag it. "functional UI" == references of TextField, LazyColumn, Button, etc.
    if (/(TextField|LazyColumn|Button|IconButton|onClick)/.test(val)) {
      violations.push(
        `Phase2: ${flagName} is false, but ${bKey} looks interactive`
      );
    }
  }
}

/* =========================================================
 * Shape + utils
 * =======================================================*/

function parseAndEnsureTopLevel(rawText: string) {
  const parsed = tryParseJson(rawText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM output is not a JSON object");
  }
  if (!parsed.metadata) parsed.metadata = {};
  if (!parsed.anchorsGrouped) parsed.anchorsGrouped = {};
  if (!parsed.files) parsed.files = [];
  return parsed;
}

// ensure Phase1 structure (no block/hook in anchorsGrouped)
// if block/hook show up we just delete them here. (Phase1 must not define them)
function ensurePhase1Shape(clean: any) {
  if (!clean.metadata) clean.metadata = {};
  if (!clean.anchorsGrouped) clean.anchorsGrouped = {};
  if (!clean.files) clean.files = [];

  const g = clean.anchorsGrouped;
  g.text = g.text || {};
  g.if = g.if || {};
  g.list = g.list || {};
  g.gradle = g.gradle || {};

  // explicitly remove block/hook if present
  if (g.block) delete g.block;
  if (g.hook) delete g.hook;
}

// ensure Phase2 structure (must have block/hook groups)
function ensurePhase2Shape(plan: any) {
  if (!plan.metadata) plan.metadata = {};
  if (!plan.anchorsGrouped) plan.anchorsGrouped = {};
  if (!plan.files) plan.files = [];
  const g = plan.anchorsGrouped;
  g.text = g.text || {};
  g.if = g.if || {};
  g.list = g.list || {};
  g.gradle = g.gradle || {};
  g.block = g.block || {};
  g.hook = g.hook || {};
}

function injectPromptPlaceholders(
  text: string,
  vars: Record<string, string>
) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`[[${k}]]`, v);
  }
  return out;
}

function normalizeJsonObject(input: any, fallback: Record<string, any>) {
  if (input && typeof input === "object" && !Array.isArray(input)) return input;
  if (typeof input === "string") {
    const s = input.trim();
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch {}
  }
  return { ...fallback };
}

function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  if (
    [
      "true",
      "1",
      "yes",
      "y",
      "on",
      "enabled",
      "enable",
      "open",
      "是",
    ].includes(s)
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

function tryParseJson(text: string): any {
  if (!text) throw new Error("empty");
  const m =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  return JSON.parse(raw);
}

function cloneJson<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function existsNonEmpty(v: any) {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function coerceRunId(v: any): string {
  // either keep valid run_*_* or generate one
  const s = String(v ?? "").trim();
  if (/^run_[0-9]{8}_[0-9]{3}$/.test(s)) return s;
  return `run_${genDateStamp()}_000`;
}

function genDateStamp() {
  // YYYYMMDD
  const d = new Date();
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function deepEqualJson(a: any, b: any): boolean {
  // simple deep equal via stringify with stable key order
  return stableStringifySorted(a) === stableStringifySorted(b);
}

function stableStringify(obj: any) {
  return JSON.stringify(obj, null, 2);
}

function stableStringifySorted(obj: any): string {
  return JSON.stringify(sortKeysRec(obj));
}

function sortKeysRec(v: any): any {
  if (Array.isArray(v)) {
    return v.map(sortKeysRec);
  }
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      out[k] = sortKeysRec(v[k]);
    }
    return out;
  }
  return v;
}

function isAllNoop(xs: any[]): boolean {
  // "noop" string or { type:"noop"... } style both treated noop-ish
  return xs.every((x) => {
    if (x == null) return true;
    if (typeof x === "string") return x.trim().toLowerCase() === "noop";
    if (typeof x === "object") {
      // try detect object form {type:"...", value:"..."} vs noop
      if (Object.keys(x).length === 0) return true;
      if (
        typeof x.type === "string" &&
        x.type.toLowerCase().includes("noop")
      ) {
        return true;
      }
    }
    return false;
  });
}

function containsForbiddenPlaceholder(str: string, blacklist: string[] = []) {
  const lower = str.toLowerCase();
  for (const word of blacklist) {
    if (!word) continue;
    if (lower.includes(String(word).toLowerCase())) {
      return true;
    }
  }
  // also defend against the known bad placeholders
  const builtIns = ["lorem", "tbd", "n/a", "ready", "content ready for rendering"];
  return builtIns.some((w) => lower.includes(w));
}
