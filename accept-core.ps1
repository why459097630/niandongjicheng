<# accept-core.ps1
   Core：一键 生成 → release 构建 →（可选）签名 → 归档 → 验收
   适配 Windows PowerShell 5.1 / PowerShell 7
#>

param(
  [int]    $Port  = $(if ($env:NDJC_API_PORT)       { [int]$env:NDJC_API_PORT }       else { 4311 }),
  [string] $Repo  = $(if ($env:PACKAGING_REPO_PATH) {        $env:PACKAGING_REPO_PATH } else { 'E:\NDJC\Packaging-warehouse' }),
  [switch] $FailOnLeftoverAnchors = $true,

  # （可选）签名参数：也可用环境变量覆盖 NDJC_KEYSTORE_FILE / NDJC_KEY_ALIAS / NDJC_KEY_PASS / NDJC_STORE_PASS
  [string] $Keystore  = '',
  [string] $KeyAlias  = '',
  [string] $KeyPass   = '',
  [string] $StorePass = ''
)

$ErrorActionPreference = 'Stop'

# ========== 0) 端口硬化（防止 0 / 非法值） ==========
function Resolve-PortSafely {
  param([object]$Candidate, [int]$Default = 4311)

  $s = "$Candidate"
  if ($null -eq $s) { return $Default }
  $s = $s.Trim()

  if ($s -notmatch '^\d+$') { return $Default }
  $n = [int]$s
  if ($n -lt 1 -or $n -gt 65535) { return $Default }
  return $n
}

# 优先使用 param 传入的值；若异常则回落；并把最终端口同步回环境变量给子进程使用
$Port = Resolve-PortSafely $Port 4311
if (-not $env:NDJC_API_PORT -or (Resolve-PortSafely $env:NDJC_API_PORT 0) -ne $Port) {
  $env:NDJC_API_PORT = "$Port"
}

# ========== 0.1) 基础上下文 / 默认值 ==========

# 脚本目录
$thisScript = $MyInvocation.MyCommand.Path
$ScriptDir  = if ($thisScript) { Split-Path -Parent $thisScript } else { (Get-Location).Path }

# 目标仓库
if (-not $Repo -or $Repo.Trim() -eq '') {
  if ($env:PACKAGING_REPO_PATH) { $Repo = $env:PACKAGING_REPO_PATH } else { $Repo = 'E:\NDJC\Packaging-warehouse' }
}
$Repo = (Resolve-Path -LiteralPath $Repo).Path

# 解析签名参数（优先显式入参，其次环境变量，最后落到 demo jks）
if (-not $Keystore  -or $Keystore.Trim()  -eq '') { if ($env:NDJC_KEYSTORE_FILE) { $Keystore  = $env:NDJC_KEYSTORE_FILE }  else { $Keystore  = Join-Path $ScriptDir 'signing\ndjc-release.jks' } }
if (-not $KeyAlias  -or $KeyAlias.Trim()  -eq '') { if ($env:NDJC_KEY_ALIAS)     { $KeyAlias  = $env:NDJC_KEY_ALIAS }      else { $KeyAlias  = 'ndjc' } }
if (-not $KeyPass   -or $KeyPass.Trim()   -eq '') { if ($env:NDJC_KEY_PASS)      { $KeyPass   = $env:NDJC_KEY_PASS }       else { $KeyPass   = 'ndjc_pass' } }
if (-not $StorePass -or $StorePass.Trim() -eq '') { if ($env:NDJC_STORE_PASS)    { $StorePass = $env:NDJC_STORE_PASS }     else { $StorePass = 'ndjc_pass' } }

Write-Host "Core 验收：仓库=$Repo，API端口=$Port（会自动拉起），签名=${Keystore}" -ForegroundColor Green

# ========== 0.2) Next API 健康检查 / 自启动 ==========

function Ensure-NdjcApi {
  $ok = $false
  try { $null = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 1 ; $ok = $true } catch { }
  if (-not $ok) {
    Write-Host "启动 Next API（端口 $Port）..." -ForegroundColor Yellow

    # 如你的 package.json 的 dev 已固定端口，这里可改为仅 'npm run dev'
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", ("npm run dev -- -p {0}" -f $Port) -WorkingDirectory $ScriptDir -WindowStyle Minimized

    for ($i=0; $i -lt 15; $i++) {
      Start-Sleep -Seconds 1
      try { $null = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 1 ; $ok = $true; break } catch { }
    }
  }
  if (-not $ok) { throw ("Next API 未能启动（端口 {0}）。请先在项目根执行：npm run dev -p {0}" -f $Port) }
}
Ensure-NdjcApi

# ========== 1) 组装 core 请求体 & 触发生成 ==========

function New-BodyCore {
  param([string]$tpl = 'core')
  $ts = Get-Date -Format 'yyyyMMddHHmmss'

  $locales = 'en,zh-rCN,zh-rTW'

  $permissionsXml = @'
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
'@.Trim()

  $intentFiltersXml = @'
<intent-filter>
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="example.com"/>
</intent-filter>
'@.Trim()

  $themeOverridesXml = @'
<item name="android:statusBarColor">?attr/colorPrimary</item>
'@.Trim()

  $packagingRules = @'
resources {
  excludes += [
    "META-INF/AL2.0",
    "META-INF/LGPL2.1",
    "META-INF/*.kotlin_module",
    "META-INF/licenses/**",
    "META-INF/NOTICE*",
    "META-INF/LICENSE*"
  ]
}
'@.Trim()

  @{
    template       = $tpl
    appName        = ("NDJC {0}" -f $tpl)
    packageId      = ("com.ndjc.demo.{0}{1}" -f $tpl, $ts)
    homeTitle      = ("Hello {0}" -f $tpl)
    mainButtonText = ("Start {0}" -f $tpl)

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

function Invoke-BuildCore {
  $body = New-BodyCore
  $url  = ("http://127.0.0.1:{0}/api/generate-apk" -f $Port)
  Write-Host ("POST {0} (core)" -f $url) -ForegroundColor Cyan

  try {
    return Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/json"
  } catch {
    # —— 500 报文体打印（含文本/JSON）——
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode.value__ -eq 500) {
      try {
        $stream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $raw    = $reader.ReadToEnd()
        Write-Host "`n--- 500 Response Body ---" -ForegroundColor Yellow
        Write-Host $raw
        Write-Host "------------------------`n" -ForegroundColor Yellow
      } catch {}
    }
    throw
  }
}

function Get-RequestDirByRunId([string]$repo, [string]$runId) {
  $p = Join-Path $repo ("requests\{0}" -f $runId)
  if (!(Test-Path $p)) { throw ("找不到请求目录：{0}" -f $p) }
  Get-Item $p
}

function Read-ApplyJson($reqDir) {
  $p = Join-Path $reqDir '03_apply_result.json'
  if (!(Test-Path $p)) { throw ("缺少 03_apply_result.json：{0}" -f $p) }
  Get-Content $p -Raw | ConvertFrom-Json
}

function Flatten-Changes($applyJson, [string]$tpl='core') {
  foreach($f in $applyJson){
    foreach($c in $f.changes){
      [pscustomobject]@{
        Template = $tpl
        File     = $f.file
        Marker   = $c.marker
        Found    = [bool]$c.found
        Replaced = [int]$c.replacedCount
      }
    }
  }
}

# 触发一次编排/应用
$res   = Invoke-BuildCore
$runId = $res.runId
if (-not $runId) { throw "API 未返回 runId，无法定位请求目录。" }

# 读取并扁平化锚点命中
$reqDir = (Get-RequestDirByRunId $Repo $runId).FullName
$apply  = Read-ApplyJson $reqDir
$flat   = Flatten-Changes $apply 'core'

# 必选锚点（UI 文案）
$required = @('NDJC:APP_LABEL','NDJC:HOME_TITLE','NDJC:MAIN_BUTTON')

# 可选锚点（Gradle & 扩展 & 块锚点）
$optional = @(
  'NDJC:PACKAGE_NAME','NDJC:COMPILE_SDK','NDJC:MIN_SDK','NDJC:TARGET_SDK',
  'NDJC:VERSION_CODE','NDJC:VERSION_NAME','NDJC:PLUGINS_EXTRA','NDJC:DEPENDENCIES_EXTRA','NDJC:SIGNING_CONFIG',
  'NDJC:RES_CONFIGS','NDJC:PROGUARD_FILES_EXTRA','NDJC:PACKAGING_RULES','NDJC:LOCALE_CONFIG',
  'BLOCK:PERMISSIONS','BLOCK:INTENT_FILTERS','BLOCK:THEME_OVERRIDES'
)

Write-Host "`n=== 必选锚点命中（core） ===" -ForegroundColor Yellow
$flat | Where-Object { $_.Marker -in $required } |
  Group-Object Marker |
  Select-Object @{n='Marker';e={$_.Name}},
                @{n='Replaced≥1';e={ ($_.Group | Where-Object { $_.Replaced -ge 1 }).Count }},
                @{n='Miss';e={ ($_.Group | Where-Object { $_.Replaced -lt 1 }).Count }} |
  Sort-Object Marker | Format-Table -AutoSize

$missRequired = $flat | Where-Object { $_.Marker -in $required -and $_.Replaced -lt 1 }
if ($missRequired) {
  Write-Host ">>> 必选未命中：" -ForegroundColor Red
  $missRequired | Format-Table Marker, File, Found, Replaced -AutoSize
}

Write-Host "`n=== 可选锚点命中（core） ===" -ForegroundColor Yellow
$flat | Where-Object { $_.Marker -in $optional } |
  Group-Object Marker |
  Select-Object @{n='Marker';e={$_.Name}},
                @{n='Replaced≥1';e={ ($_.Group | Where-Object { $_.Replaced -ge 1 }).Count }},
                @{n='Miss';e={ ($_.Group | Where-Object { $_.Replaced -lt 1 }).Count }} |
  Sort-Object Marker | Format-Table -AutoSize

$missOptional = $flat | Where-Object { $_.Marker -in $optional -and $_.Replaced -lt 1 }

# ========== 2) Gradle release 构建 ==========

function Get-Gradlew([string]$repo){
  $candidates = @(
    (Join-Path $repo 'gradlew.bat'),
    (Join-Path $repo 'app\gradlew.bat')
  )
  foreach($p in $candidates){ if (Test-Path $p) { return $p } }
  return $null
}

function Build-Release([string]$repo) {
  $gradlew = Get-Gradlew $repo
  if (-not $gradlew) { throw "找不到 gradlew.bat（请确保仓库根或 app 目录下存在 Gradle Wrapper）" }

  $projRoot = Split-Path -Parent $gradlew
  Write-Host ("`n==> gradle assembleRelease（{0}）" -f $projRoot) -ForegroundColor Cyan

  Push-Location $projRoot
  try {
    & $gradlew ":app:clean"
    & $gradlew ":app:assembleRelease" "-x" "lint"
    if ($LASTEXITCODE -ne 0) { throw ("Gradle 构建失败（exit={0}）" -f $LASTEXITCODE) }
  } finally {
    Pop-Location
  }
}

function Find-ReleaseApk([string]$repo){
  $paths = @(
    (Join-Path $repo 'app\build\outputs\apk\release\*.apk'),
    (Join-Path $repo 'build\outputs\apk\release\*.apk')
  )
  foreach($g in $paths){
    $apk = Get-ChildItem $g -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Desc | Select-Object -First 1
    if ($apk) { return $apk }
  }
  return $null
}

# ========== 2.1) 签名辅助 ==========

function Resolve-ApkSigner([string]$repo) {
  $candidates = @()

  # 从 local.properties 里找 sdk.dir
  $lp = Join-Path $repo 'local.properties'
  if (Test-Path $lp) {
    $line = (Select-String -Path $lp -Pattern '^sdk\.dir=' -ErrorAction SilentlyContinue | Select-Object -First 1).Line
    if ($line) {
      $sdk = $line -replace '^sdk\.dir=',''
      $sdk = $sdk -replace '\\\\','\'
      if ($sdk -and (Test-Path $sdk)) { $candidates += (Join-Path $sdk 'build-tools\*\apksigner*') }
    }
  }

  if ($env:ANDROID_SDK_ROOT) { $candidates += (Join-Path $env:ANDROID_SDK_ROOT 'build-tools\*\apksigner*') }
  if ($env:ANDROID_HOME)     { $candidates += (Join-Path $env:ANDROID_HOME     'build-tools\*\apksigner*') }

  foreach($g in $candidates){
    $f = Get-ChildItem $g -ErrorAction SilentlyContinue | Sort-Object FullName -Desc | Select-Object -First 1
    if ($f) { return $f.FullName }
  }
  return $null
}

function Sign-Apk([string]$apkPath) {
  if ($env:NDJC_SIGNING_DISABLED -eq '1') { return $false }
  if (-not (Test-Path $Keystore)) { Write-Host ("未找到有效 keystore：{0}，已禁用签名（NDJC_SIGNING_DISABLED=1）" -f $Keystore) -ForegroundColor Yellow; return $false }

  $apksigner = Resolve-ApkSigner $Repo
  if (-not $apksigner) { Write-Host "未找到 apksigner，跳过签名（可设置 ANDROID_SDK_ROOT/ANDROID_HOME）" -ForegroundColor Yellow; return $false }

  Write-Host ("使用 apksigner：{0}" -f $apksigner) -ForegroundColor Gray

  & $apksigner sign `
      --ks "$Keystore" `
      --ks-key-alias "$KeyAlias" `
      --ks-pass ("pass:{0}" -f $StorePass) `
      --key-pass ("pass:{0}" -f $KeyPass) `
      "$apkPath"

  if ($LASTEXITCODE -ne 0) { throw "apksigner 签名失败" }

  # 校验
  & $apksigner verify --print-certs "$apkPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "apksigner 校验失败" }

  return $true
}

function Archive-APK([string]$repo, $apk, [bool]$signed){
  if (-not $apk) { return $null }
  $outRoot = Join-Path $repo 'outputs\core'
  New-Item -ItemType Directory -Force -Path $outRoot | Out-Null
  $ts   = Get-Date -Format 'yyyyMMddHHmmss'
  $name = if ($signed) { 'ndjc-core-signed' } else { 'ndjc-core' }
  $dst  = Join-Path $outRoot ("{0}-{1}.apk" -f $name, $ts)
  Copy-Item $apk.FullName $dst -Force
  return (Get-Item $dst)
}

# ====== 执行构建 ======
try {
  Build-Release $Repo
} catch {
  Write-Host ("Gradle 构建异常：{0}" -f $_.Exception.Message) -ForegroundColor Red
  throw
}

$apkBuilt = Find-ReleaseApk $Repo
if ($apkBuilt) {
  Write-Host ("APK (release): {0}" -f $apkBuilt.FullName) -ForegroundColor Green
} else {
  Write-Host "未找到 release APK（请检查 Gradle 构建日志）" -ForegroundColor Red
}

# ========== 2.2) 执行签名（可通过 NDJC_SIGNING_DISABLED=1 关闭） ==========
$signed = $false
if ($apkBuilt) {
  try {
    $signed = Sign-Apk $apkBuilt.FullName
    if ($signed) { Write-Host "签名完成（apksigner）" -ForegroundColor Green }
  } catch {
    Write-Host ("签名失败：{0}" -f $_.Exception.Message) -ForegroundColor Red
    $signed = $false
  }
}

# ========== 2.3) 归档 ==========
$archived = $null
if ($apkBuilt) {
  $archived = Archive-APK $Repo $apkBuilt $signed
  if ($archived) {
    Write-Host ("已归档到 outputs/core：{0}" -f $archived.FullName) -ForegroundColor Green
  }
}

# ========== 3) XML 快速体检（常见因剥离导致的截断）==========
$xmlHotspots = @(
  (Join-Path $Repo 'app\src\main\res\xml\network_security_config.xml')
)
foreach($x in $xmlHotspots){
  if (Test-Path $x) {
    $text = Get-Content $x -Raw
    if ($text -notmatch '</network-security-config>') {
      Write-Host ("修正：{0} 缺少闭合标签，自动补齐。" -f $x) -ForegroundColor Yellow
      $fixed = $text.TrimEnd() + "`n</network-security-config>`n"
      Set-Content -Path $x -Value $fixed -Encoding UTF8
    }
  }
}

# ========== 4) 剩余 NDJC/BLOCK 标记扫描 ==========
$scanFiles = Get-ChildItem (Join-Path $Repo 'app') -Recurse -File -ErrorAction SilentlyContinue `
  -Include *.xml,*.gradle,*.kts,*.kt,*.pro,*.txt,*.json |
  Where-Object { $_.FullName -notmatch '\\build\\|\\intermediates\\|\\.gradle\\' }

$leftover = $scanFiles | Select-String -Pattern 'NDJC:', 'BLOCK:' -ErrorAction SilentlyContinue

if ($leftover) {
  Write-Host "`n⚠️ 发现残留 NDJC/BLOCK 标记（仅提示）" -ForegroundColor DarkYellow
  $leftover | Select-Object Path, Line | Format-Table -AutoSize
  if ($FailOnLeftoverAnchors) {
    Write-Host "（按参数 FailOnLeftoverAnchors，视为失败）" -ForegroundColor DarkYellow
  }
} else {
  Write-Host "`n未发现残留 NDJC/BLOCK 标记" -ForegroundColor Green
}

# ========== 5) 生成验收简报（CSV） ==========
$csv = Join-Path $reqDir '06_accept_summary.csv'
$apkPathStr   = if ($apkBuilt) { $apkBuilt.FullName } else { '' }
$archivedPath = if ($archived) { $archived.FullName } else { '' }
$leftCnt      = if ($leftover) { ($leftover | Measure-Object).Count } else { 0 }

$report = [pscustomobject]@{
  Time            = (Get-Date).ToString('s')
  RunId           = $runId
  Apk             = $apkPathStr
  ArchivedTo      = $archivedPath
  Signed          = $signed
  MissRequired    = ($missRequired | Measure-Object).Count
  MissOptional    = ($missOptional | Measure-Object).Count
  LeftoverAnchors = $leftCnt
}
$report | Export-Csv -NoTypeInformation -Encoding UTF8 $csv
Write-Host ("`n验收报告：{0}" -f $csv) -ForegroundColor Cyan

# ========== 6) 通过 / 失败判定 ==========
$failed = $false
if ($missRequired -and ($missRequired | Measure-Object).Count -gt 0) { $failed = $true }
if (-not $apkBuilt) { $failed = $true }
if ($FailOnLeftoverAnchors -and $leftover -and ($leftover | Measure-Object).Count -gt 0) { $failed = $true }

if ($failed) {
  Write-Host "`n❌ 验收未通过（见上方未命中/残留/构建/签名日志）" -ForegroundColor Red
  if (-not $env:NDJC_CI) { Read-Host "按 Enter 退出" | Out-Null }
  exit 1
} else {
  Write-Host "`n✅ 验收通过" -ForegroundColor Green
  if (-not $env:NDJC_CI) { Read-Host "按 Enter 退出" | Out-Null }
  exit 0
}
