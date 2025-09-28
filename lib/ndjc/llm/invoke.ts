// lib/ndjc/llm/invoke.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { parseStrictJson } from "@/lib/ndjc/llm/strict-json";
import { validateContractV1 } from "@/lib/ndjc/validators";
import type { ValidationResult } from "@/lib/ndjc/validators";

export type InvokeResult = {
  /** LLM 原始文本 */
  raw: string;
  /** 解析后的 JSON（若 parse 成功） */
  parsed?: any;
  /** 契约校验结果（schema+规则） */
  validation?: ValidationResult | null;
};

/**
 * 针对 Contract v1 的解析+校验封装
 * @param raw LLM 返回的原始文本
 * @param opts { outDir?: string, runId?: string } 可选落盘目录
 */
export async function checkContractV1(
  raw: string,
  opts: { outDir?: string; runId?: string } = {}
): Promise<InvokeResult> {
  const outDir = opts.outDir || (opts.runId ? path.join("/tmp/ndjc/requests", opts.runId) : "");
  const writeIf = (name: string, data: string) => {
    if (!outDir) return;
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, name), data);
    } catch {}
  };

  // 1) 先做严格 JSON 解析
  const parsed = parseStrictJson(raw);
  if (!parsed.ok) {
    const validation: ValidationResult = {
      ok: false,
      issues: [
        {
          code: "E_NOT_JSON",
          message: parsed.error,
          path: "<root>",
        },
      ],
    };
    writeIf("00_contract_check.json", JSON.stringify(validation, null, 2));
    return { raw, parsed: undefined, validation };
  }

  // 2) 通过 schema + 规则校验（异步）
  const validation = await validateContractV1(parsed.data);
  writeIf("00_contract_check.json", JSON.stringify(validation, null, 2));

  return { raw, parsed: parsed.data, validation };
}
