import { pathToFileURL } from 'node:url';

/** Match Node's native entrypoint path without assuming POSIX separators. */
export function isMainModule(moduleUrl, argvPath = process.argv[1]) {
  return argvPath !== undefined && moduleUrl === pathToFileURL(argvPath).href;
}
