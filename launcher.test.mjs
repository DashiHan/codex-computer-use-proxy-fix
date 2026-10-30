import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildLaunch } from './launcher.mjs';

test('forwards the existing proxy while preserving the newest official runtime and access controls', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cua-proxy-test-'));
  try {
    for (const [version, command, time] of [['old', 'old-node', 1000], ['new', 'current-node', 2000]]) {
      await mkdir(path.join(root, version));
      const file = path.join(root, version, '.mcp.json');
      await writeFile(file, JSON.stringify({mcpServers:{cua_repl:{command,args:['--import','official-access-check.mjs','official-server.mjs'],env:{NODE_REPL_TRUSTED_SERVICES:'official-services',CUA_REPL_ENABLED_SURFACES:'browser,computer'}}}}));
      await utimes(file, time, time);
    }
    const actual = await buildLaunch(root, {HTTPS_PROXY:'http://127.0.0.1:7890',NO_PROXY:'localhost,127.0.0.1,::1',BROWSER_USE_ACCESS_EXECUTOR_ID:'existing-executor'});
    assert.equal(actual.command, 'current-node');
    assert.deepEqual(actual.args, ['--import','official-access-check.mjs','official-server.mjs']);
    assert.equal(actual.env.HTTPS_PROXY, 'http://127.0.0.1:7890');
    assert.equal(actual.env.NO_PROXY, 'localhost,127.0.0.1,::1');
    assert.equal(actual.env.NODE_REPL_TRUSTED_SERVICES, 'official-services');
    assert.equal(actual.env.BROWSER_USE_ACCESS_EXECUTOR_ID, 'existing-executor');
  } finally {
    await rm(root, {recursive:true, force:true});
  }
});
