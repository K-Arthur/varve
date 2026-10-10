# Pack a staged MSIX layout with makeappx (Windows SDK) or winapp pack.
# Optional test-signing uses a local certificate whose CN matches the CI test
# identity. This script never uploads to GitHub Releases.
[CmdletBinding()]
param(
    [string] $LayoutDir = '',
    [string] $OutputMsix = '',
    [ValidateSet('unsigned', 'test-signed')][string] $SignMode = 'unsigned',
    [string] $BundleDir = '',
    [string] $OutputBundle = '',
    [switch] $BundleOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-SdkTool([string] $Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $roots = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "${env:ProgramFiles}\Windows Kits\10\bin"
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $hit = Get-ChildItem -Path $root -Recurse -Filter $Name -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

function Find-WinApp {
    $cmd = Get-Command winapp -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$winapp = Find-WinApp
$makeappx = Find-SdkTool 'makeappx.exe'

if (-not $BundleOnly) {
    if (-not $LayoutDir -or -not $OutputMsix) {
        throw 'LayoutDir and OutputMsix are required unless -BundleOnly is set'
    }
    if (-not (Test-Path (Join-Path $LayoutDir 'AppxManifest.xml'))) {
        throw "AppxManifest.xml missing from $LayoutDir"
    }

    $outDir = Split-Path -Parent $OutputMsix
    if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
    if (Test-Path $OutputMsix) { Remove-Item -Force $OutputMsix }

    if ($winapp) {
        & $winapp pack $LayoutDir --output $OutputMsix
    } elseif ($makeappx) {
        & $makeappx pack /d $LayoutDir /p $OutputMsix /o
    } else {
        throw 'Neither winapp nor makeappx.exe is available on this runner'
    }
    if (-not (Test-Path $OutputMsix)) { throw "MSIX was not produced: $OutputMsix" }
}

if (-not $BundleOnly) {
    if ($SignMode -eq 'test-signed') {
        $signtool = Find-SdkTool 'signtool.exe'
        if (-not $signtool) { throw 'signtool.exe is required for test-signed MSIX packages' }
        $cert = Get-ChildItem Cert:\CurrentUser\My |
            Where-Object { $_.Subject -eq 'CN=Varve CI Test' } |
            Select-Object -First 1
        if (-not $cert) {
            $cert = New-SelfSignedCertificate `
                -Type Custom `
                -Subject 'CN=Varve CI Test' `
                -KeyUsage DigitalSignature `
                -FriendlyName 'Varve MSIX CI' `
                -CertStoreLocation 'Cert:\CurrentUser\My' `
                -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
        }
        & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint $OutputMsix
        if ($LASTEXITCODE -ne 0) { throw 'test-signing the MSIX failed' }
    }

    $appcert = Find-SdkTool 'appcert.exe'
    if (-not $appcert) {
        $kit = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe"
        if (Test-Path $kit) { $appcert = $kit }
    }
    if ($appcert) {
        $report = Join-Path (Split-Path -Parent $OutputMsix) 'wack-report.xml'
        & $appcert reset
        & $appcert test -apptype desktop -packagepath $OutputMsix -reportoutfile $report
        Write-Host "WACK report: $report"
    } else {
        Write-Host 'Windows App Certification Kit is not installed on this runner; validation skipped.'
    }
}

if ($BundleDir -and $OutputBundle) {
    New-Item -ItemType Directory -Force -Path $BundleDir | Out-Null
    if (-not $BundleOnly -and $OutputMsix -and (Test-Path $OutputMsix)) {
        Copy-Item -Force $OutputMsix (Join-Path $BundleDir (Split-Path -Leaf $OutputMsix))
    }
    if (-not $makeappx) { throw 'makeappx.exe is required to create an msixbundle' }
    $bundleParent = Split-Path -Parent $OutputBundle
    if ($bundleParent) { New-Item -ItemType Directory -Force -Path $bundleParent | Out-Null }
    & $makeappx bundle /d $BundleDir /p $OutputBundle /o
}
