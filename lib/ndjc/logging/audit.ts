import fs from "fs";
import path from "path";

export function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }
export function writeJson(p: string, obj: any) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
