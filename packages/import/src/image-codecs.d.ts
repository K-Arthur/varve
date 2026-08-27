declare module 'utif' {
  interface TiffImageFileDirectory {
    width: number;
    height: number;
  }

  const UTIF: {
    decode(data: ArrayBuffer): TiffImageFileDirectory[];
    decodeImage(data: ArrayBuffer, ifd: TiffImageFileDirectory): void;
    toRGBA8(ifd: TiffImageFileDirectory): Uint8Array;
  };

  export default UTIF;
}

declare module 'upng-js' {
  const UPNG: {
    encode(frames: ArrayBuffer[], width: number, height: number, colors: number): ArrayBuffer;
  };

  export default UPNG;
}
