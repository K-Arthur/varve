# Run the unmodified installed app on the disposable elevated hosted runner.
# WebView2 150+ ignores WEBVIEW2_* environment overrides when elevated.
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$InputPath,
  [Parameter(Mandatory)][string]$Out,
  [Parameter(Mandatory)][string]$Profile,
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$Schema,
  [Parameter(Mandatory)][ValidateSet('x64', 'arm64')][string]$Arch,
  [switch]$Seed
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'App-scoped WebView2 policy is restricted to disposable GitHub-hosted runners'
}
if ([IO.Path]::GetFileName($Exe) -ne 'varve-desktop.exe' -or -not (Test-Path -LiteralPath $Exe)) {
  throw 'The actual installed Varve executable is required'
}
$policyRoot = 'Software\Policies\Microsoft\Edge\WebView2'
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
  [Microsoft.Win32.RegistryHive]::LocalMachine,
  [Microsoft.Win32.RegistryView]::Registry64
)
$name = 'varve-desktop.exe'
$changes = @()
try {
  $settings = @{
    AdditionalBrowserArguments = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=19227'
    UserDataFolder = [IO.Path]::GetFullPath((Join-Path $Profile 'WebView2'))
  }
  foreach ($setting in $settings.Keys) {
    $key = $base.CreateSubKey("$policyRoot\$setting")
    try {
      $exists = $key.GetValueNames() -contains $name
      $changes += [PSCustomObject]@{
        Setting = $setting
        Exists = $exists
        Value = $(if ($exists) { $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null })
        Kind = $(if ($exists) { $key.GetValueKind($name) } else { [Microsoft.Win32.RegistryValueKind]::String })
      }
      $key.SetValue($name, $settings[$setting], [Microsoft.Win32.RegistryValueKind]::String)
    } finally { $key.Dispose() }
  }
  $arguments = @(
    (Join-Path $PSScriptRoot 'windows-production.mjs'),
    '--exe', $Exe, '--input', $InputPath, '--out', $Out, '--profile', $Profile,
    '--version', $Version, '--schema', $Schema, '--arch', $Arch, '--port', '19227'
  )
  if ($Seed) { $arguments += '--seed' }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Installed Windows qualification failed ($LASTEXITCODE)" }
} finally {
  foreach ($change in $changes) {
    $key = $base.OpenSubKey("$policyRoot\$($change.Setting)", $true)
    try {
      if ($change.Exists) { $key.SetValue($name, $change.Value, $change.Kind) }
      else { $key.DeleteValue($name, $false) }
    } finally { if ($key) { $key.Dispose() } }
  }
  $base.Dispose()
}
