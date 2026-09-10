<#
  Verify a Windows artifact's Authenticode signature cryptographically.

  This inspects the ACTUAL BYTES of the artifact that will be uploaded - it is
  not a build-log check. It runs:

    1. Get-AuthenticodeSignature  (status, signer, timestamp)
    2. signtool verify /pa /v     (chain validation against the Public
                                   Application trust store)

  Output: a machine-readable JSON report consumed by the release pipeline:

      {
        "platform": "windows",
        "signed": true,
        "verification": "valid" | "invalid" | "not-signed" | "error",
        "publisher": "CN=...",
        "timestamped": true,
        "digestAlgorithm": "sha256",
        "files": [ { "filename": "...", "status": "Valid" } ],
        "checkedAt": "..."
      }

  Exit codes:
    0 - verification passed (signed+valid, or honestly unsigned when
        -ExpectSigned is false)
    1 - the signature is INVALID (present but failing)
    2 - signing was expected (-ExpectSigned) but the file is unsigned
    3 - the verification tooling itself failed

  The distinction between "unsigned" and "invalid" is intentional and
  load-bearing: an invalid signature on a release is a tamper alarm; an
  unsigned file is merely a policy question.

  Usage:
    powershell -File scripts/release/verify-windows-signature.ps1 `
      -Path .\Varve-0.1.0-windows-x86_64.exe `
      [-ExpectSigned] [-ReportPath report.json] [-Installed]
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$ExpectSigned,
  [string]$ReportPath = '',
  [switch]$Installed
)

$ErrorActionPreference = 'Stop'

function Write-Report {
  param([hashtable]$Data, [int]$ExitCode)
  if ($ReportPath) {
    $Data | ConvertTo-Json -Depth 6 | Set-Content -Path $ReportPath -Encoding utf8
  } else {
    $Data | ConvertTo-Json -Depth 6
  }
  exit $ExitCode
}

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Host "::error::File not found: $Path"
  Write-Report @{ platform = 'windows'; signed = $false; verification = 'error'; error = 'file not found' } 3
}

$report = @{
  platform    = 'windows'
  artifact    = Split-Path -Leaf $Path
  signed      = $false
  verification = 'not-signed'
  publisher   = $null
  timestamped = $false
  digestAlgorithm = $null
  checkedAt   = (Get-Date).ToUniversalTime().ToString('o')
  files       = @()
}

# ── 1. Get-AuthenticodeSignature - the authoritative status ─────────────────
$sig = Get-AuthenticodeSignature -LiteralPath $Path
$report.files = @(@{ filename = (Split-Path -Leaf $Path); status = $sig.Status.ToString() })

if ($sig.Status -eq [System.Management.Automation.SignatureStatus]::Valid) {
  $report.signed = $true
  $report.verification = 'valid'
  $report.publisher = $sig.SignerCertificate.Subject
  $report.timestamped = ($null -ne $sig.TimeStamperCertificate)
  if ($sig.SignerCertificate.SignatureAlgorithm) {
    $report.digestAlgorithm = $sig.SignerCertificate.SignatureAlgorithm.FriendlyName.ToLowerInvariant()
  }
  Write-Host "Authenticode: Valid"
  Write-Host "  Signer:      $($sig.SignerCertificate.Subject)"
  Write-Host "  Timestamped: $($report.timestamped)"
} elseif ($sig.Status -eq [System.Management.Automation.SignatureStatus]::NotSigned) {
  Write-Host "Authenticode: NOT SIGNED (status NotSigned)"
  $report.verification = 'not-signed'
} else {
  Write-Host "Authenticode: FAILED - $($sig.Status)"
  $report.verification = 'invalid'
}

# ── 2. signtool verify - chain validation against the PA trust store ────────
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' `
  -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) {
  $signtool = Get-Command signtool -ErrorAction SilentlyContinue
}
if (-not $signtool) {
  Write-Host "::error::signtool not found (install Windows SDK 10.0.26100.0+)"
  Write-Report $report 3
}
# A FileInfo (found on disk) uses FullName; a CommandInfo (found on PATH) uses Source.
$signtoolPath = if ($signtool.PSObject.Properties.Name -contains 'FullName') {
  $signtool.FullName
} else {
  $signtool.Source
}

# signtool writes "No signature found" to stderr for an unsigned file; under
# the runner's $ErrorActionPreference='Stop' that native stderr becomes a
# terminating error in Windows PowerShell 5.1. The exit code is the signal -
# suppress the error records and branch on $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$verifyOut = & $signtoolPath verify /pa /v $Path 2>&1
$verifyExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($verifyExit -eq 0 -and $report.verification -eq 'valid') {
  Write-Host "signtool verify /pa: PASSED"
} elseif ($verifyExit -ne 0) {
  Write-Host "signtool verify /pa: FAILED (exit $verifyExit)"
  if ($report.verification -eq 'not-signed') {
    $report.verification = 'not-signed'
  } else {
    $report.verification = 'invalid'
  }
  $verifyOut | ForEach-Object { Write-Host "  $_" }
}

# ── 3. Decide exit code ─────────────────────────────────────────────────────
if ($report.verification -eq 'invalid') {
  Write-Host "::error::Signature PRESENT but INVALID for $Path - tampered artifact, refusing."
  Write-Report $report 1
}
if ($report.verification -eq 'not-signed') {
  if ($ExpectSigned) {
    Write-Host "::error::Signing was expected but $Path is unsigned."
    Write-Report $report 2
  }
  Write-Host '::notice::Artifact is unsigned (allowed when signing is not expected).'
  Write-Report $report 0
}

if ($report.signed) {
  if ($Installed) {
    Write-Host 'Installed executable signature: signed (verified above).'
  } else {
    Write-Host "Installer signature VERIFIED: $($report.publisher)"
  }
}
Write-Report $report 0
