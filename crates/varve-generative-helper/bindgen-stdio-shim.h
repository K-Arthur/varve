/*
 * diffusion-rs-sys includes ggml.h, which includes <stdio.h> only for FILE
 * pointer declarations. Clang 22 and bindgen 0.71 otherwise disagree about
 * the layout of glibc's private _IO_FILE type and generate an impossible
 * compile-time assertion. Keep the type opaque for binding generation; the
 * native C++ build does not consume this header.
 */
#ifndef VARVE_BINDGEN_STDIO_SHIM_H
#define VARVE_BINDGEN_STDIO_SHIM_H

#ifndef _STDIO_H
#define _STDIO_H 1
#endif

struct _IO_FILE;
typedef struct _IO_FILE FILE;
typedef struct _IO_FILE __FILE;

#endif
