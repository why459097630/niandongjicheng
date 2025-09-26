import { Plan } from "../types";

const PKG = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function validate(plan: Plan) {
  const pkg = plan.anchors["NDJC:PACKAGE_NAME"];
  if (!pkg || !PKG.test(pkg)) throw new Error("Invalid packageName");
  // 限制 companions 路径必须在 app/**
  for (const f of plan.companions ?? []) {
    if (!f.path.startsWith("app/")) throw new Error(`Companion path out of app/: ${f.path}`);
    if (f.path.includes("..")) throw new Error(`Illegal path: ${f.path}`);
  }
}
