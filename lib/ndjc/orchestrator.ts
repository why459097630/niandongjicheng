// lib/ndjc/orchestrator.ts
//
// NDJC two-phase orchestrator
//
// Phase 1: ask LLM for config spec only (text / if / list / gradle)
//   - prompt: contract_v1.phase1.en.txt
//   - registry: registry.circle-basic.phase1.json
//   - sanitize + guard (hard-stop if invalid)
//   - write requests/<runId>/02_phase1_raw.json and 02_phase1_clean.json
//
// Phase 2: ask LLM for implementation (block / hook) using locked Phase 1 spec
//   - prompt: contract_v1.phase2.en.txt
//   - registry: registry.circle-basic.phase2.json
//   - validate phase2 doesn't mutate text/if/list/gradle, and block/hook obey rules
//   - write 03_phase2_raw.json and 03_phase2_plan.json (or plan-violations.json)
//
// Also writes requests/<runId>/01_usage.json with token usage summary.
//
// IMPORTANT: we export BOTH orchestrateTwoPhase() (new) and orchestrate() (compat).
// orchestrate(req) just calls orchestrateTwoPhase(req), so existing code doesn't break.

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

// New main entrypoint
export async function orchestrateTwoPhase(req: NdjcRequest) {
  // 1. Phase 1 (config spec)
  const phase1 = await runPhase1(req);

  // 2. Persist phase1 output
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

  // 3. Phase 2 (implementation)
  const phase2 = await runPhase2(req, phase1.clean, phase1.runId);

  // 4. Persist phase2 raw
  await fs.writeFile(
    path.join(runDir, "03_phase2_raw.json"),
    JSON.stringify(phase2.raw, null, 2),
    "utf8"
  );

  // 5. If phase2 valid → keep final plan, else record violations
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

  // 6. Write usage.json (01_usage.json)
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

  // 7. Return for caller (API / CLI / etc.)
  return {
    ok: !!phase2.final,
    runId: phase1.runId,
    phase1Spec: phase1.clean,
    plan: phase2.final,
    violations: phase2.final ? [] : phase2.violations,
    usage: usageReport,
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
  const approxTokens = (s: string) => Math.ceil((s ?? "").length / 4);
  const promptTok = approxTokens(msgs.map((m) => m.content).join("\n"));
  const completionTok = approxTokens(text);

  const usage: PhaseUsage = {
    prompt_tokens:
      (r?.usage?.prompt_tokens as number) ?? promptTok,
    completion_tokens:
      (r?.usage?.completion_tokens as number) ?? completionTok,
    total_tokens:
      (r?.usage?.total_tokens as number) ??
      promptTok + completionTok,
    model:
      (r?.usage?.model as string) ??
      "gpt-5-thinking",
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

// Phase2 skeleton has all groups; text/if/list/gradle are prefilled from phase1Clean
function buildSkeletonPhase2(regP2: any, phase1Clean: any) {
  const lockedText = { ...(phase1Clean?.anchorsGrouped?.text ?? {}) };
  const lockedIf = { ...(phase1Clean?.anchorsGrouped?.if ?? {}) };
  const lockedList = { ...(phase1Clean?.anchorsGrouped?.list ?? {}) };
  const lockedGradle = { ...(phase1Clean?.anchorsGrouped?.gradle ?? {}) };

  const gBlock: Record<string, any> = {};
  (regP2.block ?? []).forEach((k: string) => {
    gBlock[k] = "";
  });

  const gHook: Record<string, any> = {};
  (regP2.hook ?? []).forEach((k: string) => {
    gHook[k] = "noop";
  });

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
 * Schema fragments injected into prompts
 * =======================================================*/
function buildSchemaFragmentPhase1(regP1: any) {
  return {
    required: regP1.required ?? {},
    crossField: regP1.crossField ?? {},
    valueFormat: regP1.valueFormat ?? {},
    placeholderBlacklist: regP1.placeholderBlacklist ?? [],
    topLevelOrder:
      regP1.topLevelOrder ?? ["metadata", "anchorsGrouped", "files"],
  };
}

function buildSchemaFragmentPhase2(regP2: any) {
  return {
    required: regP2.required ?? {},
    valueFormat: regP2.valueFormat ?? {},
    placeholderBlacklist: regP2.placeholderBlacklist ?? [],
    topLevelOrder:
      regP2.topLevelOrder ?? ["metadata", "anchorsGrouped", "files"],
  };
}

/* =========================================================
 * Phase1 sanitize + guard
 * =======================================================*/
function sanitizePhase1(
  phase1Raw: any,
  regP1: any,
  templateKey: string
) {
  const clean = cloneJson(phase1Raw);

  ensurePhase1Shape(clean);

  // fill defaults from registry phase1 defaults
  applyDefaultsPhase1(clean, regP1);

  // normalize IF booleans
  const ifGroup = clean.anchorsGrouped.if;
  for (const k of Object.keys(ifGroup)) {
    ifGroup[k] = toBool(ifGroup[k]);
  }

  // normalize structured text fields
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

  // resConfigs sanitize
  let resConfigs = clean.anchorsGrouped.gradle.resConfigs;
  if (!Array.isArray(resConfigs)) resConfigs = [];
  resConfigs = resConfigs
    .map((x: any) => String(x))
    .filter((x: string) => LOCALE_ITEM.test(x));
  if (!resConfigs.length) {
    const def = regP1.defaults?.gradle?.resConfigs ?? ["en"];
    resConfigs = def.filter((x: string) => LOCALE_ITEM.test(x));
    if (!resConfigs.length) resConfigs = ["en"];
  }
  clean.anchorsGrouped.gradle.resConfigs = resConfigs;

  // permissions sanitize
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

  // RUNID
  const runIdRaw =
    textGroup["NDJC:BUILD_META:RUNID"] ||
    clean.metadata["NDJC:BUILD_META:RUNID"] ||
    "auto";
  clean.metadata["NDJC:BUILD_META:RUNID"] = coerceRunId(runIdRaw);
  textGroup["NDJC:BUILD_META:RUNID"] =
    clean.metadata["NDJC:BUILD_META:RUNID"];

  return clean;
}

function applyDefaultsPhase1(clean: any, regP1: any) {
  const g = clean.anchorsGrouped;
  const defsText = regP1.defaults?.text ?? {};
  const defsList = regP1.defaults?.list ?? {};
  const defsGradle = regP1.defaults?.gradle ?? {};

  // text defaults
  Object.keys(defsText).forEach((k) => {
    if (!existsNonEmpty(g.text[k])) {
      g.text[k] = defsText[k];
    }
  });

  // list defaults
  Object.keys(defsList).forEach((k) => {
    if (!Array.isArray(g.list[k]) || g.list[k].length === 0) {
      g.list[k] = defsList[k];
    }
  });

  // gradle defaults
  Object.keys(defsGradle).forEach((k) => {
    const cur = (g.gradle as any)[k];
    if (!existsNonEmpty(cur)) {
      (g.gradle as any)[k] = defsGradle[k];
    }
  });
}

function guardPhase1(clean: any, regP1: any) {
  // verify required
  const g = clean.anchorsGrouped;
  const req = regP1.required ?? {};
  const reqTextKeys: string[] = req.text ?? [];
  const reqListKeys: string[] = req.list ?? [];
  const reqGradleKeys: string[] = req.gradle ?? [];

  for (const key of reqTextKeys) {
    if (!existsNonEmpty(g.text[key])) {
      throw new Error(`Phase1 guard: missing required text.${key}`);
    }
  }
  for (const key of reqListKeys) {
    if (
      !Array.isArray(g.list[key]) ||
      g.list[key].length === 0
    ) {
      throw new Error(`Phase1 guard: missing required list.${key}`);
    }
  }
  for (const key of reqGradleKeys) {
    const cur = (g.gradle as any)[key];
    if (!existsNonEmpty(cur)) {
      throw new Error(
        `Phase1 guard: missing required gradle.${key}`
      );
    }
  }

  // packageId / applicationId
  if (!PKG_REGEX.test(g.gradle.applicationId)) {
    throw new Error(
      `Phase1 guard: invalid packageId ${g.gradle.applicationId}`
    );
  }

  // DATA_SOURCE must be https://
  if (
    !/^https:\/\//.test(
      g.text["NDJC:DATA_SOURCE"] ?? ""
    )
  ) {
    throw new Error(
      "Phase1 guard: NDJC:DATA_SOURCE must start with https://"
    );
  }

  // RUNID format
  const runId = g.text["NDJC:BUILD_META:RUNID"];
  if (!/^run_[0-9]{8}_[0-9]{3}$/.test(runId)) {
    throw new Error(
      `Phase1 guard: invalid RUNID ${runId}`
    );
  }
}

/* =========================================================
 * Phase2 validation
 * =======================================================*/
function validatePhase2(
  phase2Raw: any,
  phase1Clean: any,
  regP2: any
) {
  const violations: string[] = [];
  const finalPlan = cloneJson(phase2Raw);

  ensurePhase2Shape(finalPlan);

  // text/if/list/gradle must match phase1
  lockAndCompareGroups(
    finalPlan,
    phase1Clean,
    violations,
    ["text", "if", "list", "gradle"]
  );

  // required blocks
  const reqBlockKeys: string[] =
    regP2.required?.block ?? [];
  const hasBlockGroup =
    finalPlan.anchorsGrouped.block &&
    typeof finalPlan.anchorsGrouped.block === "object";
  if (!hasBlockGroup) {
    violations.push(
      "Phase2: missing anchorsGrouped.block"
    );
  }

  for (const bKey of reqBlockKeys) {
    const val =
      finalPlan.anchorsGrouped.block?.[bKey];
    if (
      !val ||
      typeof val !== "string" ||
      !val.trim()
    ) {
      violations.push(
        `Phase2: required block.${bKey} missing or empty`
      );
    } else {
      const vf =
        regP2.valueFormat?.block?.[bKey];
      if (vf?.regex) {
        const r = new RegExp(vf.regex);
        if (!r.test(val)) {
          violations.push(
            `Phase2: block.${bKey} failed regex`
          );
        }
      }
      if (
        containsForbiddenPlaceholder(
          val,
          regP2.placeholderBlacklist
        )
      ) {
        violations.push(
          `Phase2: block.${bKey} contains forbidden placeholder text`
        );
      }
    }
  }

  // hook group consistency
  const hasHookGroup =
    finalPlan.anchorsGrouped.hook &&
    typeof finalPlan.anchorsGrouped.hook === "object";
  if (!hasHookGroup) {
    violations.push(
      "Phase2: missing anchorsGrouped.hook"
    );
  } else {
    enforceHookFeatureConsistency(
      finalPlan,
      phase1Clean,
      violations
    );
  }

  // feature leak heuristic
  const ifFlags =
    phase1Clean.anchorsGrouped.if || {};
  checkFeatureLeak(
    finalPlan,
    ifFlags,
    "IF:ENABLE_COMMENTS",
    [
      "BLOCK:COMMENTS_SCREEN",
      "BLOCK:COMMENT_ITEM",
    ],
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
    [
      "BLOCK:POST_COMPOSER",
      "BLOCK:POST_CARD",
      "BLOCK:MEDIA_PICKER",
    ],
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
      // copy p1 locked group so structure remains valid
      fpG[grp] = cloneJson(p1G[grp] || {});
      continue;
    }
    const aKeys = Object.keys(fpG[grp]);
    const bKeys = Object.keys(p1G[grp] || {});
    if (aKeys.length !== bKeys.length) {
      violations.push(
        `Phase2: group "${grp}" keycount mismatch`
      );
    }
    for (const k of bKeys) {
      if (!(k in fpG[grp])) {
        violations.push(
          `Phase2: group "${grp}" missing key "${k}"`
        );
        continue;
      }
      if (
        !deepEqualJson(
          fpG[grp][k],
          p1G[grp][k]
        )
      ) {
        violations.push(
          `Phase2: group "${grp}" key "${k}" modified between phase1 and phase2`
        );
      }
    }
  }

  const p1RunId =
    phase1Clean.metadata?.[
      "NDJC:BUILD_META:RUNID"
    ] ||
    phase1Clean.anchorsGrouped?.text?.[
      "NDJC:BUILD_META:RUNID"
    ];
  if (p1RunId) {
    if (!finalPlan.metadata) finalPlan.metadata = {};
    finalPlan.metadata["NDJC:BUILD_META:RUNID"] =
      p1RunId;
  }
}

// hooks must respect feature flags
function enforceHookFeatureConsistency(
  finalPlan: any,
  phase1Clean: any,
  violations: string[]
) {
  const hooks =
    finalPlan.anchorsGrouped.hook || {};
  const ifFlags =
    phase1Clean.anchorsGrouped.if || {};

  function isActive(flagName: string) {
    return !!toBool(ifFlags[flagName]);
  }

  // posting
  if (isActive("IF:ENABLE_POSTING")) {
    const postSubmit = hooks["HOOK:POST_SUBMIT"];
    const uploadMedia = hooks["HOOK:UPLOAD_MEDIA"];
    if (isAllNoop([postSubmit, uploadMedia])) {
      violations.push(
        "Phase2: posting enabled but HOOK:POST_SUBMIT / HOOK:UPLOAD_MEDIA are all noop"
      );
    }
  }

  // comments
  if (isActive("IF:ENABLE_COMMENTS")) {
    const fetchComments = hooks["HOOK:FETCH_COMMENTS"];
    const commentSubmit = hooks["HOOK:COMMENT_SUBMIT"];
    if (isAllNoop([fetchComments, commentSubmit])) {
      violations.push(
        "Phase2: comments enabled but comment hooks are all noop"
      );
    }
  }

  // likes
  if (isActive("IF:ENABLE_LIKES")) {
    const likeToggle = hooks["HOOK:LIKE_TOGGLE"];
    if (isAllNoop([likeToggle])) {
      violations.push(
        "Phase2: likes enabled but HOOK:LIKE_TOGGLE is noop"
      );
    }
  }

  // notifications
  if (isActive("IF:SHOW_NOTIFICATIONS")) {
    const notifHook = hooks["HOOK:FETCH_NOTIFICATIONS"];
    if (isAllNoop([notifHook])) {
      violations.push(
        "Phase2: notifications enabled but HOOK:FETCH_NOTIFICATIONS is noop"
      );
    }
  } else {
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
  if (enabled) return;

  const blocks =
    finalPlan.anchorsGrouped.block || {};
  for (const bKey of blockKeys) {
    const val = blocks[bKey];
    if (!val) continue;
    // Heuristic: detect interactive UI that shouldn't exist if feature is off
    if (
      /(TextField|LazyColumn|Button|IconButton|onClick)/.test(
        val
      )
    ) {
      violations.push(
        `Phase2: ${flagName} is false, but ${bKey} looks interactive`
      );
    }
  }
}

/* =========================================================
 * Helpers / utils
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

// Phase1 shape: only config groups (text/if/list/gradle)
function ensurePhase1Shape(clean: any) {
  if (!clean.metadata) clean.metadata = {};
  if (!clean.anchorsGrouped) clean.anchorsGrouped = {};
  if (!clean.files) clean.files = [];

  const g = clean.anchorsGrouped;
  g.text = g.text || {};
  g.if = g.if || {};
  g.list = g.list || {};
  g.gradle = g.gradle || {};

  // explicitly DROP any block/hook if LLM hallucinated them
  if (g.block) delete g.block;
  if (g.hook) delete g.hook;
}

// Phase2 shape: must include block/hook too
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

function normalizeJsonObject(
  input: any,
  fallback: Record<string, any>
) {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  )
    return input;
  if (typeof input === "string") {
    const s = input.trim();
    try {
      const obj = JSON.parse(s);
      if (
        obj &&
        typeof obj === "object" &&
        !Array.isArray(obj)
      ) {
        return obj;
      }
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

function ensurePkg(
  v?: string,
  fallback = "com.example.ndjc"
) {
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
  if (typeof v === "string")
    return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object")
    return Object.keys(v).length > 0;
  return true;
}

function coerceRunId(v: any): string {
  const s = String(v ?? "").trim();
  if (/^run_[0-9]{8}_[0-9]{3}$/.test(s)) return s;
  return `run_${genDateStamp()}_000`;
}

function genDateStamp() {
  const d = new Date();
  const yyyy = d
    .getUTCFullYear()
    .toString()
    .padStart(4, "0");
  const mm = String(
    d.getUTCMonth() + 1
  ).padStart(2, "0");
  const dd = String(
    d.getUTCDate()
  ).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function deepEqualJson(a: any, b: any): boolean {
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
  return xs.every((x) => {
    if (x == null) return true;
    if (typeof x === "string")
      return x.trim().toLowerCase() === "noop";
    if (typeof x === "object") {
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

function containsForbiddenPlaceholder(
  str: string,
  blacklist: string[] = []
) {
  const lower = str.toLowerCase();
  for (const word of blacklist) {
    if (!word) continue;
    if (
      lower.includes(
        String(word).toLowerCase()
      )
    ) {
      return true;
    }
  }
  const builtIns = [
    "lorem",
    "tbd",
    "n/a",
    "ready",
    "content ready for rendering",
  ];
  return builtIns.some((w) =>
    lower.includes(w)
  );
}
