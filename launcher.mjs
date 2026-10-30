import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Reuse the app-generated server definition so app updates retain their own
// runtime paths, access bootstrap, and trusted service configuration.
export async function buildLaunch(pluginCacheRoot, inheritedEnv) {
  const entries = await readdir(pluginCacheRoot, {withFileTypes:true});
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(pluginCacheRoot, entry.name, '.mcp.json');
    try {
      const info = await stat(file);
      const config = JSON.parse(await readFile(file, 'utf8')).mcpServers?.cua_repl;
      if (config?.enabled !== false && typeof config?.command === 'string' && Array.isArray(config.args)) {
        candidates.push({config, modified:info.mtimeMs});
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  candidates.sort((a,b)=>b.modified-a.modified);
  if (!candidates.length) throw new Error('No app-generated Computer Use server configuration was found.');
  const config = candidates[0].config;
  const env = {...inheritedEnv, ...config.env};
  for (const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY']) {
    if (inheritedEnv[key]) env[key] = inheritedEnv[key];
  }
  return {command:config.command, args:config.args, env};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'plugins','cache','openai-bundled','unified-computer-use');
  const launch = await buildLaunch(root, process.env);
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({command:launch.command,args:launch.args,proxyConfigured:Boolean(launch.env.HTTPS_PROXY),preservesAccessBootstrap:launch.args.includes('--import'),trustedServicesConfigured:Boolean(launch.env.NODE_REPL_TRUSTED_SERVICES)}));
  } else {
    const child = spawn(launch.command, launch.args, {env:launch.env,stdio:'inherit',windowsHide:true});
    child.on('error', error=>{console.error(error.message);process.exitCode=1;});
    child.on('exit', code=>{process.exitCode=code ?? 1;});
    for (const signal of ['SIGINT','SIGTERM']) process.on(signal, ()=>child.kill(signal));
  }
}
