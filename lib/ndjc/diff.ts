// lib/ndjc/diff.ts
// 让“差异构建器”真正产出会被打包的资源文件

export type NdjcFile = { path: string; content: string };
export type NdjcFiles = NdjcFile[];

// 你自己的 GROQ 返回结构可能不同；做了容错抽取
function normalizeGroq(groq: any): { title: string; body: string; cta: string } {
  const textFromChoices =
    groq?.choices?.[0]?.message?.content ??
    groq?.choices?.[0]?.text ??
    groq?.message?.content ??
    groq?.text ??
    "";

  const raw = typeof groq === "string" ? groq : (groq?.title || groq?.body ? "" : textFromChoices);

  // 尝试从半结构化文本里抓标题/正文/按钮
  const title =
    groq?.title ||
    matchOne(raw, /(标题|title)\s*[:：]\s*(.+)/i) ||
    "NDJC App";
  const body =
    groq?.body ||
    matchOne(raw, /(正文|内容|description|body)\s*[:：]\s*([\s\S]+)/i) ||
    raw ||
    "这是由 NDJC/GROQ 注入的正文。";
  const cta =
    groq?.cta ||
    matchOne(raw, /(按钮|cta|button)\s*[:：]\s*(.+)/i) ||
    "Get started";

  return { title: title.trim(), body: body.trim(), cta: cta.trim() };
}

function matchOne(text: string, re: RegExp): string | undefined {
  const m = text?.match?.(re);
  return m?.[2] || m?.[1];
}

function xe(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function idsXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <!-- 兜底 id，保证 Java/Kotlin 编译期可引用 -->
  <item name="ndjcTitle" type="id"/>
  <item name="ndjcBody" type="id"/>
  <item name="ndjcPrimary" type="id"/>
</resources>
`;
}

function layoutXml(p: { title: string; body: string; cta: string }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp">

    <TextView
        android:id="@+id/ndjcTitle"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="${xe(p.title)}"
        android:textSize="22sp"
        android:textStyle="bold"
        android:paddingBottom="12dp"/>

    <TextView
        android:id="@+id/ndjcBody"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="${xe(p.body)}" />

    <Button
        android:id="@+id/ndjcPrimary"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="${xe(p.cta)}"
        android:layout_marginTop="16dp"/>
</LinearLayout>
`;
}

export async function buildDiffFilesFromGroq(groqResult: any): Promise<NdjcFiles> {
  const p = normalizeGroq(groqResult);
  const files: NdjcFiles = [];

  // 1) 兜底 id
  files.push({
    path: "app/src/main/res/values/ids.xml",
    content: idsXml(),
  });

  // 2) 真实布局，把 GROQ 内容写进去
  files.push({
    path: "app/src/main/res/layout/activity_main.xml",
    content: layoutXml(p),
  });

  // 3) 记录请求结果（方便排障/追溯）
  files.push({
    path: `app/src/main/assets/ndjc_${Date.now()}.txt`,
    content:
      `NDJC PLAN\n` +
      `title: ${p.title}\ncta: ${p.cta}\n\n--- body ---\n${p.body}\n`,
  });

  return files;
}
