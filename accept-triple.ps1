<# accept-triple.ps1
   simple / core / form 三模板串行验收
#>

param(
  [int]$Port = $(if ($env:NDJC_API_PORT) { [int]$env:NDJC_API_PORT } else { 4311 }),
  [string]$Repo = $(if ($env:PACKAGING_REPO_PATH) { $env:PACKAGING_REPO_PATH } else { "E:\NDJC\Packaging-warehouse" }),
  [switch]$FailOnLeftoverAnchors = $true
)

$ErrorActionPreference = 'Stop'
$templates = @('simple','core','form')

function New-Body {
  param([string]$tpl)
  $ts = Get-Date -Format 'yyyyMMddHHmmss'

  # 与 accept-core.ps1 一致的 Sprint5/6 示例
  $locales = 'en,zh-rCN,zh-rTW'
  $permissionsXml = @"
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
"@.Trim()

  $intentFiltersXml = @"
<intent-filter>
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="example.com"/>
</intent-filter>
"@.Trim()

  $themeOverridesXml = @"
<item name="android:statusBarColor">?attr/colorPrimary</item>
"@.Trim()

  $packagingRules = @"
resources {
    excludes += [
        'META-INF/AL2.0',
        'META-INF/LGPL2.1',
        'META-INF/*.kotlin_module',
        'META-INF/licenses/**',
        'META-INF/NOTICE*',
        'META-INF/LICENSE*'
    ]
}
"@.Trim()

  @{
    template       = $tpl
    appName        = "NDJC $tpl"
    packageId      = "com.ndjc.demo.$tpl$ts"
    homeTitle      = "Hello $tpl"
    mainButtonText = "Start $tpl"

    localesEnabled = $true
    localesList    = $locales
    resConfigs     = $locales

    proguardExtra  = ",'proguard-ndjc.pro'"
    packagingRules = $packagingRules

    permissionsXml    = $permissionsXml
    intentFiltersXml  = $intentFiltersXml
    themeOverridesXml = $themeOverridesXml
  } | ConvertTo-Json -Depth 10
}

function Post-One {
  param([string]$tpl)
  $url = "http://127.0.0.1:$Port/api/generate-apk"
  Write-Host "`n=== Build $tpl ===" -ForegroundColor Cyan
  $body = New-Body $tpl
  Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/json"
}

function Read-ApplyJsonByRunId([string]$runId) {
  $p = Join-Path $Repo "requests\$runId\03_apply_result.json"
  if (!(Test-Path $p)) { throw "缺少 $p" }
  Get-Content $p -Raw | ConvertFrom-Json
}

function Flatten($applyJson, $tpl) {
  foreach($f in $applyJson){
    foreach($c in $f.changes){
      [pscustomobject]@{
        Template  = $tpl
        File      = $f.file
        Marker    = $c.marker
        Found     = [bool]$c.found
        Replaced  = [int]$c.replacedCount
      }
    }
  }
}

$all = @()
$apkList = @()

foreach($tpl in $templates) {
  $res   = Post-One $tpl
  $runId = $res.runId
  if (-not $runId) { throw "API 未返回 runId（$tpl）" }

  $apply = Read-ApplyJsonByRunId $runId
  $flat  = Flatten $apply $tpl
  $all  += $flat

  $apk = Get-ChildItem (Join-Path $Repo "outputs\$tpl\*.apk") -Recurse -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Desc | Select-Object -First 1
  if ($apk) { $apkList += [pscustomobject]@{ Template=$tpl; Apk=$apk.FullName } }
}

$required = @('NDJC:APP_LABEL','NDJC:HOME_TITLE','NDJC:MAIN_BUTTON')
$optional = @(
  'NDJC:PACKAGE_NAME','NDJC:COMPILE_SDK','NDJC:MIN_SDK','NDJC:TARGET_SDK',
  'NDJC:VERSION_CODE','NDJC:VERSION_NAME','NDJC:PLUGINS_EXTRA','NDJC:DEPENDENCIES_EXTRA','NDJC:SIGNING_CONFIG',
  'NDJC:RES_CONFIGS','NDJC:PROGUARD_FILES_EXTRA','NDJC:PACKAGING_RULES','NDJC:LOCALE_CONFIG',
  'BLOCK:PERMISSIONS','BLOCK:INTENT_FILTERS','BLOCK:THEME_OVERRIDES'
)

Write-Host "`n=== 必选锚点命中（按模板分组） ===" -ForegroundColor Yellow
$all | Where-Object { $_.Marker -in $required } |
  Group-Object Template, Marker |
  Select-Object @{n='Template';e={$_.Group[0].Template}},
                @{n='Marker';e={$_.Group[0].Marker}},
                @{n='Replaced≥1';e={ ($_.Group | Where-Object { $_.Replaced -ge 1 }).Count }},
                @{n='Miss';e={ ($_.Group | Where-Object { $_.Replaced -lt 1 }).Count }} |
  Sort-Object Template, Marker | Format-Table -AutoSize

Write-Host "`n=== 可选锚点命中（按模板分组） ===" -ForegroundColor Yellow
$all | Where-Object { $_.Marker -in $optional } |
  Group-Object Template, Marker |
  Select-Object @{n='Template';e={$_.Group[0].Template}},
                @{n='Marker';e={$_.Group[0].Marker}},
                @{n='Replaced≥1';e={ ($_.Group | Where-Object { $_.Replaced -ge 1 }).Count }},
                @{n='Miss';e={ ($_.Group | Where-Object { $_.Replaced -lt 1 }).Count }} |
  Sort-Object Template, Marker | Format-Table -AutoSize

# 扫 NDJC 残留（以最后一次构建后的 workspace/app 为准）
$leftover = Get-ChildItem (Join-Path $Repo 'app') -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\build\\|\\intermediates\\|\\.gradle\\' } |
            Select-String -Pattern 'NDJC:' -SimpleMatch -ErrorAction SilentlyContinue

if ($leftover) {
  Write-Host "`n⚠️ 发现残留 NDJC: 标记（仅提示）" -ForegroundColor DarkYellow
  $leftover | Select-Object Path, Line | Format-Table -AutoSize
}

Write-Host "`n=== APK 列表 ===" -ForegroundColor Cyan
$apkList | Format-Table -AutoSize

# 失败判定：任一模板的必选 Miss 或（开启时）发现残留 或 任一模板无 APK
$missRequired = $all | Where-Object { $_.Marker -in $required -and $_.Replaced -lt 1 }
$someApkMissing = ($templates | Where-Object { ($apkList | Where-Object { $_.Template -eq $_ }).Count -eq 0 }).Count -gt 0
$failed = $false
if ($missRequired) { $failed = $true }
if ($someApkMissing) { $failed = $true }
if ($FailOnLeftoverAnchors -and $leftover) { $failed = $true }

if ($failed) {
  Write-Host "`n❌ 三模板验收未通过" -ForegroundColor Red
  exit 1
} else {
  Write-Host "`n✅ 三模板验收通过" -ForegroundColor Green
  exit 0
}
