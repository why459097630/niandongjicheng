// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * 你已经有 /pages/api/push-to-github.ts（写入/更新文件并触发 CI）。
 * 这里直接调用它，把 files 统一提交到 Packaging-warehouse 仓库。
 *
 * ⚠️ 需要的环境变量（在 Vercel 上配置）：
 *   - API_SECRET（和 /api/push-to-github.ts 校验一致）
 *   - OWNER（目标仓库 owner，比如 why459097630）
 *   - REPO  （目标仓库名，比如 Packaging-warehouse）
 *   - REF   （目标分支，比如 main）
 */
const OWNER = process.env.OWNER || "why459097630";
const REPO  = process.env.REPO  || "Packaging-warehouse";
const REF   = process.env.REF   || "main";

type TemplateKind = "core-template" | "form-template" | "simple-template";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  try {
    const { prompt = "", template, appId: rawAppId } = (req.body || {}) as {
      prompt?: string;
      template: TemplateKind;
      appId?: string;
    };

    if (!template || !["core-template", "form-template", "simple-template"].includes(template)) {
      res.status(400).json({ ok: false, error: "template 必须是 core-template | form-template | simple-template 其一" });
      return;
    }

    // 统一 appId（默认 com.example.app），并校验合法性
    const appId = (rawAppId || "com.example.app").trim();
    if (!/^[a-zA-Z_][\w.]*$/.test(appId) || appId.split(".").length < 2) {
      res.status(400).json({ ok: false, error: "appId 非法（示例：com.example.app）" });
      return;
    }
    const appIdPath = `app/src/main/java/${appId.replace(/\./g, "/")}`;

    // 统一的 build.gradle（关键：namespace 与 appId 一致）
    const buildGradle = `plugins {
  id 'com.android.application'
}

android {
  namespace "${appId}"
  compileSdk 34

  defaultConfig {
    applicationId "${appId}"
    minSdk 24
    targetSdk 34
    versionCode 1
    versionName "1.0"
  }

  buildTypes {
    release {
      minifyEnabled false
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }

  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
}

dependencies {
  implementation 'androidx.appcompat:appcompat:1.6.1'
  implementation 'com.google.android.material:material:1.11.0'
}
`;

    // Manifest（关键：不写 package，避免 AAPT/R 生成错位）
    const androidManifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

  <application
      android:allowBackup="true"
      android:label="@string/app_name"
      android:supportsRtl="true"
      android:theme="@style/Theme.AppCompat.Light.NoActionBar">

    <activity android:name=".MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>

  </application>
</manifest>
`;

    // 不同模板：MainActivity / layout / strings
    const mainActivity = makeMainActivity(appId, template);
    const { layoutXml, stringsXml } = makeResources(template, prompt);

    // 额外写一个 build_marker.txt 记录本次 prompt
    const marker = `__FROM_API__ ${prompt || "no prompt"}  \nTEMPLATE=${template}  \nAPP_ID=${appId}\n`;

    // 组装要提交/更新的文件清单
    const files = [
      { path: "app/build.gradle",                            content: buildGradle },
      { path: "app/src/main/AndroidManifest.xml",            content: androidManifest },
      { path: `${appIdPath}/MainActivity.java`,              content: mainActivity },
      { path: "app/src/main/res/layout/activity_main.xml",   content: layoutXml },
      { path: "app/src/main/res/values/strings.xml",         content: stringsXml },
      { path: "app/src/main/assets/build_marker.txt",        content: marker },
    ];

    // 提交到仓库（调用你现有的 /api/push-to-github）
    const secret = process.env.API_SECRET || "";
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/push-to-github`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": secret,
      },
      body: JSON.stringify({
        owner: OWNER,
        repo: REPO,
        ref: REF,
        message: `feat: generate from template ${template}`,
        files,
      }),
    });

    const resp = await r.json();
    if (!r.ok || !resp?.ok) {
      res.status(500).json({ ok: false, stage: "push", error: resp?.error || "push-to-github 失败" });
      return;
    }

    res.status(200).json({
      ok: true,
      appId,
      template,
      committed: true,
      files: files.map(f => f.path),
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

/** 生成 MainActivity.java（显式 import <appId>.R，避免 R 解析不到） */
function makeMainActivity(appId: string, template: TemplateKind): string {
  const imports =
`package ${appId};

import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import ${appId}.R;`;

  if (template === "simple-template" || template === "core-template") {
    return `${imports}

public class MainActivity extends AppCompatActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);
  }
}
`;
  }

  // form-template：最简单的输入 + 按钮 + 列表
  return `${imports}

import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ListView;
import java.util.ArrayList;

public class MainActivity extends AppCompatActivity {
  private final ArrayList<String> items = new ArrayList<>();
  private ArrayAdapter<String> adapter;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    EditText input = findViewById(R.id.input);
    Button   add   = findViewById(R.id.btnAdd);
    ListView list  = findViewById(R.id.list);

    adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, items);
    list.setAdapter(adapter);

    add.setOnClickListener(new View.OnClickListener() {
      @Override public void onClick(View v) {
        String s = input.getText().toString().trim();
        if (!s.isEmpty()) {
          items.add(s);
          adapter.notifyDataSetChanged();
          input.setText("");
        }
      }
    });
  }
}
`;
}

/** 生成 layout 与 strings；确保资源完备，从而能生成 R */
function makeResources(template: TemplateKind, prompt: string): { layoutXml: string; stringsXml: string } {
  if (template === "form-template") {
    return {
      layoutXml: `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:orientation="vertical"
  android:padding="16dp">

  <EditText
    android:id="@+id/input"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="@string/hint_input" />

  <Button
    android:id="@+id/btnAdd"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="@string/btn_add"
    android:layout_marginTop="12dp" />

  <ListView
    android:id="@+id/list"
    android:layout_width="match_parent"
    android:layout_height="0dp"
    android:layout_weight="1"
    android:layout_marginTop="12dp" />
</LinearLayout>
`,
      stringsXml: `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">Demo App</string>
  <string name="hello_text">${escapeXml(prompt || "Hello from template!")}</string>
  <string name="hint_input">输入一项</string>
  <string name="btn_add">添加</string>
</resources>
`,
    };
  }

  // simple-template / core-template：一个 TextView 即可
  return {
    layoutXml: `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="match_parent">

  <TextView
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="@string/hello_text"
    android:layout_gravity="center"
    android:textSize="20sp"/>
</FrameLayout>
`,
    stringsXml: `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">Demo App</string>
  <string name="hello_text">${escapeXml(prompt || "Hello from template!")}</string>
</resources>
`,
  };
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
