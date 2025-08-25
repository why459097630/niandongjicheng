// 最小可用代码生成器：把 prompt 映射成锚点补丁 JSON
export type NdjcPatch = {
  path: string;
  mode: "patch" | "replace" | "create";
  patches?: { anchor: string; insert: string }[];
  contentBase64?: string;
};

export type NdjcPlan = {
  appName: string;
  packageName: string;
  files: NdjcPatch[];
};

function trimId(s: string) {
  return s.replace(/[^a-zA-Z0-9_.]/g, "");
}

export async function generatePlan(params: {
  prompt: string;
  appName?: string;
  packageName?: string; // e.g. com.ndjc.app
}) : Promise<NdjcPlan> {
  const appName = params.appName?.trim() || "NDJC App";
  const pkg = params.packageName?.trim() || "com.ndjc.app";
  const pkgPath = pkg.replace(/\./g, "/");
  const mainActivity = `app/src/main/java/${pkgPath}/MainActivity.kt`;

  const p = params.prompt.toLowerCase();

  // 1) 掷骰子
  if (/(dice|骰子)/.test(p)) {
    return {
      appName, packageName: pkg,
      files: [
        {
          path: mainActivity, mode: "patch",
          patches: [
            { anchor: "NDJC:IMPORTS",
              insert: "import android.widget.Button\nimport android.widget.TextView\nimport kotlin.random.Random\n" },
            { anchor: "NDJC:ONCREATE",
              insert: "val btn=findViewById<Button>(R.id.btnRoll)\nval tv=findViewById<TextView>(R.id.tvResult)\nbtn.setOnClickListener{ tv.text = (1..6).random().toString() }\n" },
            { anchor: "NDJC:FUNCTIONS",
              insert: "// more functions here if needed\n" }
          ]
        },
        {
          path: "app/src/main/res/layout/activity_main.xml", mode: "patch",
          patches: [
            { anchor: "NDJC:VIEWS",
              insert: `<TextView
    android:id="@+id/tvResult"
    android:textSize="32sp"
    android:text="-"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content" />
<Button
    android:id="@+id/btnRoll"
    android:text="Roll"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content" />\n` }
          ]
        },
        {
          path: "app/src/main/res/values/strings.xml", mode: "patch",
          patches: [{ anchor: "NDJC:STRINGS", insert: `<string name="app_name">${appName}</string>\n` }]
        }
      ]
    };
  }

  // 2) 冥想计时器（倒计时）
  if (/(timer|计时|倒计时|meditation)/.test(p)) {
    return {
      appName, packageName: pkg,
      files: [
        {
          path: mainActivity, mode: "patch",
          patches: [
            { anchor: "NDJC:IMPORTS",
              insert: "import android.os.CountDownTimer\nimport android.widget.Button\nimport android.widget.TextView\n" },
            { anchor: "NDJC:ONCREATE",
              insert: `val tv=findViewById<TextView>(R.id.tvTimer)
val b5=findViewById<Button>(R.id.btn5)
val b10=findViewById<Button>(R.id.btn10)
val b20=findViewById<Button>(R.id.btn20)
fun startTimer(min:Int){
  object: CountDownTimer(min*60_000L,1000L){
    override fun onTick(ms:Long){ tv.text = (ms/1000).toString() }
    override fun onFinish(){ tv.text = "Done" }
  }.start()
}
b5.setOnClickListener{ startTimer(5) }
b10.setOnClickListener{ startTimer(10) }
b20.setOnClickListener{ startTimer(20) }\n` },
            { anchor: "NDJC:FUNCTIONS",
              insert: "// timer helpers here\n" }
          ]
        },
        {
          path: "app/src/main/res/layout/activity_main.xml", mode: "patch",
          patches: [
            { anchor: "NDJC:VIEWS",
              insert: `<TextView
    android:id="@+id/tvTimer"
    android:textSize="32sp"
    android:text="0"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content" />
<LinearLayout
    android:orientation="horizontal"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content">
  <Button android:id="@+id/btn5"  android:text="5"  android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  <Button android:id="@+id/btn10" android:text="10" android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  <Button android:id="@+id/btn20" android:text="20" android:layout_width="wrap_content" android:layout_height="wrap_content"/>
</LinearLayout>\n` }
          ]
        },
        {
          path: "app/src/main/res/values/strings.xml", mode: "patch",
          patches: [{ anchor: "NDJC:STRINGS", insert: `<string name="app_name">${appName}</string>\n` }]
        }
      ]
    };
  }

  // 3) 默认：展示标题 + 按钮
  return {
    appName, packageName: pkg,
    files: [
      {
        path: mainActivity, mode: "patch",
        patches: [
          { anchor: "NDJC:IMPORTS",
            insert: "import android.widget.Button\nimport android.widget.TextView\n" },
          { anchor: "NDJC:ONCREATE",
            insert: `val tv=findViewById<TextView>(R.id.tvTitle)\nval btn=findViewById<Button>(R.id.btnAction)\nbtn.setOnClickListener{ tv.text = "${trimId(appName)} clicked" }\n` },
          { anchor: "NDJC:FUNCTIONS", insert: "// default functions\n" }
        ]
      },
      {
        path: "app/src/main/res/layout/activity_main.xml", mode: "patch",
        patches: [
          { anchor: "NDJC:VIEWS",
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
  android:layout_height="wrap_content" />\n` }
        ]
      },
      {
        path: "app/src/main/res/values/strings.xml", mode: "patch",
        patches: [{ anchor: "NDJC:STRINGS", insert: `<string name="app_name">${appName}</string>\n` }]
      }
    ]
  };
}
