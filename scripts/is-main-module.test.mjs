#!/usr/bin/env node

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainModule } from './is-main-module.mjs';

const entrypoint = resolve('scripts/is-main-module.mjs');
const entrypointUrl = pathToFileURL(entrypoint).href;

assert.equal(isMainModule(entrypointUrl, entrypoint), true);
assert.equal(isMainModule(entrypointUrl, undefined), false);
assert.equal(isMainModule(pathToFileURL(resolve('scripts/other.mjs')).href, entrypoint), false);

console.log('portable CLI entrypoint tests passed');
