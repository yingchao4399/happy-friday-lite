param([Parameter(Mandatory=$true)][string]$OwnershipPath, [switch]$Cancel)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $OwnershipPath -PathType Leaf)) { exit 0 }
$owned = @(Get-Content -LiteralPath $OwnershipPath -Raw -Encoding UTF8 | ConvertFrom-Json)
$hasOffice = @($owned | Where-Object { $_.name -in @('WINWORD','EXCEL','POWERPNT') }).Count -gt 0
# 取消期间如果 COM 仍在启动，保留转换器让它登记 HWND 后自行响应取消；
# 不能在此窗口杀掉 PowerShell，随后却失去新 Office 实例的所有权。
foreach ($entry in ($owned | Sort-Object { if ($_.name -eq 'powershell') { 1 } else { 0 } })) {
  if ($entry.name -notin @('powershell','WINWORD','EXCEL','POWERPNT')) { continue }
  if ($Cancel -and !$hasOffice -and $entry.name -eq 'powershell') { continue }
  $candidate = Get-Process -Id ([int]$entry.id) -ErrorAction SilentlyContinue
  if ($null -eq $candidate) { continue }
  if ($candidate.ProcessName -ne $entry.name -or $candidate.StartTime.ToUniversalTime().Ticks.ToString() -ne $entry.started) { continue }
  # 仅停止该次转换登记且启动时间一致的实例。
  Stop-Process -Id $candidate.Id -Force
}
