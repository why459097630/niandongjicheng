import type { ContractV1 } from "../contract/types";
import { validateSchema } from "./contract-validator";
import { checkLimits } from "./limits";
import { checkSecurity } from "./security-rules";
import { checkPaths } from "./path-rules";
import { lintContract } from "./lint-contract";

export interface ValidationIssue { code: string; message: string; path?: string; }
export interface ValidationResult { ok: boolean; issues: ValidationIssue[]; }

export function validateContractV1(doc: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const schema = validateSchema(doc);
  issues.push(...schema.issues);
  if (!schema.ok) return { ok: false, issues };

  const contract = doc as ContractV1;
  const lists = [
    checkLimits(contract),
    checkSecurity(contract),
    checkPaths(contract),
    lintContract(contract)
  ];
  for (const r of lists) issues.push(...(r.issues as any));
  return { ok: issues.length === 0, issues };
}
