/** Set once in the coordinator; workers inherit this identity after a failure restart. */
export function resolveRunOutput(environment, { prefix = 'run', pid = process.pid, port } = {}) {
  const output = environment.VARVE_E2E_OUTPUT_DIR ?? `${prefix}-${pid}-${port}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(output) || output.includes('..'))
    throw new Error('VARVE_E2E_OUTPUT_DIR must be a safe, single directory name.');
  environment.VARVE_E2E_OUTPUT_DIR = output;
  return output;
}

export function validatedE2ePort(value = '1420') {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535)
    throw new Error('VARVE_E2E_PORT must be an integer from 1 to 65535.');
  return String(value);
}
