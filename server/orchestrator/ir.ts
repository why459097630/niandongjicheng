import { Plan } from "../types";
export interface GenerateInput {
  template_key: string;
  mode: "A" | "B";
  fields: { appName?: string; homeTitle?: string; mainButtonText?: string; packageId?: string };
  lists?: Record<string, unknown>;
  blocks?: Record<string, unknown>;
  companions?: { path: string; kind: string; content: string; overwrite?: boolean }[];
}

export function toPlan(input: GenerateInput, runId: string): Plan {
  return {
    runId,
    template_key: input.template_key,
    mode: input.mode,
    anchors: {
      "NDJC:APP_LABEL": input.fields.appName,
      "NDJC:HOME_TITLE": input.fields.homeTitle,
      "NDJC:PRIMARY_BUTTON_TEXT": input.fields.mainButtonText,
      "NDJC:PACKAGE_NAME": input.fields.packageId,
    },
    lists: input.lists ?? {},
    blocks: input.blocks ?? {},
    companions: input.companions?.map(c => ({
      path: c.path,
      kind: (c.kind as any) ?? "kotlin",
      content: c.content,
      overwrite: c.overwrite ?? false
    })) ?? [],
  };
}
