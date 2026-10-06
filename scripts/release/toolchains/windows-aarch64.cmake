# diffusion-rs-sys 0.1.20 selects cl.exe for all MSVC targets. Its bundled
# ggml ARM backend requires Clang; force the supported compiler before project().
if(NOT DEFINED ENV{VARVE_WINDOWS_ARM64_CLANG})
    message(FATAL_ERROR "VARVE_WINDOWS_ARM64_CLANG must name the verified clang-cl executable")
endif()
file(TO_CMAKE_PATH "$ENV{VARVE_WINDOWS_ARM64_CLANG}" VARVE_ARM64_COMPILER)
if(NOT EXISTS "${VARVE_ARM64_COMPILER}")
    message(FATAL_ERROR "Verified Windows ARM64 Clang executable is missing")
endif()
set(CMAKE_C_COMPILER "${VARVE_ARM64_COMPILER}" CACHE FILEPATH "Windows ARM64 C compiler" FORCE)
set(CMAKE_CXX_COMPILER "${VARVE_ARM64_COMPILER}" CACHE FILEPATH "Windows ARM64 C++ compiler" FORCE)
set(CMAKE_ASM_COMPILER "${VARVE_ARM64_COMPILER}" CACHE FILEPATH "Windows ARM64 ASM compiler" FORCE)
set(CMAKE_C_COMPILER_TARGET "aarch64-pc-windows-msvc" CACHE STRING "Native release target" FORCE)
set(CMAKE_CXX_COMPILER_TARGET "aarch64-pc-windows-msvc" CACHE STRING "Native release target" FORCE)
# Remove the upstream single-quoted cl.exe flag while retaining large-object support.
set(CMAKE_CXX_FLAGS "/bigobj" CACHE STRING "Clang MSVC-compatible flags" FORCE)
# A distributable binary must not require the build runner's optional ARM features.
set(GGML_NATIVE OFF CACHE BOOL "Portable CPU instruction baseline" FORCE)
set(GGML_CPU_ARM_ARCH "armv8-a" CACHE STRING "Windows ARM64 CPU baseline" FORCE)
