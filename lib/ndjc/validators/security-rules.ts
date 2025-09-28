// lib/ndjc/validators/security-rules.ts
import type { ContractV1 } from "../contract/types";
import { FORBIDDEN_PERMISSIONS } from "../constants/contract";

type Issue = { code: string; message: string; path?: string };

// 兼容常量既可能是 Set<string> 也可能是 string[] / readonly string[]
function asSet(v: unknown): Set<string> {
  if (v instanceof Set) return v as Set<string>;
  try {
    // v 可能是 readonly tuple；用展开转普通数组
    return new Set<string>([...(v as readonly string[])]);
  } catch {
    return new Set<string>();
  }
}

/**
 * 安全规则校验（最小集）：
 * 1) Manifest 权限黑名单：FORBIDDEN_PERMISSIONS
 */
export function checkSecurity(doc: ContractV1): { issues: Issue[] } {
  const issues: Issue[] = [];

  const permsList: unknown = (doc as any)?.patches?.manifest?.permissions ?? [];
  const forbidden = asSet(FORBIDDEN_PERMISSIONS);

  if (Array.isArray(permsList)) {
    for (const p of permsList) {
      if (forbidden.has(p)) {
        issues.push({
          code: "E_SECURITY_PERMISSION",
          message: `forbidden permission: ${p}`,
          path: "patches.manifest.permissions",
        });
      }
    }
  }

  return { issues };
}
