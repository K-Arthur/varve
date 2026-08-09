# One-shot diagnostic for STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) on the
# Windows desktop test harness. Compares the failing exe's imports against the
# runner's actual DLL exports to name the missing entry point.
param()

$ErrorActionPreference = 'Continue'

$exe = Get-ChildItem 'apps/desktop/src-tauri/target/debug/deps/varve_desktop_lib-*.exe' -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $exe) {
  Write-Host 'exe not found'
  exit 0
}
Write-Host "exe: $($exe.FullName) size=$($exe.Length)"

$dumpbin = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
  -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\dumpbin.exe' 2>$null | Select-Object -First 1
if (-not $dumpbin) {
  Write-Host 'dumpbin not found'
  exit 0
}
Write-Host "dumpbin: $dumpbin"

$imports = & $dumpbin /imports $exe.FullName 2>&1

# Group imported symbols under their DLL header.
$byDll = [ordered]@{}
$current = ''
foreach ($line in $imports) {
  $line = $line.Trim()
  if ($line -match '(?i)^[A-Za-z0-9_\-]+\.dll$') {
    $current = $line.ToLower()
    if (-not $byDll.Contains($current)) { $byDll[$current] = @() }
    continue
  }
  # dumpbin symbol lines look like "           0 __CxxFrameHandler4"
  if ($current -and $line -match '^\d+\s+([A-Za-z_@?][A-Za-z0-9_@?]*)$') {
    $byDll[$current] += $Matches[1]
  }
}

# api-ms-win-crt-* api-sets are backed by ucrtbase.dll on disk.
$backing = @{
  'vcruntime140.dll' = 'vcruntime140.dll'
  'vcruntime140d.dll' = 'vcruntime140d.dll'
  'msvcp140.dll' = 'msvcp140.dll'
  'ucrtbase.dll' = 'ucrtbase.dll'
  'kernelbase.dll' = 'kernelbase.dll'
  'kernel32.dll' = 'kernel32.dll'
  'user32.dll' = 'user32.dll'
  'ole32.dll' = 'ole32.dll'
  'shell32.dll' = 'shell32.dll'
  'advapi32.dll' = 'advapi32.dll'
  'gdi32.dll' = 'gdi32.dll'
  'comctl32.dll' = 'comctl32.dll'
  'oleaut32.dll' = 'oleaut32.dll'
  'userenv.dll' = 'userenv.dll'
  'bcryptprimitives.dll' = 'bcryptprimitives.dll'
  'dwmapi.dll' = 'dwmapi.dll'
  'ntdll.dll' = 'ntdll.dll'
}
foreach ($key in @($byDll.Keys)) {
  if ($key -like 'api-ms-win-crt-*') { $backing[$key] = 'ucrtbase.dll' }
}
foreach ($d in @($byDll.Keys)) {
  if (-not $backing.Contains($d)) { continue }
  $sys = Join-Path $env:WINDIR 'System32' $backing[$d]
  if (-not (Test-Path $sys)) {
    Write-Host "MISSING DLL ON RUNNER: $sys"
    continue
  }
  $exports = @()
  foreach ($l in (& $dumpbin /exports $sys 2>&1)) {
    if ($l -match '^\s+[0-9A-F]+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)') {
      $exports += $Matches[1].ToLower()
    }
  }
  foreach ($sym in $byDll[$d]) {
    if ($exports -notcontains $sym.ToLower()) {
      Write-Host "MISSING ENTRY POINT: $d ! $sym"
    }
  }
  Write-Host "$d : $($byDll[$d].Count) imported, $($exports.Count) exported (via $($backing[$d]))"
}
