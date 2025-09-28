import type { ContractV1, FileKind } from "../contract/types";
import { PATH_RULES, FORBID_LAYOUT_DIR, PACKAGE_ID_PREFIX, ALLOWED_FILE_KINDS } from "../constants/contract";

export function checkPaths(doc: ContractV1) {
  const issues: { code: string; message: string; path?: string }[] = [];

  if (!PACKAGE_ID_PREFIX.test(doc.metadata.packageId)) {
    issues.push({ code: "E_PACKAGE_PREFIX", message: `packageId must start with app.ndjc.`, path: "metadata.packageId" });
  }

  for (const f of doc.files) {
    if (!(ALLOWED_FILE_KINDS as readonly FileKind[]).includes(f.kind)) {
      issues.push({ code: "E_FILE_KIND", message: `unsupported kind: ${f.kind} (${f.path})`, path: `files.${f.path}` });
      continue;
    }
    if (FORBID_LAYOUT_DIR.test(f.path)) {
      issues.push({ code: "E_PATH_LAYOUT", message: `layout directory is forbidden: ${f.path}`, path: `files.${f.path}` });
      continue;
    }
    const rule = (PATH_RULES as any)[f.kind];
    if (rule && !rule.test(f.path)) {
      issues.push({ code: "E_PATH_FORMAT", message: `path not allowed for kind ${f.kind}: ${f.path}`, path: `files.${f.path}` });
    }
    if (f.path.includes("..") || f.path.startsWith("/")) {
      issues.push({ code: "E_PATH_TRAVERSAL", message: `path traversal/absolute forbidden: ${f.path}`, path: `files.${f.path}` });
    }
  }

  if (doc.anchors.gradle?.applicationId && doc.anchors.gradle.applicationId !== doc.metadata.packageId) {
    issues.push({ code: "E_APPID_MISMATCH", message: `gradle.applicationId != metadata.packageId`, path: "anchors.gradle.applicationId" });
  }
  if (doc.anchors.text?.["NDJC:PACKAGE_NAME"] && doc.anchors.text["NDJC:PACKAGE_NAME"] !== doc.metadata.packageId) {
    issues.push({ code: "E_PKGNAME_MISMATCH", message: `anchors text PACKAGE_NAME != metadata.packageId`, path: "anchors.text.NDJC:PACKAGE_NAME" });
  }

  return { ok: issues.length === 0, issues };
}
