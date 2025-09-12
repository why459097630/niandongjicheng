param(
  [int]    $Port  = 4311,
  [string] $Repo  = $( if ($env:PACKAGING_REPO_PATH) { $env:PACKAGING_REPO_PATH } else { "E:\NDJC\Packaging-warehouse" } ),
  [switch] $Build = $false
)

$ErrorActionPreference = 'Stop'

# 脚本目录容错：脚本文件执行 > 交互式两用
$ScriptDir = if ($PSScriptRoot) {
  $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
  Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
  (Get-Location).Path
}

Write-Host "== 0) 环境信息 ==" -ForegroundColor Cyan
Write-Host "API : http://127.0.0.1:$Port" -ForegroundColor Gray
Write-Host "Repo: $Repo"               -ForegroundColor Gray

# 1) 健康检查
Write-Host "`n== 1) 检查 API /health ==" -ForegroundColor Cyan
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
  if (-not $h.ok) { throw "health 返回非 ok" }
  Write-Host "API 在线" -ForegroundColor Green
} catch {
  throw "API 未在线（http://127.0.0.1:$Port/api/health 不可达）。请先在 niandongjicheng 目录启动 Next dev（示例：`$env:NDJC_API_PORT=$Port; pnpm dev -- --port `$env:NDJC_API_PORT`）。"
}

# 2) 发送一次 core 需求（方案A）
Write-Host "`n== 2) 发送一次 core 需求（方案A）==" -ForegroundColor Cyan
$spec = @'
APP 名称「Hello core」
首页标题“Start core”
需要权限：INTERNET、ACCESS_NETWORK_STATE
要能处理链接 https://example.com
'@

$bodyObj = [ordered]@{
  template        = 'core'
  requirement     = $spec
  mode            = 'A'      # 方案A：LLM 仅做字段抽取
  allowCompanions = $false   # 只有 B 才允许
}
$body = $bodyObj | ConvertTo-Json -Depth 10

Write-Host "== 请求体 ==" -ForegroundColor DarkGray
$body

function Invoke-PostJson([string]$url, [string]$json) {
  try {
    return Invoke-RestMethod -Uri $url -Method POST -ContentType 'application/json' -Body $json
  } catch {
    if ($_.Exception.Response) {
      $sr  = New-Object System.IO.StreamReader ($_.Exception.Response.GetResponseStream())
      $raw = $sr.ReadToEnd()
      throw "API 调用失败（$url）: $raw"
    } else {
      throw
    }
  }
}

$res = Invoke-PostJson "http://127.0.0.1:$Port/api/generate-apk" $body
if (-not $res.ok) { throw "后端返回错误：$($res | ConvertTo-Json -Depth 10)" }

$runId = $res.runId
Write-Host "runId: $runId" -ForegroundColor Green
if (-not $runId) { throw "runId 为空，无法定位请求目录。" }

# 3) 读取 apply 结果并扁平化
Write-Host "`n== 3) 读取 apply 结果并扁平化 ==" -ForegroundColor Cyan
$reqDir   = Join-Path $Repo "requests\$runId"
$applyFile = Join-Path $reqDir "03_apply_result.json"
if (-not (Test-Path $applyFile)) { throw "未找到 $applyFile（请确认后端 route.ts 已按最新版本写入日志文件）。" }

$apply = Get-Content $applyFile -Raw | ConvertFrom-Json

function Flatten-Changes($apply, [string]$tpl='core') {
  foreach ($f in $apply) {
    foreach ($c in $f.changes) {
      [pscustomobject]@{
        Template = $tpl
        File     = $f.file
        Marker   = $c.marker
        Found    = [int]$c.found
        Replaced = [int]$c.replacedCount
      }
    }
  }
}
$flat = Flatten-Changes $apply 'core'

# 3.1) 必选与可选锚点统计
$required = @('NDJC:APP_LABEL','NDJC:HOME_TITLE','NDJC:MAIN_BUTTON')
$optional = @(
  'NDJC:PERMISSIONS','NDJC:COMPILE_SDK','NDJC:MIN_SDK','NDJC:TARGET_SDK',
  'NDJC:VERSION_CODE','NDJC:VERSION_NAME','NDJC:PLUGINS_EXTRA','NDJC:DEPENDENCIES_EXTRA',
  'NDJC:SIGNING_CONFIG','NDJC:RES_CONFIGS','NDJC:PACKAGING_RULES','NDJC:LOCALE_CONFIG',
  'BLOCK:THEME_OVERRIDES','BLOCK:INTENT_FILTERS'
)

Write-Host "`n== 3.2) 必选锚点（core）==" -ForegroundColor Yellow
$missReq = $flat | Where-Object { $_.Marker -in $required -and $_.Replaced -lt 1 } |
           Group-Object Marker | ForEach-Object { [pscustomobject]@{ Marker=$_.Name } }
if ($missReq) {
  $flat | Where-Object { $_.Marker -in $required } |
    Sort-Object Marker |
    Format-Table Marker, File, Found, Replaced -AutoSize
  Write-Host "必选项有缺失 ↑" -ForegroundColor Red
} else {
  Write-Host "必选项全部替换 ✅" -ForegroundColor Green
}

Write-Host "`n== 3.3) 可选锚点（core）==" -ForegroundColor Yellow
$flat | Where-Object { $_.Marker -in $optional } |
  Group-Object Marker | ForEach-Object {
    [pscustomobject]@{
      Marker  = $_.Name
      Replaced1 = ($flat | ? { $_.Marker -eq $_.Name -and $_.Replaced -ge 1 }).Count
      Miss      = ($flat | ? { $_.Marker -eq $_.Name -and $_.Replaced -lt 1 }).Count
    }
  } | Sort-Object Marker | Format-Table -AutoSize

# 4) 扫描 NDJC/BLOCK 残留
Write-Host "`n== 4) 扫描 NDJC/BLOCK 残留 ==" -ForegroundColor Cyan
$appDir = Join-Path $Repo "app"
$scan = Get-ChildItem $appDir -Recurse -File -ErrorAction SilentlyContinue `
  -Include *.xml,*.gradle,*.kts,*.kt,*.java,*.txt,*.pro,*.json |
  Where-Object { $_.FullName -notmatch '\\build\\|\\intermediates\\|\\.gradle\\' }
$leftover = $scan | Select-String -Pattern 'NDJC:','BLOCK:' -ErrorAction SilentlyContinue
if ($leftover) {
  Write-Host "⚠️ 发现可能残留的 NDJC/BLOCK 标记（仅提示）" -ForegroundColor DarkYellow
  $leftover | Select-Object Path, Line | Format-Table -AutoSize
} else {
  Write-Host "未发现残留 ✅" -ForegroundColor Green
}

# 5) （可选）构建 release
if ($Build) {
  Write-Host "`n== 5) Gradle 构建（可选）==" -ForegroundColor Cyan
  Push-Location $appDir
  try {
    .\gradlew.bat clean :app:assembleRelease
  } finally {
    Pop-Location
  }
  Write-Host "构建完成，APK 请在 app\build\outputs\apk 下查看。" -ForegroundColor Green
}
