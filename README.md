# Codex Computer Use proxy fix (Windows)

[中文说明](README.zh-CN.md)

A small, dependency-free launcher for a specific Codex Desktop browser-control problem: the desktop app and browser work through a local proxy, but the Computer Use MCP process does not inherit that proxy. Page reads then repeatedly stall for approximately 21 seconds and compound operations hit the tool timeout.

This is a community workaround, not an official OpenAI product. It is intended for people who **already use a working local proxy**. It does not provide a proxy or resolve every browser-control failure.

## Evidence from the reproduced case

Tested on Windows, Codex Desktop `26.1027.3384.0` (runtime `26.1027.30824`), Edge `151.0.4129.72`, ChatGPT extension `1.26.1021.11019`, and bundled Node `24.22.1`.

- The extension was installed, enabled, and able to list tabs. Official native-host diagnostics passed.
- Creating a tab took 145 ms; navigating took 358 ms.
- DOM snapshots, trivial DOM evaluations, and screenshots each repeatedly took about 21,390 ms, even in consecutive calls.
- The Computer Use process attempted direct connections to `ab.chatgpt.com:443` that remained in `SYN_SENT`. A direct HTTPS probe timed out; using the existing local proxy established HTTPS in about one second. A plain endpoint probe returning HTTP 403 proved transport connectivity only, not successful feature initialization.
- Reopening the browser, restarting the desktop app, and reinstalling the extension did not resolve the delay.

After explicitly passing the existing proxy to a separate official Computer Use process:

| Verified operation | Elapsed time |
| --- | ---: |
| Create a tab, navigate, and read accessibility content | 1,240 ms |
| Click a link, navigate, and read the destination | 1,941 ms |
| Capture a browser screenshot | 61 ms |
| Read the page title and visible heading through the DOM | 39 ms |

These are measurements from one reproduced case, not performance guarantees. The missing proxy was a confirmed contributor to this case; `Debugger unattached` or a timeout alone does not establish the same cause on another machine.

## What the launcher does

`launcher.mjs` reads the newest enabled app-generated configuration under:

```text
<CODEX_HOME>/plugins/cache/openai-bundled/unified-computer-use/<version>/.mcp.json
```

`CODEX_HOME` defaults to your user's `.codex` directory. The launcher runs that configuration's **original command and arguments**, preserves its runtime environment, and forwards explicitly supplied `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` values. The official access bootstrap, trusted services, and permission checks remain in place. It does not modify extension files, native-host registration, the signed desktop app, browser permissions, or security checks.

The custom MCP name is `cua_repl_proxy`. In the tested desktop version, startup provisioning deletes an override named `cua_repl` and regenerates the built-in entry, so using that reserved name did not survive restart.

## Install

Prerequisites: Codex Desktop with its Computer Use/browser components already installed, a connected browser extension, and an existing working local HTTP proxy. This workaround follows the tested Windows installation layout. It has not been validated on other operating systems or future desktop layouts.

1. Download this repository or clone it, then open PowerShell in its directory.
2. Run the following to copy the launcher and print a configuration block. It only copies this launcher; **it does not overwrite your configuration**.

```powershell
$codexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$pluginRoot = Join-Path $codexRoot 'plugins\cache\openai-bundled\unified-computer-use'
$generated = Get-ChildItem -LiteralPath $pluginRoot -Directory |
    ForEach-Object { Get-Item -LiteralPath (Join-Path $_.FullName '.mcp.json') -ErrorAction SilentlyContinue } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $generated) { throw 'Open Codex Desktop with Computer Use enabled first.' }
$official = (Get-Content -LiteralPath $generated.FullName -Raw | ConvertFrom-Json).mcpServers.cua_repl
if (-not $official.command -or -not (Test-Path -LiteralPath $official.command)) { throw 'Official runtime command was not found.' }
$targetDir = Join-Path $codexRoot 'tools\computer-use-proxy'
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$launcherPath = Join-Path $targetDir 'launcher.mjs'
Copy-Item -LiteralPath '.\launcher.mjs' -Destination $launcherPath
$nodeToml = ConvertTo-Json -InputObject ([string]$official.command) -Compress
$launcherToml = ConvertTo-Json -InputObject ([string]$launcherPath) -Compress
@"
[mcp_servers.cua_repl_proxy]
command = $nodeToml
args = [$launcherToml]
enabled = true
startup_timeout_sec = 120
enabled_tools = ["js", "js_reset", "turn_ended"]
omit_tools_from = ["code_mode"]
env_vars = ["BROWSER_USE_ACCESS_EXECUTOR_ID", "BROWSER_USE_ACCESS_PIPE_PATH", "BROWSER_USE_ACCESS_VERIFYING_IDENTITY", "CODEX_WINDOWS_REGISTERED_CORE"]

[mcp_servers.cua_repl_proxy.tools.js]
output_token_limit = 25000

[mcp_servers.cua_repl_proxy.env]
HTTP_PROXY = "http://127.0.0.1:7890"
HTTPS_PROXY = "http://127.0.0.1:7890"
NO_PROXY = "localhost,127.0.0.1,::1"
"@
```

3. Back up `<CODEX_HOME>/config.toml`. Append the printed block to that file. If a `cua_repl_proxy` section already exists, update it instead of adding duplicate TOML tables. Replace port `7890` with your **actual HTTP proxy port**; do not assume every proxy uses this port. Keep loopback addresses in `NO_PROXY` so local services stay local. Avoid putting proxy credentials in shared files.
4. Fully exit and reopen Codex Desktop. The new tools should appear under `mcp__cua_repl_proxy`.
5. Tell the assistant to use `mcp__cua_repl_proxy.js` for browser/computer control and follow the tool's initialization documentation. Merely installing it does not force every chat to select it. The built-in `mcp__cua_repl` entry is left unchanged.

Optional: add this small preference to your global `<CODEX_HOME>/AGENTS.md`, preserving any existing instructions:

```markdown
On this computer, prefer mcp__cua_repl_proxy.js and its js_reset for Computer Use
and browser control. Follow the same official cua API initialization and access
checks. If unavailable, check the configured local proxy and tool loading first.
```

The outer `command` path printed above uses the currently installed bundled Node executable. If a future update removes that executable, regenerate that path. The inner official server configuration is discovered at each launch. A proxy port change also requires updating the configured values and restarting the server/app.

## Verify

- If the Codex CLI is available, use `codex mcp list --json` and inspect **only the `cua_repl_proxy` entry**: it should point to `launcher.mjs` and contain your proxy settings. Do not publish a full MCP configuration dump; other servers may contain secrets.
- With Node available, `node launcher.mjs --check` resolves the original runtime without starting it. It reports whether a proxy was supplied to **that invocation**. The proxy configured for an MCP server is not automatically present in an unrelated terminal.
- Through the proxy tool, test creating a page, reading it, clicking a normal link, and taking a screenshot. Compare individual operation times. Do not declare success based only on listing tabs or a successful `--check`.
- Each JavaScript session must start with exactly one documented entry call, such as `await cua.getState()`. Do not reuse browser/tab handles or element indexes from another chat.

## Tests

Uses Node's built-in test runner and no third-party packages:

```text
node --test launcher.test.mjs
```

The regression test verifies proxy forwarding, newest-configuration selection, preservation of the official bootstrap/arguments/trusted services, and propagation of the existing executor identity. It does not automate a real browser or make network requests.

## Remove / rollback

Remove `[mcp_servers.cua_repl_proxy]` and its child tables from your user `config.toml`, then restart Codex. Remove the optional AGENTS preference if added. The built-in server remains available. The copied launcher may be removed after its configuration is removed. Restore a whole config backup only if doing so will not discard later unrelated changes.

## References

- [Official MCP environment-variable configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Official global AGENTS.md instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

MIT licensed. Reports with desktop/extension versions and sanitized per-operation timings are welcome; do not attach credentials, full logs, private pages, or personal mailbox screenshots.
