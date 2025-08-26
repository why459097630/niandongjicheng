// lib/ndjc/generator.ts
import type { NdjcSpec } from "./groq-client";

export type NdjcPatch = {
  path: string;
  mode: "patch" | "replace" | "create";
  patches?: { anchor: string; insert: string }[];
  contentBase64?: string;
  content?: string;
};

export type NdjcPlan = {
  appName: string;
  packageName: string;
  files: NdjcPatch[];
};

function escJava(s: string) {
  return (s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function toPkgPath(pkg: string) {
  return (pkg || "com.example.app")
    .replace(/\s+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/\./g, "/");
}

/** —— 把 GROQ 的 Spec 映射成锚点差量补丁 —— */
export function planFromSpec(spec: NdjcSpec): NdjcPlan {
  const pkgPath = toPkgPath(spec.packageName);
  const mainActivity = `app/src/main/java/${pkgPath}/MainActivity.java`;
  const activityXml = "app/src/main/res/layout/activity_main.xml";
  const stringsXml  = "app/src/main/res/values/strings.xml";
  const manifestXml = "app/src/main/AndroidManifest.xml";
  const gradleFile  = "app/build.gradle";

  const files: NdjcPatch[] = [];

  // 1) UI → NDJC:VIEWS
  if (spec.ui?.viewsXml?.trim()) {
    files.push({
      path: activityXml,
      mode: "patch",
      patches: [{ anchor: "NDJC:VIEWS", insert: spec.ui.viewsXml.trim() + "\n" }],
    });
  }

  // 2) 逻辑 → NDJC:ONCREATE / NDJC:FUNCTIONS / NDJC:IMPORTS
  const onCreate = (spec.logic?.onCreate || []).map((s) => s.trim()).filter(Boolean);
  if (onCreate.length) {
    files.push({
      path: mainActivity,
      mode: "patch",
      patches: [{ anchor: "NDJC:ONCREATE", insert: onCreate.join("\n") + "\n" }],
    });
  }

  const functions = (spec.logic?.functions || []).map((s) => s.trim()).filter(Boolean);
  if (functions.length) {
    files.push({
      path: mainActivity,
      mode: "patch",
      patches: [{ anchor: "NDJC:FUNCTIONS", insert: functions.join("\n\n") + "\n" }],
    });
  }

  const imports = (spec.logic?.imports || []).map((s) => s.trim()).filter(Boolean);
  if (imports.length) {
    files.push({
      path: mainActivity,
      mode: "patch",
      patches: [{ anchor: "NDJC:IMPORTS", insert: imports.join("\n") + "\n" }],
    });
  }

  // 3) strings → NDJC:STRINGS（过滤 app_name）
  const strings = (spec.strings || []).filter((x) => x?.name && x?.value && x.name !== "app_name");
  if (strings.length) {
    const xml = strings
      .map((s) => `<string name="${s.name}">${escJava(s.value)}</string>`)
      .join("\n") + "\n";
    files.push({
      path: stringsXml,
      mode: "patch",
      patches: [{ anchor: "NDJC:STRINGS", insert: xml }],
    });
  }

  // 4) Manifest → NDJC:MANIFEST
  if (spec.manifest?.applicationAdditions?.trim()) {
    files.push({
      path: manifestXml,
      mode: "patch",
      patches: [{ anchor: "NDJC:MANIFEST", insert: spec.manifest.applicationAdditions.trim() + "\n" }],
    });
  }

  // 5) Gradle 依赖 → NDJC:DEPS
  const deps = (spec.gradle?.dependencies || []).map((s) => s.trim()).filter(Boolean);
  if (deps.length) {
    files.push({
      path: gradleFile,
      mode: "patch",
      patches: [{ anchor: "NDJC:DEPS", insert: deps.join("\n") + "\n" }],
    });
  }

  // 6) 静态资源
  for (const a of spec.assets || []) {
    files.push({
      path: a.path,
      mode: "create",
      content: a.contentBase64 ? undefined : (a.content || ""),
      contentBase64: a.contentBase64,
    });
  }

  return { appName: spec.appName, packageName: spec.packageName, files };
}

/** —— 兼容旧用法：若暂时没接 GROQ，可本地拼个最小 Spec —— */
export async function generatePlan(params: {
  prompt: string;
  appName?: string;
  packageName?: string;
}): Promise<NdjcPlan> {
  const appName = (params.appName || "NDJC App").trim();
  const packageName = (params.packageName || "com.example.app").trim();

  const p = (params.prompt || "").toLowerCase();
  const isDice = /(dice|骰子)/.test(p);

  const spec: NdjcSpec = isDice
    ? {
        appName, packageName,
        ui: { viewsXml:
`<TextView
  android:id="@+id/tvResult"
  android:text="-"
  android:textSize="32sp"
  android:layout_width="wrap_content"
  android:layout_height="wrap_content" />
<Button
  android:id="@+id/btnRoll"
  android:text="Roll"
  android:layout_width="wrap_content"
  android:layout_height="wrap_content" />`
        },
        logic: {
          onCreate: [
            `((android.widget.Button) findViewById(R.id.btnRoll)).setOnClickListener(v -> ((android.widget.TextView) findViewById(R.id.tvResult)).setText(String.valueOf(1 + new java.util.Random().nextInt(6)))) ;`,
          ],
        },
      }
    : {
        appName, packageName,
        ui: { viewsXml:
`<TextView
  android:id="@+id/tvTitle"
  android:text="${escJava(appName)}"
  android:textSize="22sp"
  android:layout_width="wrap_content"
  android:layout_height="wrap_content" />
<Button
  android:id="@+id/btnAction"
  android:text="Action"
  android:layout_width="wrap_content"
  android:layout_height="wrap_content" />`
        },
        logic: {
          onCreate: [
            `((android.widget.Button) findViewById(R.id.btnAction)).setOnClickListener(v -> ((android.widget.TextView) findViewById(R.id.tvTitle)).setText("${escJava(appName)} clicked"));`,
          ],
        },
      };

  return planFromSpec(spec);
}
