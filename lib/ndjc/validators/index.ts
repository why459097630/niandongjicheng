// lib/ndjc/validators/index.ts
import type { ContractV1 } from "../contract/types";
import { validateContractV1 as validateSchema } from "./contract-validator";
import { checkLimits } from "./limits";
import { checkSecurity } from "./security-rules";
import { checkPaths } from "./path-rules";
import { lintContract } from "./lint-contract";

export interface ValidationIssue { code: string; message: string; path?: string; path2?: string; }
export interface ValidationResult { ok: boolean; issues: ValidationIssue[]; }

/**
 * 顶层校验入口：
 * 1) 先跑 schema（Ajv）——异步
 * 2) 通过后再跑语义/安全/路径/lint 等规则
 * 3) issues 汇总返回（目前维持“有任一 issue 即 ok=false”的旧行为）
 */
export async function validateContractV1(doc: unknown): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  // 1) Schema（异步，内部可选加载 ajv-formats）
  const schema = await validateSchema(doc);
  issues.push(...schema.issues);
  if (!schema.ok) return { ok: false, issues };

  // 2) 其余规则（同步）
  const contract = doc as ContractV1;
  const results = [
    checkLimits(contract),
    checkSecurity(contract),
    checkPaths(contract),
    lintContract(contract),
  ];
  for (const r of results) issues.push(...(r.issues as any));

  // 与现有逻辑保持一致：只要有 issue 就认为不 OK（如需仅拦截 E_*，这里可改判定条件）
  return { ok: issues.length === 0, issues };
}
