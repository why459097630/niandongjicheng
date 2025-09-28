// lib/ndjc/validators/contract-validator.ts
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

// 动态加载 ajv-formats，缺失时不报错，保证构建不受阻
async function tryAddFormats(ajv: Ajv) {
  try {
    const mod = await import("ajv-formats");
    (mod as any).default?.(ajv);
  } catch {
    console.warn("[NDJC] ajv-formats not installed, skip format checks");
  }
}

// 注意：这里的相对路径保持与你仓库一致
import schema from "../contract/ndjc-android-contract-v1.schema.json" assert { type: "json" };

export interface SchemaIssue {
  code: string;
  message: string;
  path?: string;
}
export interface SchemaResult {
  ok: boolean;
  issues: SchemaIssue[];
}

let _ajv: Ajv | null = null;
let _validate: ValidateFunction | null = null;

async function getAjv(): Promise<Ajv> {
  if (_ajv) return _ajv;
  const ajv = new Ajv({
    allErrors: true,
    strict: false,        // 合同演进期，放宽严格模式
    allowUnionTypes: true,
  });
  await tryAddFormats(ajv);
  _ajv = ajv;
  return ajv;
}

async function getValidator(): Promise<ValidateFunction> {
  if (_validate) return _validate;
  const ajv = await getAjv();
  _validate = ajv.compile(schema as any) as ValidateFunction;
  return _validate!;
}

/** JSON Schema 层校验，仅做结构和类型检查 */
export async function validateSchema(doc: unknown): Promise<SchemaResult> {
  const validate = await getValidator();
  const ok = (validate(doc) as boolean) === true;

  if (ok) {
    return { ok: true, issues: [] };
  }

  const issues = ((validate.errors ?? []) as ErrorObject[]).map((e) => ({
    code: "E_SCHEMA",
    message: `${e.message || ""}`.trim(),
    path: (e.instancePath || "<root>").replace(/^\/+/, "").replace(/\/+/g, "."),
  }));

  return { ok: false, issues };
}

// 为了向后兼容你之前导出的名字（如果有地方引用了 validateContractV1）：
export const validateContractV1 = validateSchema;
