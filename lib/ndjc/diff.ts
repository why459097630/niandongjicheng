// /lib/ndjc/diff.ts
import type { ApplyFile } from "@/lib/ndjc/generator";

/** 在带 NDJC 标记的文本中替换指定 key 的内容（支持 // 与 <!-- --> 两种注释） */
export function injectBetweenMarkers(
  original: string,
  key: string,
  replacement: string
): string {
  const beginRe = new RegExp(`((?:\\/\\/)|(?:<!--))\\s*NDJC:BEGIN\\(${key}\\)\\s*(?:-->)?`);
  const endRe   = new RegExp(`((?:\\/\\/)|(?:<!--))\\s*NDJC:END\\(${key}\\)\\s*(?:-->)?`);
  const beginMatch = original.match(beginRe);
  const endMatch   = original.match(endRe);
  if (!beginMatch || !endMatch) throw new Error(`Marker not found: ${key}`);

  const beginIdx = original.indexOf(beginMatch[0]) + beginMatch[0].length;
  const endIdx   = original.indexOf(endMatch[0]);
  if (endIdx <= beginIdx) throw new Error(`Marker order error: ${key}`);

  return original.slice(0, beginIdx) + `\n${replacement}\n` + original.slice(endIdx);
}

/** 基线布局（三处可写区），不依赖外部资源 */
export function baseActivityMainXML(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp">

    <!-- NDJC:BEGIN(header) -->
    <!-- NDJC:END(header) -->

    <!-- NDJC:BEGIN(body) -->
    <!-- NDJC:END(body) -->

    <!-- NDJC:BEGIN(actions) -->
    <!-- NDJC:END(actions) -->

</LinearLayout>
`;
}

/** 在布局末尾附加“兼容占位 ID”，防止 Java 里引用的旧 id 编译报错 */
function appendCompatPlaceholders(layout: string, ids: string[]): string {
  if (!ids.length) return layout;
  const placeholders = ids.map(id => (
    `<View android:id="@+id/${id}" android:layout_width="0dp" android:layout_height="0dp" android:visibility="gone"/>`
  )).join("\n");

  // 统一插到 actions 可写区后面，仍在根 LinearLayout 内
  let withCompat = layout;
  const insertKey = "actions";
  try {
    withCompat = injectBetweenMarkers(withCompat, insertKey, `<!-- NDJC generated actions -->`);
  } catch { /* 如果没找到也忽略，兼容老模板 */ }

  // 在根结尾 </LinearLayout> 之前插入（双保险）
  return withCompat.replace(/<\/LinearLayout>\s*$/m, `${placeholders}\n\n</LinearLayout>`);
}

/** 由输入构造 UI 片段并注入；自动附加兼容 ID */
export async function buildDiffFilesFromGroq(input: {
  prompt: string;
  template?: string;
  appName?: string;
}): Promise<ApplyFile[]> {
  const title = (input.appName || "NDJCApp").slice(0, 40);
  const bodyText = (input.prompt || "Hello from NDJC").slice(0, 140);
  const buttonText = "Get started";

  const header = `<TextView
        android:id="@+id/ndjcTitle"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="${escapeXml(title)}"
        android:textSize="22sp"
        android:textStyle="bold"
        android:paddingBottom="12dp"/>`;

  const body = `<TextView
        android:id="@+id/ndjcBody"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="${escapeXml(bodyText)}"
        android:textSize="16sp"
        android:paddingBottom="16dp"/>`;

  const actions = `<Button
        android:id="@+id/ndjcPrimary"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="${escapeXml(buttonText)}"/>`;

  // 注入三处可写区
  let layout = baseActivityMainXML();
  layout = injectBetweenMarkers(layout, "header", header);
  layout = injectBetweenMarkers(layout, "body", body);
  layout = injectBetweenMarkers(layout, "actions", actions);

  // 兼容：自动补上常见旧 ID（可按需拓展）
  const compatIds = ["textView", "button"]; // 如果后续日志提示更多，就加到这个列表
  layout = appendCompatPlaceholders(layout, compatIds);

  return [
    { path: "app/src/main/res/layout/activity_main.xml", content: layout },
  ];
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
