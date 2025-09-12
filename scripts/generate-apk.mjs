#!/usr/bin/env node

// scripts/generate-apk.mjs
import 'dotenv/config';
import * as path from 'node:path';
import {
  newRunId, writeJSON, writeText, getRepoPath,
} from '../lib/ndjc/journal.js';
import { orchestrate } from '../lib/ndjc/orchestrator.js';
import {
  buildPlan, applyPlanDetailed, materializeToWorkspace, cleanupAnchors,
} from '../lib/ndjc/generator.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : '1';
      args[k] = v;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const input = {
    template: args.template || process.env.NDJC_TEMPLATE || 'core',
    mode: (args.mode || process.env.NDJC_MODE || 'A'),
    allowCompanions: (process.env.NDJC_ALLOW_COMPANIONS === '1'),
    requirement: args.requirement || process.env.NDJC_REQUIREMENT || '',
    appName: process.env.NDJC_APP_NAME,
    packageId: process.env.NDJC_PACKAGE_ID,
    // 你还可以按需透传更多字段……
  };

  const runId = newRunId();
  await writeJSON(runId, '00_input.json', input);

  const o = await orchestrate(input);
  await writeJSON(runId, '01_orchestrator.json', o);

  const plan = buildPlan(o);
  await writeJSON(runId, '02_plan.json', plan);

  const material = await materializeToWorkspace(o.template);
  await writeText(runId, '04_materialize.txt', `app copied to: ${material.dstApp}`);

  const applyResult = await applyPlanDetailed(plan);
  await writeJSON(runId, '03_apply_result.json', applyResult);

  await cleanupAnchors();
  await writeText(runId, '03b_cleanup.txt', 'NDJC/BLOCK anchors stripped');

  // 汇总（可简化）
  await writeText(runId, '05_summary.md', `NDJC run=${runId}
template=${o.template}
appName=${o.appName}
repo=${getRepoPath()}
`);

  // 控制台输出 runId，供工作流后续步骤使用
  console.log(JSON.stringify({ ok: true, runId }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
