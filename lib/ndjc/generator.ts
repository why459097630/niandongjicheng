// lib/ndjc/generator.ts
import { callGroqToPlan, GroqPlan } from "./groq-client";

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

function toNdjcPlan(g: GroqPlan): NdjcPlan {
  // 直接复用结构（字段已兼容）
  return { appName: g.appName, packageName: g.packageName, files: g.files as any };
}

function trimId(s: string) {
  return s.replace(/[^a-zA-Z0-9_.]/g, "");
}

// 本地回退：保证即使 Groq 失败也能跑通
async function localFallbackPlan(params: {
  prompt: string;
  appName?: string;
  packageName?: string;
}): Promise<NdjcPlan> {
  const appName = params.appName?.trim() || "NDJC App";
  const pkg = params.packageName?.trim() || "com.ndjc.app";
  const pkgPath = pkg.replace(/\./g, "/");
  const mainActivity = `app/src/main/java/${pkgPath}/MainActivity.java`;
  const p = params.prompt.toLowerCase();

  // 掷骰子
  if (/(dice|骰子)/.test(p)) {
    return {
      appName, packageName: pkg,
      files: [
        {
          path: mainActivity, mode: "patch",
          patches: [
            { anchor: "NDJC:IMPORTS", insert: "import android.widget.Button;\nimport android.widget.TextView;\nimport java.util.Random;\n" },
            { anchor: "NDJC:ONCREATE", insert: "Button btn = findViewById(R.id.btnRoll);\nTextView tv = findViewById(R.id.tvResult);\nRandom r = new Random();\nbtn.setOnClickListener(v -> tv.setText(String.valueOf(1 + r.nextInt(6))));\n" },
            { anchor: "NDJC:FUNCTIONS", insert: "// dice functions\n" }
          ]
        },
        {
          path: "app/src/main/res/layout/activity_main.xml", mode: "patch",
          patches: [
            { anchor: "NDJC:VIEWS", insert: `<TextView
    android:id="@+id/tvResult"
    android:text="-"
    android:textSize="32sp"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content" />
<Button
    android:id="@+id/btnRoll"
    android:text="Roll"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content" />\n` }
          ]
        },
        { path: "app/src/main/res/values/strings.xml", mode: "patch",
          patches: [{ anchor: "NDJC:STRINGS", insert: `<string name="app_name">${appName}</string>\n` }] }
      ]
    };
  }

  // 默认
  return {
    appName, packageName: pkg,
    files: [
      {
        path: mainActivity, mode: "patch",
        patches: [
          { anchor: "NDJC:IMPORTS", insert: "import android.widget.Button;\nimport android.widget.TextView;\n" },
          { anchor: "NDJC:ONCREATE", insert: `TextView tv=findViewById(R.id.tvTitle);\nButton btn=findViewById(R.id.btnAction);\nbtn.setOnClickListener(v -> tv.setText("${trimId(appName)} clicked"));\n` },
          { anchor: "NDJC:FUNCTIONS", insert: "// default functions\n" }
        ]
      },
      {
        path: "app/src/main/res/layout/activity_main.xml", mode: "patch",
        patches: [
          { anchor: "NDJC:VIEWS", insert: `<TextView
  android:id="@+id/tvTitle"
  android:text="${appName}"
  android:textSize="22sp"
  android:layout_width="wrap_content"
  android:layout_height="wrap_content" />
<Button
  android:id="@+id/btnAction"
  android:text="Action"
  android:layout_width="wrap_content"
  android:layout_height="wrap_content" />\n` }
        ]
      },
      { path: "app/src/main/res/values/strings.xml", mode: "patch",
        patches: [{ anchor: "NDJC:STRINGS", insert: `<string name="app_name">${appName}</string>\n` }] }
    ]
  };
}

export async function generatePlan(params: {
  prompt: string;
  appName?: string;
  packageName?: string;
}): Promise<NdjcPlan> {
  const appName = params.appName?.trim() || "NDJC App";
  const packageName = params.packageName?.trim() || "com.ndjc.app";

  // 1) 先尝试 Groq
  try {
    const g = await callGroqToPlan({
      prompt: params.prompt,
      appName,
      packageName,
    });
    return toNdjcPlan(g);
  } catch (err) {
    console.error("Groq plan failed, fallback to local:", err);
  }

  // 2) 回退到本地规则
  return localFallbackPlan({ prompt: params.prompt, appName, packageName });
}
