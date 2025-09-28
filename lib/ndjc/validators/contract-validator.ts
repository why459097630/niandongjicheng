// lib/ndjc/validators/contract-validator.ts
import Ajv, { ErrorObject } from "ajv";

// 可选加载 ajv-formats，缺失时忽略，保证构建不会崩
async function tryAddFormats(ajv: Ajv) {
  try {
    const mod = await import("ajv-formats");
    (mod as any).default?.(ajv);
  } catch {
    console.warn("[NDJC] ajv-formats not installed, skip format checks");
  }
}

import schema from "../contract/ndjc-android-contract-v1.schema.json" assert { type: "json" };

export type SchemaResult =
  | { ok: true }
  | { ok: false; issues: { code: string; message: string; path?: string }[] };

let _validator: ((data: unknown) => boolean) | null = null;
let _ajv: Ajv | null = null;

async function getAjv(): Promise<Ajv> {
  if (_ajv) return _ajv;
  const ajv = new Ajv({ allErrors: true, strict: false });
  await tryAddFormats(ajv); // 加 formats（可选）
  _validator = ajv.compile(schema as any);
  _ajv = ajv;
  return ajv;
}

export async function validateContractV1(data: unknown): Promise<SchemaResult> {
  const ajv = await getAjv();
  const validate = _validator!;
  const ok = validate(data);
  if (ok) return { ok: true };

  const issues = (validate.errors || []).map((e: ErrorObject) => ({
    code: "E_SCHEMA",
    message: `${e.instancePath || "<root>"} ${e.message || ""}`.trim(),
    path: (e.instancePath || "<root>").replace(/^\//, "").replace(/\//g, "."),
  }));
  return { ok: false, issues };
}
