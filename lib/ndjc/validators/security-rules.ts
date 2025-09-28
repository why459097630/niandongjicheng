// lib/ndjc/validators/security-rules.ts
import type { ContractV1 } from "../contract/types";
import { FORBIDDEN_PERMISSIONS } from "../constants/contract";

type Issue = { code: string; message: string; path?: string };

/**
 * 安全规则校验（最小集）：
 * 1) Manifest 权限黑名单：FORBIDDEN_PERMISSIONS
 */
export function checkSecurity(doc: ContractV1): { issues: Issue[] } {
  const issues: Issue[] = [];

  // --- 1) 权限黑名单（对可能为 undefined 的字段做兜底） ---
  const perms: unknown = (doc as any)?.patches?.manifest?.permissions ?? [];
  if (Array.isArray(perms)) {
    for (const p of perms) {
      if (FORBIDDEN_PERMISSIONS.has(p)) {
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
