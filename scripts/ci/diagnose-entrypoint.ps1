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
  if ($line -match '^[A-Za-z0-9_\-]+\.dll$') {
    $current = $line.ToLower()
    if (-not $byDll.Contains($current)) { $byDll[$current] = @() }
    continue
  }
  if ($current -and $line -match '^[A-Za-z_@?][A-Za-z0-9_@?]*$') {
    $byDll[$current] += $line
  }
}

$realDlls = @('vcruntime140.dll', 'vcruntime140d.dll', 'msvcp140.dll', 'ucrtbase.dll', 'kernelbase.dll')
foreach ($d in $realDlls) {
  if (-not $byDll.Contains($d)) { continue }
  $sys = Join-Path $env:WINDIR 'System32' $d
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
  Write-Host "$d : $($byDll[$d].Count) imported, $($exports.Count) exported"
}
