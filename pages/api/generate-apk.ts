// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next'

/* ============= Types ============= */
type GhFile = { path: string; sha?: string }

type Ok = { ok: true; appId: string; template: string; files: GhFile[] }
type Fail = { ok: false; error: string; detail?: any }
type Result = Ok | Fail

type Template = {
  type: 'timer' | 'counter' | 'todo' | 'note' | 'webview' | 'hello'
  mainActivity: string
  layoutXml: string
  stringsXml: string
}

/* ============= Utils ============= */
// 供 strings.xml 使用的安全转义
function xmlText(s: string) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/%/g, '%%') // Android 字符串里的 % 是占位符
}

/* ============= Handler ============= */
export default async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  // CORS
  const allow = process.env.ALLOW_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', allow)
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-secret')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  // Auth
  const secret = (process.env.API_SECRET || '').trim()
  const incoming = String(req.headers['x-api-secret'] || (req.body as any)?.apiSecret || '').trim()
  if (!secret || incoming !== secret) return res.status(401).json({ ok: false, error: 'Unauthorized: bad x-api-secret' })

  // ENV
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const GITHUB_OWNER = process.env.GITHUB_OWNER || process.env.OWNER
  const GITHUB_REPO = process.env.GITHUB_REPO || process.env.REPO
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return res.status(500).json({ ok: false, error: 'Missing env: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO' })
  }

  // Input（前端强制要求用户选择模板）
  const { prompt = '', template } = (req.body || {}) as { prompt?: string; template?: string }
  if (!template) return res.status(400).json({ ok: false, error: 'Bad request: template required' })

  const slug = (prompt || 'myapp').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^\d+/, '') || 'myapp'
  const appId = `com.example.${slug}`
  const appName = (prompt || 'MyApp').slice(0, 30)
  const pkgPath = appId.replace(/\./g, '/')

  // 唯一时间戳，保证每次都会有内容变化 → 触发 CI
  const ts = new Date().toISOString()
  const marker = `__PROMPT__${prompt || 'EMPTY'}__ @ ${ts}`

  // Template choose（只按用户选择，不做自动匹配）
  const ALLOWED = ['timer', 'todo', 'webview', 'counter', 'note', 'hello'] as const
  type Allowed = (typeof ALLOWED)[number]
  if (!(ALLOWED as readonly string[]).includes(template)) {
    return res.status(400).json({ ok: false, error: `Unknown template: ${template}` })
  }

  let tpl: Template
  switch (template as Allowed) {
    case 'timer': {
      const num = prompt.match(/\d+/)?.[0] || '60'
      tpl = makeTimer(appId, parseInt(num, 10) || 60, appName)
      break
    }
    case 'todo':
      tpl = makeTodo(appId, appName)
      break
    case 'webview': {
      const urlMatch = prompt.match(/https?:\/\/[^\s"'）)]+/i)
      const url = urlMatch ? urlMatch[0] : 'https://example.com'
      tpl = makeWebView(appId, url, appName)
      break
    }
    case 'counter':
      tpl = makeCounter(appId, appName)
      break
    case 'note':
      tpl = makeNote(appId, appName)
      break
    case 'hello':
    default:
      tpl = makeHello(appId, appName)
  }

  const manifest = makeManifest(tpl.type === 'webview')

  // app/build.gradle
  const buildGradle = `
plugins { id 'com.android.application' }

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
    debug { minifyEnabled false }
  }
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
}
dependencies {
  implementation 'androidx.appcompat:appcompat:1.6.1'
  implementation 'androidx.constraintlayout:constraintlayout:2.1.4'
  implementation 'com.google.android.material:material:1.11.0'
  testImplementation 'junit:junit:4.13.2'
  androidTestImplementation 'androidx.test.ext:junit:1.1.5'
  androidTestImplementation 'androidx.test.espresso:espresso-core:3.5.1'
}
`.trim()

  // GitHub helpers
  const base = `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}`
  const ghFetch = (url: string, init?: RequestInit) =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'niandongjicheng-generator',
        ...(init?.headers || {}),
      } as any,
    })

  async function ghGet(path: string, ref = 'main'): Promise<any | null> {
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}?ref=${ref}`)
    if (r.status === 200) return r.json()
    return null
  }

  async function ghList(path: string, ref = 'main'): Promise<any[] | null> {
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}?ref=${ref}`)
    if (r.status === 200) {
      const j = await r.json()
      return Array.isArray(j) ? j : null
    }
    return null
  }

  async function ghDelete(path: string, sha: string, branch = 'main', message = 'chore: clean [skip ci]') {
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch }),
    })
    if (r.status < 200 || r.status >= 300) throw new Error(`Delete ${path} failed: ${r.status} ${await r.text()}`)
  }

  async function upsert(path: string, content: string, branch = 'main', message = 'feat: generate from prompt'): Promise<GhFile> {
    let sha: string | undefined
    const got = await ghGet(path, branch)
    if (got?.sha) sha = got.sha
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        branch,
        content: Buffer.from(content, 'utf8').toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    })
    if (r.status < 200 || r.status >= 300) throw new Error(`Write ${path} failed: ${r.status} ${await r.text()}`)
    const data = (await r.json()) as any
    return { path, sha: data?.content?.sha }
  }

  // 删除旧包名下的 MainActivity.java；加 [skip ci]，避免触发工作流
  async function cleanOldJava(targetPkgPath: string, branch = 'main') {
    const root = 'app/src/main/java/com/example'
    const dirs = await ghList(root, branch)
    if (!dirs) return
    const desired = `${targetPkgPath}/MainActivity.java`.replace(/^app\/src\/main\/java\//, '')

    for (const d of dirs) {
      if (d.type !== 'dir') continue
      const filePath = `${root}/${d.name}/MainActivity.java`
      const got = await ghGet(filePath, branch)
      if (got?.sha) {
        const rel = filePath.replace(/^app\/src\/main\/java\//, '')
        if (rel !== desired) {
          await ghDelete(filePath, got.sha, branch, 'chore: remove old MainActivity.java [skip ci]')
        }
      }
    }
  }

  try {
    await cleanOldJava(`app/src/main/java/${pkgPath}`)

    const files: GhFile[] = []
    files.push(await upsert('app/build.gradle', buildGradle))
    files.push(await upsert('app/src/main/AndroidManifest.xml', manifest))
    files.push(await upsert(`app/src/main/java/${pkgPath}/MainActivity.java`, tpl.mainActivity))
    files.push(await upsert('app/src/main/res/layout/activity_main.xml', tpl.layoutXml))
    files.push(await upsert('app/src/main/res/values/strings.xml', tpl.stringsXml))
    files.push(await upsert('app/src/main/assets/build_marker.txt', marker))
    // 额外“唤醒 CI”的文件，确保每次都有新提交
    files.push(await upsert('app/ci_nudge.txt', `${ts}\n${appId}\n`, 'main', 'chore: ci nudge'))

    return res.status(200).json({ ok: true, appId, template: tpl.type, files })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: 'Generate failed', detail: String(e?.message || e) })
  }
}

/* ============= Manifest ============= */
function makeManifest(needInternet: boolean) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  ${needInternet ? '<uses-permission android:name="android.permission.INTERNET"/>' : ''}
  <application
      android:allowBackup="true"
      android:label="@string/app_name"
      android:supportsRtl="true"
      android:theme="@style/Theme.AppCompat.Light.NoActionBar">
      <activity android:name=".MainActivity" android:exported="true">
          <intent-filter>
              <action android:name="android.intent.action.MAIN"/>
              <category android:name="android.intent.category.LAUNCHER"/>
          </intent-filter>
      </activity>
  </application>
</manifest>`.trim()
}

/* ============= Templates ============= */
function makeHello(appId: string, appName: string): Template {
  const mainActivity = `
package ${appId};

import android.os.Bundle;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import java.io.BufferedReader;
import java.io.InputStreamReader;

public class MainActivity extends AppCompatActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);
    TextView tv = findViewById(R.id.textHello);
    String marker = readAsset("build_marker.txt");
    if (tv != null) tv.setText(getString(R.string.hello_text) + " | " + marker);
  }
  private String readAsset(String path) {
    try {
      BufferedReader br = new BufferedReader(new InputStreamReader(getAssets().open(path)));
      StringBuilder sb = new StringBuilder(); String line;
      while ((line = br.readLine()) != null) sb.append(line);
      br.close();
      return sb.toString();
    } catch (Exception e) { return "no_marker"; }
  }
}
`.trim()

  const layoutXml = `
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="match_parent"
  android:gravity="center" android:orientation="vertical">
  <TextView
    android:id="@+id/textHello"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="@string/hello_text"
    android:textSize="20sp"/>
</LinearLayout>
`.trim()

  const stringsXml = `
<resources>
  <string name="app_name">${xmlText(appName)}</string>
  <string name="hello_text">Hello from ${xmlText(appName)}!</string>
</resources>
`.trim()

  return { type: 'hello', mainActivity, layoutXml, stringsXml }
}

function makeCounter(appId: string, appName: string): Template {
  const mainActivity = `
package ${appId};

import android.os.Bundle;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
  private int count = 0;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    TextView tv = findViewById(R.id.countText);
    Button add = findViewById(R.id.btnAdd);
    Button reset = findViewById(R.id.btnReset);

    count = getSharedPreferences("app", MODE_PRIVATE).getInt("count", 0);
    tv.setText(String.valueOf(count));

    add.setOnClickListener(v -> { count++; tv.setText(String.valueOf(count)); });
    reset.setOnClickListener(v -> { count = 0; tv.setText("0"); });
  }

  @Override
  protected void onPause() {
    super.onPause();
    getSharedPreferences("app", MODE_PRIVATE).edit().putInt("count", count).apply();
  }
}
`.trim()

  const layoutXml = `
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="match_parent"
  android:orientation="vertical" android:gravity="center" android:padding="24dp">
  <TextView
    android:id="@+id/countText"
    android:text="0" android:textSize="32sp"
    android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  <Button
    android:id="@+id/btnAdd" android:text="加一"
    android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="16dp"/>
  <Button
    android:id="@+id/btnReset" android:text="清零"
    android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="8dp"/>
</LinearLayout>
`.trim()

  const stringsXml = `
<resources>
  <string name="app_name">${xmlText(appName)}</string>
</resources>
`.trim()

  return { type: 'counter', mainActivity, layoutXml, stringsXml }
}

function makeTimer(appId: string, seconds: number, appName: string): Template {
  const mainActivity = `
package ${appId};

import android.os.Bundle;
import android.os.CountDownTimer;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
  private CountDownTimer timer;
  private boolean running = false;
  private long totalMillis = ${seconds}L * 1000L;
  private long leftMillis = totalMillis;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    TextView tv = findViewById(R.id.tvTime);
    Button start = findViewById(R.id.btnStart);
    Button stop  = findViewById(R.id.btnStop);
    updateText(tv);

    start.setOnClickListener(v -> {
      if (running) return;
      running = true;
      timer = new CountDownTimer(leftMillis, 1000) {
        public void onTick(long ms) { leftMillis = ms; updateText(tv); }
        public void onFinish() { running = false; leftMillis = totalMillis; updateText(tv); }
      }.start();
    });

    stop.setOnClickListener(v -> {
      if (timer != null) timer.cancel();
      running = false;
    });
  }

  private void updateText(TextView tv) {
    long sec = leftMillis / 1000;
    tv.setText(sec + " s");
  }
}
`.trim()

  const layoutXml = `
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="match_parent"
  android:orientation="vertical" android:gravity="center" android:padding="24dp">
  <TextView android:id="@+id/tvTime"
    android:text="-- s" android:textSize="36sp"
    android:layout_width="wrap_content" android:layout_height="wrap_content"/>
  <Button android:id="@+id/btnStart" android:text="开始"
    android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="16dp"/>
  <Button android:id="@+id/btnStop" android:text="停止"
    android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="8dp"/>
</LinearLayout>
`.trim()

  const stringsXml = `
<resources>
  <string name="app_name">${xmlText(appName)}</string>
</resources>
`.trim()

  return { type: 'timer', mainActivity, layoutXml, stringsXml }
}

function makeTodo(appId: string, appName: string): Template {
  const mainActivity = `
package ${appId};

import android.os.Bundle;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import java.util.*;

public class MainActivity extends AppCompatActivity {
  private ArrayList<String> items = new ArrayList<>();
  private ArrayAdapter<String> adapter;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);

    EditText input = findViewById(R.id.input);
    Button add = findViewById(R.id.btnAdd);
    ListView list = findViewById(R.id.list);

    String saved = getSharedPreferences("app", MODE_PRIVATE).getString("todos", "");
    if (saved != null && !saved.isEmpty()) items.addAll(Arrays.asList(saved.split("\\n")));
    adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, items);
    list.setAdapter(adapter);

    add.setOnClickListener(v -> {
      String t = input.getText().toString().trim();
      if (!t.isEmpty()) { items.add(t); adapter.notifyDataSetChanged(); input.setText(""); }
    });

    list.setOnItemLongClickListener((parent, v, pos, id) -> {
      items.remove(pos);
      adapter.notifyDataSetChanged();
      return true;
    });
  }

  @Override
  protected void onPause() {
    super.onPause();
    String joined = String.join("\\n", items);
    getSharedPreferences("app", MODE_PRIVATE).edit().putString("todos", joined).apply();
  }
}
`.trim()

  const layoutXml = `
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="match_parent"
  android:orientation="vertical" android:padding="16dp">
  <EditText
    android:id="@+id/input"
    android:hint="新增待办…" android:layout_width="match_parent" android:layout_height="wrap_content"/>
  <Button
    android:id="@+id/btnAdd" android:text="添加"
    android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="8dp"/>
  <ListView
    android:id="@+id/list"
    android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:dividerHeight="1dp"/>
</LinearLayout>
`.trim()

  const stringsXml = `
<resources>
  <string name="app_name">${xmlText(appName)}</string>
</resources>
`.trim()

  return { type: 'todo', mainActivity, layoutXml, stringsXml }
}

function makeNote(appId: string, appName: string): Template {
  const mainActivity = `
package ${appId};

import android.os.Bundle;
import android.widget.EditText;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
  private EditText edit;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);
    edit = findViewById(R.id.edit);
    String text = getSharedPreferences("app", MODE_PRIVATE).getString("note", "");
    edit.setText(text);
  }

  @Override
  protected void onPause() {
    super.onPause();
    getSharedPreferences("app", MODE_PRIVATE).edit().putString("note", edit.getText().toString()).apply();
  }
}
`.trim()

  const layoutXml = `
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="match_parent"
  android:orientation="vertical" android:padding="16dp">
  <EditText
    android:id="@+id/edit"
    android:gravity="top"
    android:hint="在这里写点什么…"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:minLines="8" android:inputType="textMultiLine"/>
</LinearLayout>
`.trim()

  const stringsXml = `
<resources>
  <string name="app_name">${xmlText(appName)}</string>
</resources>
`.trim()

  return { type: 'note', mainActivity, layoutXml, stringsXml }
}

function makeWebView(appId: string, url: string, appName: string): Template {
  const mainActivity = `
package ${appId};

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);
    WebView wv = findViewById(R.id.web);
    wv.getSettings().setJavaScriptEnabled(true);
    wv.setWebViewClient(new WebViewClient());
    wv.loadUrl("${url}");
  }
}
`.trim()

  const layoutXml = `
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="match_parent">
  <WebView
    android:id="@+id/web"
    android:layout_width="match_parent"
    android:layout_height="match_parent"/>
</FrameLayout>
`.trim()

  const stringsXml = `
<resources>
  <string name="app_name">${xmlText(appName)}</string>
</resources>
`.trim()

  return { type: 'webview', mainActivity, layoutXml, stringsXml }
}
