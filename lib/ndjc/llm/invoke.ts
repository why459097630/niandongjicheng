import fs from "fs";
import path from "path";
import { parseStrictJson } from "./strict-json";
import { validateContractV1 } from "../validators";

export interface InvokeResult { raw: string; parsed?: any; validation?: ReturnType<typeof validateContractV1>; }

export async function invokeContractV1LLM(opts: { runId: string; systemPath: string; developerPath: string; prompt: string; call: (sys: string, dev: string, user: string) => Promise<string>; outDir: string; }) {
  const system = fs.readFileSync(opts.systemPath, "utf8");
  const developer = fs.readFileSync(opts.developerPath, "utf8");
  const raw = await opts.call(system, developer, opts.prompt);

  fs.writeFileSync(path.join(opts.outDir, "00_prompt.json"), JSON.stringify({ system, developer, user: opts.prompt }, null, 2));
  fs.writeFileSync(path.join(opts.outDir, "00_raw.txt"), raw);

  const parsed = parseStrictJson(raw);
  if (!parsed.ok) {
    const validation = { ok: false, issues: [{ code: "E_NOT_JSON", message: parsed.error, path: "<root>" }] } as const;
    fs.writeFileSync(path.join(opts.outDir, "00_contract_check.json"), JSON.stringify(validation, null, 2));
    return { raw, parsed: undefined, validation } as InvokeResult;
  }

  const validation = validateContractV1(parsed.data);
  fs.writeFileSync(path.join(opts.outDir, "00_contract_check.json"), JSON.stringify(validation, null, 2));
  return { raw, parsed: parsed.data, validation } as InvokeResult;
}
