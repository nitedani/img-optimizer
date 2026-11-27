import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('the types keep 0.0.4 callers unchanged and give load a nullable body', async () => {
  const tsc = new URL('../node_modules/.bin/tsc', import.meta.url).pathname;
  const types = new URL('./types.ts', import.meta.url).pathname;
  await promisify(execFile)(tsc, [
    '--noEmit',
    '--strict',
    '--module',
    'nodenext',
    '--moduleResolution',
    'nodenext',
    '--types',
    'node',
    types,
  ]);
});
