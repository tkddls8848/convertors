param([Parameter(Mandatory = $true)][string]$InputPath)

$ErrorActionPreference = 'Stop'
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
if ([IO.Path]::GetExtension($resolvedInput) -ne '.hwpx') { throw 'Specify an HWPX file.' }
$hwp = $null
try {
  $hwp = New-Object -ComObject HWPFrame.HwpObject
  $hwp.XHwpWindows.Item(0).Visible = $false
  $version = [string]$hwp.Version
  Write-Output "Hancom version: $version"
  # The installed Hwp80 automation hung while attempting HWPX SaveAs.
  # Do not retry that unsupported validation environment or auto-accept dialogs.
  $major = [int]($version.Split(',')[0].Trim())
  if ($major -le 8) { throw 'Validation blocked: Hangul 8 or earlier. Use a current Hangul installation with HWPX support.' }
  $null = $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
  if (-not $hwp.Open($resolvedInput, 'HWPX', '')) { throw 'Hancom could not open the HWPX file.' }
  Write-Output "Opened: $resolvedInput"
  Write-Output "Page count: $($hwp.PageCount)"
  Write-Output 'Open succeeded. Separately check repair warnings, clipping, blank pages and visual parity against the source.'
} finally {
  if ($null -ne $hwp) {
    try { $hwp.Clear(1) } catch {}
    try { $hwp.Quit() } catch {}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($hwp)
  }
}
