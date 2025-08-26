// lib/ndjc/generator.ts（只列变化处）

// Dice 分支 —— 使用内联强转 + 全限定类名，不再声明本地变量
{
  path: mainActivity,
  mode: "patch",
  patches: [
    // 不再插 IMPORTS，避免重复
    {
      anchor: "NDJC:ONCREATE",
      insert:
        "((android.widget.Button) findViewById(R.id.btnRoll))" +
        ".setOnClickListener(v -> " +
        "((android.widget.TextView) findViewById(R.id.tvResult))" +
        ".setText(String.valueOf(1 + new java.util.Random().nextInt(6))))" +
        ";\n",
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

// 默认分支 —— 同样用内联，不声明变量
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
        `.setText("${appName.replace(/"/g, '\\"')} clicked"));` +
        "\n",
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
