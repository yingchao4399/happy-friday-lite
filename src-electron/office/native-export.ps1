param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [ValidateSet('docs','sheets','slides')][string]$Kind,
  [string]$Format,
  [string]$OwnershipPath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$officeApp = $null
$document = $null
$result = @{ ok = $false; code = 'OFFICE_NATIVE_EXPORT_FAILED' }
$owned = @()
function Record-OwnedProcess([int]$ProcessId) {
  if (!$OwnershipPath) { return }
  $entry = Get-Process -Id $ProcessId
  $script:owned += @{ id = $entry.Id; name = $entry.ProcessName; started = $entry.StartTime.ToUniversalTime().Ticks.ToString() }
  $pendingPath = $OwnershipPath + '.tmp'
  $script:owned | ConvertTo-Json -Compress | Set-Content -LiteralPath $pendingPath -Encoding UTF8
  Move-Item -LiteralPath $pendingPath -Destination $OwnershipPath -Force
}
function Assert-NotCancelled {
  if ($OwnershipPath -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $OwnershipPath) 'cancel.requested'))) { throw 'OFFICE_EXPORT_CANCELLED' }
}
try {
  Record-OwnedProcess $PID
  Assert-NotCancelled
  $progId = @{ docs = 'Word.Application'; sheets = 'Excel.Application'; slides = 'PowerPoint.Application' }[$Kind]
  if ($null -eq [type]::GetTypeFromProgID($progId)) {
    $result.code = 'OFFICE_NATIVE_EXPORT_UNAVAILABLE'
  } else {
    $processName = @{ docs = 'WINWORD'; sheets = 'EXCEL'; slides = 'POWERPNT' }[$Kind]
    if (Get-Process -Name $processName -ErrorAction SilentlyContinue) { throw 'OFFICE_NATIVE_EXPORT_BUSY' }
    # 新建独立 COM 实例，只打开临时快照，不访问用户正在编辑的 Office 文档。
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FridayOfficeWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId); }'
    Write-Output (@{ stage = 'native-starting' } | ConvertTo-Json -Compress)
    Assert-NotCancelled
    $officeApp = New-Object -ComObject $progId
    $applicationPid = [uint32]0
    if ($Kind -ne 'docs') {
      [void][FridayOfficeWindow]::GetWindowThreadProcessId([IntPtr]$officeApp.Hwnd, [ref]$applicationPid)
      if ($applicationPid -eq 0) { throw 'OFFICE_NATIVE_EXPORT_INSTANCE_INVALID' }
      Record-OwnedProcess $applicationPid
      Write-Output (@{ stage = 'native-ready' } | ConvertTo-Json -Compress)
      Assert-NotCancelled
    }
    if ($Kind -eq 'docs') {
      $officeApp.Visible = $false
      $officeApp.DisplayAlerts = 0
      $officeApp.AutomationSecurity = 3
      # Word 的 HWND 属于 Window 而非 Application；先建立自己的空白窗口登记所有权。
      $document = $officeApp.Documents.Add()
      $ownedWindow = $document.ActiveWindow
      [void][FridayOfficeWindow]::GetWindowThreadProcessId([IntPtr]$ownedWindow.Hwnd, [ref]$applicationPid)
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ownedWindow)
      if ($applicationPid -eq 0) { throw 'OFFICE_NATIVE_EXPORT_INSTANCE_INVALID' }
      Record-OwnedProcess $applicationPid
      Write-Output (@{ stage = 'native-ready' } | ConvertTo-Json -Compress)
      Assert-NotCancelled
      $document.Close(0)
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
      $document = $null
      $document = $officeApp.Documents.Open($InputPath, $false, $true, $false)
      Write-Output (@{ stage = 'native-converting' } | ConvertTo-Json -Compress)
      Assert-NotCancelled
      if ($Format -eq 'doc') { $document.SaveAs2($OutputPath, 0) }
      elseif ($Format -eq 'xps') { $document.ExportAsFixedFormat($OutputPath, 18) }
      else { throw 'OFFICE_EXPORT_FORMAT_UNSUPPORTED' }
    } elseif ($Kind -eq 'sheets') {
      $officeApp.Visible = $false
      $officeApp.DisplayAlerts = $false
      $officeApp.AutomationSecurity = 3
      $document = $officeApp.Workbooks.Open($InputPath, 0, $true)
      Write-Output (@{ stage = 'native-converting' } | ConvertTo-Json -Compress)
      Assert-NotCancelled
      if ($Format -eq 'pdf') { $document.ExportAsFixedFormat(0, $OutputPath) }
      elseif ($Format -eq 'xps') { $document.ExportAsFixedFormat(1, $OutputPath) }
      else { throw 'OFFICE_EXPORT_FORMAT_UNSUPPORTED' }
    } else {
      $officeApp.AutomationSecurity = 3
      $document = $officeApp.Presentations.Open($InputPath, $true, $false, $false)
      Write-Output (@{ stage = 'native-converting' } | ConvertTo-Json -Compress)
      Assert-NotCancelled
      if ($Format -eq 'pdf') { $document.SaveAs($OutputPath, 32) }
      elseif ($Format -eq 'xps') { $document.SaveAs($OutputPath, 33) }
      elseif ($Format -eq 'gif') { $document.SaveAs($OutputPath, 40) }
      elseif ($Format -in @('ppt','potx','pot','ppsx','pps','odp')) {
        $fileType = @{ ppt = 1; potx = 26; pot = 5; ppsx = 28; pps = 7; odp = 35 }[$Format]
        $document.SaveAs($OutputPath, $fileType)
      }
      elseif ($Format -eq 'mp4') {
        $document.CreateVideo($OutputPath, $true, 5, 720, 24, 85)
        $videoDeadline = [DateTime]::UtcNow.AddMinutes(8)
        do {
          Assert-NotCancelled
          Start-Sleep -Milliseconds 200
          if ([DateTime]::UtcNow -gt $videoDeadline) { throw 'OFFICE_EXPORT_TIMEOUT' }
        } while ($document.CreateVideoStatus -in @(1,2))
        if ($document.CreateVideoStatus -ne 3) { throw 'OFFICE_EXPORT_VIDEO_FAILED' }
      } else { throw 'OFFICE_EXPORT_FORMAT_UNSUPPORTED' }
    }
    if (!(Test-Path -LiteralPath $OutputPath -PathType Leaf)) { throw 'OFFICE_EXPORT_EMPTY' }
    $result = @{ ok = $true }
  }
} catch {
  # 只返回能力错误及系统原因，不输出正文、快照或配置。
  $nativeMessage = $_.Exception.Message
  $nativeCode = if ($nativeMessage -match '^OFFICE_[A-Z_]+$') { $nativeMessage } else { 'OFFICE_NATIVE_EXPORT_FAILED' }
  $result = @{ ok = $false; code = $nativeCode; detail = $nativeMessage }
} finally {
  if ($null -ne $document) {
    try { if ($Kind -eq 'docs') { $document.Close(0) } else { $document.Close() } } catch {}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
  }
  if ($null -ne $officeApp) {
    try { $officeApp.Quit() } catch {}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($officeApp)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  # 保留登记给父进程最终复核；即使 Quit 失败也能清理本次实例。
}
$result | ConvertTo-Json -Compress
