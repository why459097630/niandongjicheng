param(
  [string]$Repo      = $(if ($env:PACKAGING_REPO_PATH) { $env:PACKAGING_REPO_PATH } else { 'E:\NDJC\Packaging-warehouse' }),
  [string]$Keystore  = $(if ($env:NDJC_KEYSTORE_FILE) { $env:NDJC_KEYSTORE_FILE } else { ".\signing\ndjc-release.jks" }),
  [string]$KeyAlias  = $(if ($env:NDJC_KEY_ALIAS)     { $env:NDJC_KEY_ALIAS }     else { "ndjc" }),
  [string]$KeyPass   = $(if ($env:NDJC_KEY_PASS)      { $env:NDJC_KEY_PASS }      else { "ndjc_pass" }),
  [string]$StorePass = $(if ($env:NDJC_STORE_PASS)    { $env:NDJC_STORE_PASS }    else { "ndjc_pass" })
)

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path -LiteralPath $Repo).Path

function Get-Gradlew([string]$repo){
  $candidates = @((Join-Path $repo 'gradlew.bat'), (Join-Path $repo 'app\gradlew.bat'))
  foreach($p in $candidates){ if (Test-Path $p) { return $p } }
  return $null
}

function Build-Release([string]$repo) {
  $gradlew = Get-Gradlew $repo
  if (-not $gradlew) { throw "找不到 gradlew.bat" }
  $projRoot = Split-Path -Parent $gradlew
  Push-Location $projRoot
  try {
    & $gradlew ":app:clean"
    & $gradlew ":app:assembleRelease" "-x" "lint"
    if ($LASTEXITCODE -ne 0) { throw ("Gradle 构建失败（exit={0}）" -f $LASTEXITCODE) }
  } finally { Pop-Location }
}

function Find-ReleaseApk([string]$repo){
  foreach($g in @((Join-Path $repo 'app\build\outputs\apk\release\*.apk'), (Join-Path $repo 'build\outputs\apk\release\*.apk'))){
    $apk = Get-ChildItem $g -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Desc | Select-Object -First 1
    if ($apk) { return $apk }
  }
  return $null
}

function Resolve-ApkSigner([string]$repo) {
  $cands = @()
  $lp = Join-Path $repo 'local.properties'
  if (Test-Path $lp) {
    $line = (Select-String -Path $lp -Pattern '^sdk\.dir=' -ErrorAction SilentlyContinue | Select-Object -First 1).Line
    if ($line) {
      $sdk = $line -replace '^sdk\.dir=',''
      $sdk = $sdk -replace '\\\\','\'
      if ($sdk -and (Test-Path $sdk)) { $cands += (Join-Path $sdk 'build-tools\*\apksigner*') }
    }
  }
  if ($env:ANDROID_SDK_ROOT) { $cands += (Join-Path $env:ANDROID_SDK_ROOT 'build-tools\*\apksigner*') }
  if ($env:ANDROID_HOME)     { $cands += (Join-Path $env:ANDROID_HOME     'build-tools\*\apksigner*') }

  foreach($g in $cands){
    $f = Get-ChildItem $g -ErrorAction SilentlyContinue | Sort-Object FullName -Desc | Select-Object -First 1
    if ($f) { return $f.FullName }
  }
  return $null
}

function Sign-Apk([string]$apkPath, [string]$keystore, [string]$alias, [string]$kpass, [string]$spass, [string]$repo) {
  if ($env:NDJC_SIGNING_DISABLED -eq '1') { return $false }
  if (-not (Test-Path $keystore)) { Write-Host ("未找到 keystore：{0}，跳过签名" -f $keystore) -ForegroundColor Yellow; return $false }
  $apksigner = Resolve-ApkSigner $repo
  if (-not $apksigner) { Write-Host "未找到 apksigner，跳过签名" -ForegroundColor Yellow; return $false }
  & $apksigner sign --ks "$keystore" --ks-key-alias "$alias" --ks-pass ("pass:{0}" -f $spass) --key-pass ("pass:{0}" -f $kpass) "$apkPath"
  if ($LASTEXITCODE -ne 0) { throw "签名失败" }
  & $apksigner verify --print-certs "$apkPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "签名校验失败" }
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

Build-Release $Repo
$apk = Find-ReleaseApk $Repo
if (-not $apk) { throw "未找到 release APK" }
Write-Host ("APK: {0}" -f $apk.FullName) -ForegroundColor Green

$signed = $false
try { $signed = Sign-Apk $apk.FullName $Keystore $KeyAlias $KeyPass $StorePass $Repo } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
$arch  = Archive-APK $Repo $apk $signed
if ($arch) { Write-Host ("已归档：{0}" -f $arch.FullName) -ForegroundColor Green }
