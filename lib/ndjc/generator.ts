// lib/ndjc/generator.ts
// ================ 1) 锚点默认值（可直接用你之前那份大表） ================
export const defaults: Record<string, any> = {
  // —— 基础 —— //
  NDJC_APP_NAME: "MyApp",
  NDJC_PACKAGE_ID: "com.example.myapp",
  NDJC_VERSION_NAME: "1.0.0",
  NDJC_VERSION_CODE: 1,
  NDJC_MIN_SDK: 24,
  NDJC_TARGET_SDK: 34,
  NDJC_APP_DESCRIPTION: "",
  NDJC_LOCALE_DEFAULT: "en",

  // —— 主题 / 品牌（Material3）—— //
  NDJC_PRIMARY_COLOR: "#6750A4",
  NDJC_SECONDARY_COLOR: "#625B71",
  NDJC_ACCENT_COLOR: "#7D5260",
  NDJC_THEME_MODE: "system",
  NDJC_FONT_FAMILY: "sans-serif",
  NDJC_SPLASH_BG_COLOR: "#FFFFFF",
  NDJC_CORNER_RADIUS_DP: 12,
  NDJC_ELEVATION_DP: 2,
  NDJC_ENABLE_MATERIAL3: true,

  // —— 权限 / 网络 —— //
  NDJC_PERMISSIONS: [],
  NDJC_FEATURES: [],
  NDJC_ALLOW_CLEAR_TEXT: false,
  NDJC_BASE_URL: "",
  NDJC_API_ENDPOINTS: [],
  NDJC_API_HEADERS_JSON: "{}",
  NDJC_API_TIMEOUT_MS: 15000,

  // —— 页面（simple）—— //
  NDJC_MAIN_ACTIVITY: "MainActivity",
  NDJC_HOME_TITLE: "Home",
  NDJC_ACTION_PRIMARY_TEXT: "OK",
  NDJC_ACTION_SECONDARY_TEXT: "Cancel",

  // —— 桌面图标（含 AI）—— //
  NDJC_APP_ICON_PNG: "",
  NDJC_APP_ICON_BG_COLOR: "#121212",
  NDJC_APP_ICON_PADDING: 0.10,
  NDJC_APP_ICON_MONOCHROME_PNG: "",
  NDJC_APP_ICON_STRATEGY: "auto",
  NDJC_APP_ICON_PROMPT: "",
  NDJC_APP_ICON_GEN_PROVIDER: "none",
  NDJC_APP_ICON_GEN_STYLE: "flat",
  NDJC_APP_ICON_SHAPE: "squircle",
  NDJC_APP_ICON_SIZE: 1024,
  NDJC_APP_ICON_NEG_PROMPT: "text, watermark, photo, busy background",
  NDJC_APP_ICON_STEPS: 30,
  NDJC_APP_ICON_GUIDANCE: 6.5,
  NDJC_APP_ICON_SEED: 0,

  // —— CI / 产物 —— //
  NDJC_WORKFLOW_APP_ID: "ndjc",
  NDJC_BUILD_VARIANT: "release",
  NDJC_BUILD_FLAVOR: "none",
  NDJC_MINIFY_ENABLED: false,
  NDJC_ARTIFACT_NAME: "app-release.apk",
  NDJC_RELEASE_TAG: "v1.0.0",
  NDJC_RELEASE_NAME: "Release v1.0.0",
  NDJC_RELEASE_BODY: "",
  NDJC_CHANGELOG: "",
  NDJC_ANCHOR_SET_VERSION: "1.0"
};

// ================ 2) 锚点合并 & 条件注入 ================
export function resolveWithDefaults(input: Record<string, any>) {
  const merged: Record<string, any> = {};
  for (const k of Object.keys(defaults)) merged[k] = input[k] ?? defaults[k];
  return merged;
}

export function injectConditionalBlocks(content: string, params: Record<string, any>) {
  const truthy = (v: any) => v === true || v === "true" || (typeof v === "number" && v > 0);
  // 块条件：{{#NDJC_XXX}} ... {{/NDJC_XXX}}
  content = content.replace(/{{#(NDJC_[A-Z0-9_]+)}}([\s\S]*?){{\/\1}}/g, (_, key, block) =>
    truthy(params[key]) ? block : ""
  );
  // 单值：{{NDJC_XXX}}
  content = content.replace(/{{(NDJC_[A-Z0-9_]+)}}/g, (_, key) => String(params[key] ?? ""));
  return content;
}

// ================ 3) 简易字符串模板（simple-template 关键文件） ================
// 你可以把这些内容拆到单独模板文件；这里内联方便你一次落地。
// build.gradle
const TPL_buildGradle = `
plugins {
  id 'com.android.application'
  id 'org.jetbrains.kotlin.android'
}
android {
  namespace "{{NDJC_PACKAGE_ID}}"
  compileSdk {{NDJC_TARGET_SDK}}
  defaultConfig {
    applicationId "{{NDJC_PACKAGE_ID}}"
    minSdk {{NDJC_MIN_SDK}}
    targetSdk {{NDJC_TARGET_SDK}}
    versionCode {{NDJC_VERSION_CODE}}
    versionName "{{NDJC_VERSION_NAME}}"
    vectorDrawables { useSupportLibrary = true }
  }
  buildTypes {
    debug { minifyEnabled false }
    release {
      minifyEnabled {{NDJC_MINIFY_ENABLED}}
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = '17' }
  buildFeatures { compose true }
  composeOptions { kotlinCompilerExtensionVersion '1.5.14' }
}
dependencies {
  implementation "androidx.activity:activity-compose:1.9.2"
  implementation "androidx.compose.ui:ui:1.6.8"
  implementation "androidx.compose.ui:ui-tooling-preview:1.6.8"
  debugImplementation "androidx.compose.ui:ui-tooling:1.6.8"
  {{#NDJC_ENABLE_MATERIAL3}}
  implementation "androidx.compose.material3:material3:1.2.1"
  {{/NDJC_ENABLE_MATERIAL3}}
  implementation "androidx.datastore:datastore-preferences:1.1.1"
  {{NDJC_LIB_DEPENDENCIES}}
}
`.trim();

// AndroidManifest.xml
const TPL_manifest = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{{NDJC_PACKAGE_ID}}">
  {{#NDJC_PERMISSIONS}}
  <!-- 示例：<uses-permission android:name="android.permission.INTERNET"/> -->
  {{/NDJC_PERMISSIONS}}
  <application
      android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher"
      android:roundIcon="@mipmap/ic_launcher"
      android:allowBackup="true"
      android:theme="@style/Theme.NDJC">
    <activity android:name=".{{NDJC_MAIN_ACTIVITY}}" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
`.trim();

// strings.xml
const TPL_strings = `
<resources>
  <string name="app_name">{{NDJC_APP_NAME}}</string>
  <string name="title_home">{{NDJC_HOME_TITLE}}</string>
  <string name="action_primary">{{NDJC_ACTION_PRIMARY_TEXT}}</string>
  <string name="action_secondary">{{NDJC_ACTION_SECONDARY_TEXT}}</string>
</resources>
`.trim();

// colors.xml（图标背景）
const TPL_colors = `
<resources>
  <color name="ic_launcher_background">{{NDJC_APP_ICON_BG_COLOR}}</color>
</resources>
`.trim();

// ic_launcher.xml
const TPL_icLauncher = `
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <!-- 可选 <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/> -->
</adaptive-icon>
`.trim();

// MainActivity.kt（含 M3 主题调用）
const TPL_mainActivity = `
package com.ndjc.app
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ndjc.app.data.ThemePrefs
import com.ndjc.app.ui.theme.AppTheme
import com.ndjc.app.ui.theme.ThemeMode

class {{NDJC_MAIN_ACTIVITY}} : ComponentActivity() {
  private val prefs by lazy { ThemePrefs(this) }
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    setContent {
      val mode by prefs.themeMode.collectAsState(initial = ThemeMode.SYSTEM)
      val dynamic by prefs.dynamicColor.collectAsState(initial = true)
      AppTheme(themeMode = mode, dynamicColor = dynamic) {
        Surface(Modifier.fillMaxSize()) { HomeScreen() }
      }
    }
  }
}

@Composable
fun HomeScreen() {
  Column(Modifier.fillMaxSize().padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    Text(text = "{{NDJC_HOME_TITLE}}", style = MaterialTheme.typography.headlineMedium)
    Spacer(Modifier.height(16.dp))
    Button(onClick = { /* TODO */ }) { Text("{{NDJC_ACTION_PRIMARY_TEXT}}") }
  }
}
`.trim();

// Theme 相关
const TPL_themeKt = `
package com.ndjc.app.ui.theme
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
enum class ThemeMode { SYSTEM, LIGHT, DARK }
@Composable
fun AppTheme(themeMode: ThemeMode = ThemeMode.SYSTEM, dynamicColor: Boolean = true, content: @Composable () -> Unit) {
  val context = LocalContext.current
  val dark = when (themeMode) { ThemeMode.SYSTEM -> isSystemInDarkTheme(); ThemeMode.LIGHT -> false; ThemeMode.DARK -> true }
  val scheme = if (dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
  } else {
    if (dark) darkColorScheme(primary = DarkPrimary, secondary = BrandSecondary, tertiary = BrandAccent)
    else lightColorScheme(primary = LightPrimary, secondary = BrandSecondary, tertiary = BrandAccent)
  }
  MaterialTheme(colorScheme = scheme, shapes = AppShapes, content = content)
}
`.trim();

const TPL_colorKt = `
package com.ndjc.app.ui.theme
import androidx.compose.ui.graphics.Color
import android.graphics.Color as AColor
val BrandPrimary   = Color(AColor.parseColor("{{NDJC_PRIMARY_COLOR}}"))
val BrandSecondary = Color(AColor.parseColor("{{NDJC_SECONDARY_COLOR}}"))
val BrandAccent    = Color(AColor.parseColor("{{NDJC_ACCENT_COLOR}}"))
val LightPrimary = BrandPrimary
val DarkPrimary  = BrandPrimary
`.trim();

const TPL_shapeKt = `
package com.ndjc.app.ui.theme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp
val AppShapes = Shapes(
  extraSmall = RoundedCornerShape({{NDJC_CORNER_RADIUS_DP}}.dp),
  small      = RoundedCornerShape({{NDJC_CORNER_RADIUS_DP}}.dp),
  medium     = RoundedCornerShape({{NDJC_CORNER_RADIUS_DP}}.dp),
  large      = RoundedCornerShape({{NDJC_CORNER_RADIUS_DP}}.dp),
  extraLarge = RoundedCornerShape({{NDJC_CORNER_RADIUS_DP}}.dp)
)
`.trim();

const TPL_themePrefs = `
package com.ndjc.app.data
import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import com.ndjc.app.ui.theme.ThemeMode
private val Context.dataStore by preferencesDataStore(name = "ui_prefs")
object ThemeKeys { val MODE = intPreferencesKey("theme_mode"); val DYNAMIC = booleanPreferencesKey("dynamic") }
class ThemePrefs(private val context: Context) {
  val themeMode: Flow<ThemeMode> = context.dataStore.data.map {
    when (it[ThemeKeys.MODE] ?: modeFromDefault()) { 1 -> ThemeMode.LIGHT; 2 -> ThemeMode.DARK; else -> ThemeMode.SYSTEM }
  }
  val dynamicColor: Flow<Boolean> = context.dataStore.data.map { it[ThemeKeys.DYNAMIC] ?: true }
  suspend fun setThemeMode(mode: ThemeMode) { context.dataStore.edit {
    it[ThemeKeys.MODE] = when (mode) { ThemeMode.SYSTEM -> 0; ThemeMode.LIGHT -> 1; ThemeMode.DARK -> 2 } } }
  suspend fun setDynamicColor(enabled: Boolean) { context.dataStore.edit { it[ThemeKeys.DYNAMIC] = enabled } }
  private fun modeFromDefault(): Int = when ("{{NDJC_THEME_MODE}}".lowercase()) { "light" -> 1; "dark" -> 2; else -> 0 }
}
`.trim();

// ================ 4) 产出文件列表（给 commitAndBuild 用） ================
export type CommitFile = { filePath: string; content: string; base64?: boolean; message?: string };

export function makeSimpleTemplateFiles(params: Record<string, any>): CommitFile[] {
  const p = resolveWithDefaults(params);
  // 注入锚点
  const files: CommitFile[] = [
    { filePath: "app/build.gradle", content: injectConditionalBlocks(TPL_buildGradle, p) },
    { filePath: "app/src/main/AndroidManifest.xml", content: injectConditionalBlocks(TPL_manifest, p) },
    { filePath: "app/src/main/res/values/strings.xml", content: injectConditionalBlocks(TPL_strings, p) },
    { filePath: "app/src/main/res/values/colors.xml",  content: injectConditionalBlocks(TPL_colors, p) },
    { filePath: "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml", content: TPL_icLauncher },
    { filePath: "app/src/main/java/com/ndjc/app/" + p.NDJC_MAIN_ACTIVITY + ".kt", content: injectConditionalBlocks(TPL_mainActivity, p) },
    { filePath: "app/src/main/java/com/ndjc/app/ui/theme/Theme.kt",  content: injectConditionalBlocks(TPL_themeKt, p) },
    { filePath: "app/src/main/java/com/ndjc/app/ui/theme/Color.kt",  content: injectConditionalBlocks(TPL_colorKt, p) },
    { filePath: "app/src/main/java/com/ndjc/app/ui/theme/Shape.kt",  content: injectConditionalBlocks(TPL_shapeKt, p) },
    { filePath: "app/src/main/java/com/ndjc/app/data/ThemePrefs.kt", content: injectConditionalBlocks(TPL_themePrefs, p) }
  ];
  // 你也可以在这里把 app/icon.svg 兜底写进去（如用字母图标）
  files.push({
    filePath: "app/icon.svg",
    content: makeLetterIconSVG(
      (p.NDJC_APP_NAME || "APP").trim().split(/\s+/).map((s:string)=>s[0]).join("").slice(0,2),
      p.NDJC_APP_ICON_BG_COLOR,
      "#FFFFFF"
    )
  });
  return files;
}

// 一个超简的“字母图标”SVG，作兜底（AI/上传缺省时也能打包）
export function makeLetterIconSVG(text: string, bg: string, fg: string) {
  const t = (text || "APP").slice(0, 2).toUpperCase();
  return `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" rx="200" fill="${bg}"/>
  <text x="50%" y="55%" text-anchor="middle"
        font-family="Inter, system-ui, Roboto, Helvetica, Arial, sans-serif"
        font-size="560" font-weight="800" fill="${fg}">
    ${t}
  </text>
</svg>`.trim();
}

// ================ 5) 真推送 + 触发打包 ================
const GH_TOKEN  = process.env.GITHUB_TOKEN!;
const GH_OWNER  = process.env.GITHUB_OWNER!;
const GH_REPO   = process.env.GITHUB_REPO!;
const GH_BRANCH = process.env.GITHUB_BRANCH || "main";

async function githubGetFileSha(path: string) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path)}?ref=${GH_BRANCH}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "ndjc" } });
  if (r.status === 200) { const j: any = await r.json(); return j.sha as string; }
  return undefined;
}

async function githubPutFile(path: string, content: string, message: string, base64?: boolean) {
  const sha = await githubGetFileSha(path);
  const body: any = {
    message,
    branch: GH_BRANCH,
    content: base64 ? content : Buffer.from(content, "utf8").toString("base64")
  };
  if (sha) body.sha = sha;

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path)}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      "User-Agent": "ndjc",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) { throw new Error(`GitHub PUT ${path} failed: ${r.status} ${await r.text()}`); }
}

/** 推文件 + 触发 workflow_dispatch（android-build-matrix.yml） */
export async function commitAndBuild(input: {
  files: CommitFile[];
  message?: string;
  workflowFile?: string;  // 默认 android-build-matrix.yml
  ref?: string;           // 默认 GH_BRANCH
}): Promise<{ ok: boolean; writtenCount: number; note?: string }> {
  const files = input?.files ?? [];
  const msg = input?.message || `NDJC: update ${new Date().toISOString()}`;
  const workflowFile = input?.workflowFile || "android-build-matrix.yml";
  const ref = input?.ref || GH_BRANCH;

  let written = 0;
  for (const f of files) { await githubPutFile(f.filePath, f.content, msg, f.base64); written++; }

  // 触发打包
  const triggerUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const r = await fetch(triggerUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${GH_TOKEN}`, "User-Agent": "ndjc", "Content-Type": "application/json" },
    body: JSON.stringify({ ref })
  });
  if (!r.ok) { throw new Error(`Workflow dispatch failed: ${r.status} ${await r.text()}`); }

  return { ok: true, writtenCount: written, note: "pushed to GitHub & workflow dispatched" };
}
