import type { ContractV1 } from "../contract/types";
import { FORBIDDEN_PERMISSIONS, HARD_IP_REGEX, HARD_URL_REGEX, REFLECTION_REGEX, DYNAMIC_LOAD_REGEX, SCRIPT_EXEC_REGEX } from "../constants/contract";

export function checkSecurity(doc: ContractV1) {
  const issues: { code: string; message: string; path?: string }[] = [];

  for (const p of doc.patches.manifest.permissions) {
    if (FORBIDDEN_PERMISSIONS.has(p)) {
      issues.push({ code: "E_SECURITY_PERMISSION", message: `forbidden permission: ${p}`, path: `patches.manifest.permissions` });
    }
  }

  const checkText = (s: string, where: string) => {
    if (HARD_IP_REGEX.test(s)) issues.push({ code: "E_SECURITY_IP", message: `hard-coded IP in ${where}`, path: where });
    if (HARD_URL_REGEX.test(s)) issues.push({ code: "E_SECURITY_URL", message: `hard-coded URL in ${where}`, path: where });
    if (REFLECTION_REGEX.test(s)) issues.push({ code: "E_SECURITY_REFLECT", message: `reflection in ${where}`, path: where });
    if (DYNAMIC_LOAD_REGEX.test(s)) issues.push({ code: "E_SECURITY_DLOAD", message: `dynamic class loading in ${where}`, path: where });
    if (SCRIPT_EXEC_REGEX.test(s)) issues.push({ code: "E_SECURITY_EXEC", message: `script execution in ${where}`, path: where });
  };

  for (const f of doc.files) checkText(f.content, `files.${f.path}`);
  for (const k of Object.keys(doc.anchors.block)) checkText(doc.anchors.block[k], `anchors.block.${k}`);

  return { ok: issues.length === 0, issues };
}
