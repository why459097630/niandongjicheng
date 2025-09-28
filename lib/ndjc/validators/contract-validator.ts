import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "../contract/ndjc-android-contract-v1.schema.json" assert { type: "json" };

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema as any);

export function validateSchema(doc: unknown) {
  const ok = validate(doc) as boolean;
  if (ok) return { ok: true, issues: [] as { code: string; message: string; path?: string }[] };
  const issues = (validate.errors || []).map(e => ({
    code: "E_SCHEMA",
    message: `${e.instancePath || "/"} ${e.message}`,
    path: e.instancePath || ""
  }));
  return { ok: false, issues };
}
