$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$compiler = Join-Path $env:ProgramFiles 'LLVM/bin/clang-cl.exe'
if (-not (Test-Path $compiler)) { throw 'The Windows ARM64 runner must provide LLVM clang-cl' }
$toolchain = Join-Path $PSScriptRoot 'windows-aarch64.cmake'
$env:VARVE_WINDOWS_ARM64_CLANG = $compiler
$env:CMAKE_TOOLCHAIN_FILE = $toolchain
& $compiler --version
if ($LASTEXITCODE -ne 0) { throw 'Clang version probe failed' }

# CMake/Ninja needs the native ARM64 SDK libraries and linker on PATH. Discover
# the installed VS version instead of assuming a particular runner-image path.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $installation) { throw 'Native ARM64 Visual Studio tools are missing' }
$devcmd = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
$environment = & $env:ComSpec /d /s /c "`"$devcmd`" -no_logo -arch=arm64 -host_arch=arm64 >nul && set"
if ($LASTEXITCODE -ne 0) { throw 'Native ARM64 Visual Studio environment setup failed' }
foreach ($line in $environment) {
    if ($line -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
$msvcBin = Join-Path $env:VCToolsInstallDir 'bin/HostARM64/arm64'
$linker = Join-Path $msvcBin 'link.exe'
if (-not (Test-Path $linker)) { throw 'Native ARM64 Microsoft linker is missing' }
# Git Bash prepends its POSIX link.exe. Bind Cargo explicitly, including native
# build scripts/procedural macros, rather than relying on shell PATH precedence.
$env:CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER = $linker

$probe = Join-Path $env:RUNNER_TEMP 'varve-arm64-compiler-probe'
New-Item -ItemType Directory -Path $probe -Force | Out-Null
@'
cmake_minimum_required(VERSION 3.20)
project(varve_arm64_compiler_probe LANGUAGES C CXX)
if(NOT CMAKE_C_COMPILER_ID STREQUAL "Clang" OR NOT CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
  message(FATAL_ERROR "Windows ARM64 native dependency requires Clang")
endif()
add_executable(varve_arm64_compiler_probe probe.c main.cpp)
'@ | Set-Content (Join-Path $probe 'CMakeLists.txt')
@'
#include <arm_neon.h>
#if !defined(__aarch64__) && !defined(_M_ARM64)
#error Expected an ARM64 native compiler
#endif
int arm64_probe(void) { return vget_lane_s32(vdup_n_s32(0), 0); }
'@ | Set-Content (Join-Path $probe 'probe.c')
@'
#include <string>
extern "C" int arm64_probe(void);
static_assert(sizeof(void*) == 8, "ARM64 pointer width");
int main() { return std::string("ARM64").size() == 5 ? arm64_probe() : 1; }
'@ | Set-Content (Join-Path $probe 'main.cpp')
# Reproduce the dependency's conflicting defaults, including its quoted flag.
& cmake -S $probe -B "$probe/build" -G Ninja "-DCMAKE_TOOLCHAIN_FILE=$toolchain" '-DCMAKE_C_COMPILER=cl.exe' '-DCMAKE_CXX_COMPILER=cl.exe' "-DCMAKE_CXX_FLAGS='/bigobj'" -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { throw 'ARM64 Clang CMake configuration failed' }
& cmake --build "$probe/build" --config Release
if ($LASTEXITCODE -ne 0) { throw 'ARM64 Clang C/C++ SDK link probe failed' }
$executable = Join-Path $probe 'build/varve_arm64_compiler_probe.exe'
$bytes = [IO.File]::ReadAllBytes($executable)
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
if ([BitConverter]::ToUInt16($bytes, $peOffset + 4) -ne 0xaa64) { throw 'Compiler probe produced a non-ARM64 executable' }
& $executable
if ($LASTEXITCODE -ne 0) { throw 'Native ARM64 C/C++ executable failed' }

# The next Actions step runs this through the same Bash shell as Tauri/Cargo.
# Its build script also exercises Rust's host linker, not only the final binary.
New-Item -ItemType Directory -Path "$probe/rust/src" -Force | Out-Null
@'
[package]
name = "varve-arm64-linker-probe"
version = "0.0.0"
edition = "2024"
[workspace]
'@ | Set-Content "$probe/rust/Cargo.toml"
@'
version = 4
[[package]]
name = "varve-arm64-linker-probe"
version = "0.0.0"
'@ | Set-Content "$probe/rust/Cargo.lock"
'fn main() { println!("cargo:rerun-if-changed=build.rs"); }' | Set-Content "$probe/rust/build.rs"
@'
#[cfg(not(target_arch = "aarch64"))]
compile_error!("Expected native ARM64 Rust");
fn main() { assert_eq!(std::mem::size_of::<usize>(), 8); println!("Native ARM64 Rust host and target linker probe passed"); }
'@ | Set-Content "$probe/rust/src/main.rs"
"probe_dir=$probe" | Out-File $env:GITHUB_OUTPUT -Encoding utf8 -Append

# Persist only build inputs; do not overwrite Actions' reserved environment.
foreach ($name in @('VARVE_WINDOWS_ARM64_CLANG', 'CMAKE_TOOLCHAIN_FILE', 'CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER', 'INCLUDE', 'LIB', 'LIBPATH', 'VCINSTALLDIR', 'VCToolsInstallDir', 'WindowsSdkDir', 'WindowsSDKVersion')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { "$name=$value" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append }
}
# Export build-tool directories only. Exporting the entire PATH reverses its
# precedence through GITHUB_PATH and can put Git's POSIX tools ahead of MSVC.
@($msvcBin, (Split-Path $compiler)) | Out-File $env:GITHUB_PATH -Encoding utf8 -Append
'Native ARM64 Clang C/C++ compile, SDK link, PE architecture and execution probe passed.' | Out-File $env:GITHUB_STEP_SUMMARY -Encoding utf8 -Append
