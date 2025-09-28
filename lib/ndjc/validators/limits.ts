import type { ContractV1 } from "../contract/types";
import { MAX_ANCHORS_TEXT_BYTES } from "../constants/contract";

export function checkLimits(doc: ContractV1) {
  const issues: { code: string; message: string; path?: string }[] = [];
  const fmax = doc.metadata.constraints.maxFiles;
  if (doc.files.length > fmax) issues.push({ code: "E_LIMITS_FILES", message: `files.length>${fmax}`, path: "files" });
  const kb = doc.metadata.constraints.maxFileKB;
  for (const f of doc.files) {
    const sizeKB = Math.ceil(Buffer.byteLength(f.content, f.encoding === "utf8" ? "utf8" : "base64") / 1024);
    if (sizeKB > kb) issues.push({ code: "E_LIMITS_FILE_SIZE", message: `${f.path} > ${kb}KB`, path: `files.${f.path}` });
  }
  const anchorsText = JSON.stringify(doc.anchors);
  if (Buffer.byteLength(anchorsText, "utf8") > MAX_ANCHORS_TEXT_BYTES) {
    issues.push({ code: "E_LIMITS_ANCHORS", message: `anchors > ${MAX_ANCHORS_TEXT_BYTES} bytes`, path: "anchors" });
  }
  return { ok: issues.length === 0, issues };
}
