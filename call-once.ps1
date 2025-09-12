param(
  [int]$Port = $(if ($env:NDJC_API_PORT) { [int]$env:NDJC_API_PORT } else { 4311 }),
  [ValidateSet('simple','core','form')]
  [string]$Template = 'core'
)

$ts = Get-Date -Format 'yyyyMMddHHmmss'
$body = @{
  template       = $Template
  appName        = "NDJC $Template"
  packageId      = "com.ndjc.demo.$Template$ts"
  homeTitle      = "Hello $Template"
  mainButtonText = "Start $Template"
} | ConvertTo-Json -Depth 5

$url = "http://127.0.0.1:$Port/api/generate-apk"
Write-Host "POST $url ($Template)" -ForegroundColor Cyan
$res = Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/json"
$res | Format-List
