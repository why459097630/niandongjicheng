// lib/ndjc/generator.ts

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

function trimId(s: string) {
  return s.replace(/[^a-zA-Z0-9_.]/g, "");
}

// 最小代码生成器：根据 prompt 返回锚点补丁 JSON
export async function generatePlan(params: {
  prompt: string;
  appName?: string;
  packageName?: string;
}): Promise<NdjcPlan> {
  const appName = params.appName?.trim() || "NDJC App";
  const pkg = params.packageName?.trim() || "com.ndjc.app";
  const pkgPath = pkg.replace(/\./g, "/");
  const mainActivity = `app/src/main/java/${pkgPath}/MainActivity.java`;

  const p = params.prompt.toLowerCase();

  // 掷骰子 App
  if (/(dice|骰子)/.test(p)) {
    return {
      appName,
      packageName: pkg,
      files: [
        {
          path: mainActivity,
          mode: "patch",
          patches: [
            {
              anchor: "NDJC:IMPORTS",
              insert:
                "import android.widget.Button;\nimport android.widget.TextView;\nimport java.util.Random;\n",
            },
            {
              anchor: "NDJC:ONCREATE",
              insert:
                "Button btn = findViewById(R.id.btnRoll);\nTextView tv = findViewById(R.id.tvResult);\nRandom r = new Random();\nbtn.setOnClickListener(v -> tv.setText(String.valueOf(1 + r.nextInt(6))));\n",
            },
            { anchor: "NDJC:FUNCTIONS", insert: "// dice functions\n" },
          ],
        },
        {
          path: "app/src/main/res/layout/activity_main.xml",
          mode: "patch",
          patches: [
            {
              anchor: "NDJC:VIEWS",
              insert: `<TextView
    android:id="@+id/tvResult"
    android:text="-"
    android:textSize="32sp"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content" />
<Button
    android:id="@+id/btnRoll"
    android:text="Roll"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content" />\n`,
            },
          ],
        },
        // 注意：不再修改 strings.xml，避免 app_name 重复
      ],
    };
  }

  // 默认：展示一个 TextView 和按钮
  return {
    appName,
    packageName: pkg,
    files: [
      {
        path: mainActivity,
        mode: "patch",
        patches: [
          {
            anchor: "NDJC:IMPORTS",
            insert: "import android.widget.Button;\nimport android.widget.TextView;\n",
          },
          {
            anchor: "NDJC:ONCREATE",
            insert: `TextView tv=findViewById(R.id.tvTitle);\nButton btn=findViewById(R.id.btnAction);\nbtn.setOnClickListener(v -> tv.setText("${trimId(
              appName
            )} clicked"));\n`,
          },
          { anchor: "NDJC:FUNCTIONS", insert: "// default functions\n" },
        ],
      },
      {
        path: "app/src/main/res/layout/activity_main.xml",
        mode: "patch",
        patches: [
          {
            anchor: "NDJC:VIEWS",
            insert: `<TextView
  android:id="@+id/tvTitle"
  android:text="${appName}"
  android:textSize="22sp"
  android:layout_width="wrap_content"
  android:layout_height="wrap_content" />
<Button
  android:id="@+id/btnAction"
  android:text="Action"
  android:layout_width="wrap_content"
  android:layout_height="wrap_content" />\n`,
          },
        ],
      },
      // 注意：不再修改 strings.xml，避免 app_name 重复
    ],
  };
}
