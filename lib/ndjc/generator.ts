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

// 清理文本用于 Java 字符串
function escJava(s: string) {
  return (s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toPkgPath(pkg: string) {
  return (pkg || "com.example.app").replace(/\s+/g, "").replace(/\.+$/, "").replace(/^\.+/, "").replace(/\.\.+/g, ".").replace(/\./g, "/");
}

/**
 * 最小代码生成器：把 prompt 映射成“锚点补丁 JSON”
 * 约定可用锚点：
 *   - NDJC:IMPORTS     （本版不再注入 imports，避免重复）
 *   - NDJC:ONCREATE    （注入 onCreate 里的事件绑定逻辑）
 *   - NDJC:FUNCTIONS   （需要时可在此处追加方法）
 *   - NDJC:VIEWS       （向 activity_main.xml 注入控件）
 */
export async function generatePlan(params: {
  prompt: string;
  appName?: string;
  packageName?: string;
}): Promise<NdjcPlan> {
  const appName = (params.appName || "NDJC App").trim();
  const pkg = (params.packageName || "com.example.app").trim();
  const mainActivity = `app/src/main/java/${toPkgPath(pkg)}/MainActivity.java`;

  const p = (params.prompt || "").toLowerCase();

  // —— 分支 1：骰子
  if (/(dice|骰子)/.test(p)) {
    return {
      appName,
      packageName: pkg,
      files: [
        {
          path: mainActivity,
          mode: "patch",
          patches: [
            // 注意：不再注入 NDJC:IMPORTS，避免重复 import
            {
              anchor: "NDJC:ONCREATE",
              // 采用“内联强转 + 全限定类名 + 仅绑定监听”的写法，避免重复定义本地变量
              insert:
                `((android.widget.Button) findViewById(R.id.btnRoll))` +
                `.setOnClickListener(v -> ` +
                `((android.widget.TextView) findViewById(R.id.tvResult))` +
                `.setText(String.valueOf(1 + new java.util.Random().nextInt(6))));\n`,
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
              insert:
                `<TextView\n` +
                `    android:id="@+id/tvResult"\n` +
                `    android:text="-"\n` +
                `    android:textSize="32sp"\n` +
                `    android:layout_width="wrap_content"\n` +
                `    android:layout_height="wrap_content" />\n` +
                `<Button\n` +
                `    android:id="@+id/btnRoll"\n` +
                `    android:text="Roll"\n` +
                `    android:layout_width="wrap_content"\n` +
                `    android:layout_height="wrap_content" />\n`,
            },
          ],
        },
        // 不修改 strings.xml，避免与模板 app_name 冲突
      ],
    };
  }

  // —— 默认分支：一个标题 + 一个按钮
  return {
    appName,
    packageName: pkg,
    files: [
      {
        path: mainActivity,
        mode: "patch",
        patches: [
          {
            anchor: "NDJC:ONCREATE",
            insert:
              `((android.widget.Button) findViewById(R.id.btnAction))` +
              `.setOnClickListener(v -> ` +
              `((android.widget.TextView) findViewById(R.id.tvTitle))` +
              `.setText("${escJava(appName)} clicked"));\n`,
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
            insert:
              `<TextView\n` +
              `  android:id="@+id/tvTitle"\n` +
              `  android:text="${escJava(appName)}"\n` +
              `  android:textSize="22sp"\n` +
              `  android:layout_width="wrap_content"\n` +
              `  android:layout_height="wrap_content" />\n` +
              `<Button\n` +
              `  android:id="@+id/btnAction"\n` +
              `  android:text="Action"\n` +
              `  android:layout_width="wrap_content"\n` +
              `  android:layout_height="wrap_content" />\n`,
          },
        ],
      },
      // 同样不修改 strings.xml
    ],
  };
}
