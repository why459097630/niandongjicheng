// /lib/ndjc/diff.ts
import type { ApplyFile } from "@/lib/ndjc/generator";

/**
 * 在带 NDJC 标记的文本中替换指定 key 的内容
 * 支持两种注释风格： // ... 与 <!-- ... -->
 */
export function injectBetweenMarkers(
  original: string,
  key: string,
  replacement: string
): string {
  // 允许 // 或 <!-- 两种开头，允许 END 处有 --> 结尾
  const beginRe = new RegExp(
    `((?:\\/\\/)|(?:<!--))\\s*NDJC:BEGIN\\(${key}\\)\\s*(?:-->)?`
  );
  const endRe = new RegExp(
    `((?:\\/\\/)|(?:<!--))\\s*NDJC:END\\(${key}\\)\\s*(?:-->)?`
  );

  const beginMatch = original.match(beginRe);
  const endMatch = original.match(endRe);
  if (!beginMatch || !endMatch) {
    throw new Error(`Marker not found: ${key}`);
  }

  const beginIdx = original.indexOf(beginMatch[0]) + beginMatch[0].length;
  const endIdx = original.indexOf(endMatch[0]);
  if (endIdx <= beginIdx) throw new Error(`Marker order error: ${key}`);

  return original.slice(0, beginIdx) + `\n${replacement}\n` + original.slice(endIdx);
}

/**
 * 生成一个带 NDJC 标记的布局基线（可安全覆盖）
 * 说明：不依赖包名与 Activity，避免破坏现有模板
 */
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

/**
 * 由 Prompt（或 GROQ 返回的结构化数据）构造 UI 片段，并注入到布局基线
 * 这里演示：标题 + 正文 + 按钮
 */
export async function buildDiffFilesFromGroq(input: {
  prompt: string;
  template?: string;
  appName?: string;
}): Promise<ApplyFile[]> {
  // —— 这里你未来可替换为真正的 GROQ 结构化输出 ——
  const title = (input.appName || "My NDJC App").slice(0, 40);
  const bodyText = (input.prompt || "Hello from NDJC").slice(0, 140);
  const buttonText = "Get Started";

  // 注入到布局
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

  let layout = baseActivityMainXML();
  layout = injectBetweenMarkers(layout, "header", header);
  layout = injectBetweenMarkers(layout, "body", body);
  layout = injectBetweenMarkers(layout, "actions", actions);

  // 产出要写入的文件（可继续扩展 strings.xml / colors.xml 等）
  const files: ApplyFile[] = [
    {
      path: "app/src/main/res/layout/activity_main.xml",
      content: layout,
    },
  ];

  return files;
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
