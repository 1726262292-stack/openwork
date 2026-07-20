import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { connect, debuggerUrlFor, pickAppTarget } from "../runner/cdp.mjs";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const FLOW_ID = "debug-nuke-fresh-start";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

if (vo.length !== 5) {
  throw new Error(`Expected 5 voiceover frames for ${FLOW_ID}, found ${vo.length}.`);
}

const ENV_NAMES = [
  "OPENWORK_EVAL_WIN_SANDBOX_ID",
  "OPENWORK_EVAL_CDP_URL",
  "OPENWORK_EVAL_WIN_PROFILE",
];

const SANDBOX_ID = (process.env.OPENWORK_EVAL_WIN_SANDBOX_ID ?? "").trim();
const CDP_URL = cleanUrl(process.env.OPENWORK_EVAL_CDP_URL);
const WIN_PROFILE = cleanWinPath(process.env.OPENWORK_EVAL_WIN_PROFILE ?? "");
const RUN_TAG = `${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
const BRAND_APP_NAME = "Nuke Proof Work";
const BOOTSTRAP_BASE_URL = "https://openwork-poc.example.test";
const FAKE_AUTH_TOKEN = `eval-fake-token-${RUN_TAG}`;
const LOCKER_SCRIPT_NAME = `openwork-nuke-locker-${RUN_TAG}.ps1`;
const paths = buildWindowsPaths(WIN_PROFILE);

const state = {
  firstReceiptPath: "",
  lockPid: 0,
  lockVerified: false,
  secondReceiptPath: "",
  afterLockedNuke: null,
  unlockProbe: null,
  killResult: null,
  afterBootGuard: null,
};

function cleanUrl(value) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function cleanWinPath(value) {
  return String(value ?? "").trim().replace(/[\\/]+$/, "");
}

function winJoin(base, ...segments) {
  const head = cleanWinPath(base);
  return [head, ...segments.map((segment) => String(segment).replace(/^[\\/]+|[\\/]+$/g, ""))].filter(Boolean).join("\\");
}

function buildWindowsPaths(profile) {
  const appData = winJoin(profile, "AppData", "Roaming");
  const localAppData = winJoin(profile, "AppData", "Local");
  const configHome = winJoin(localAppData, "openwork");
  const appDataOpenwork = winJoin(appData, "openwork");
  const userData = winJoin(appData, "com.differentai.openwork");
  const opencode = winJoin(appData, "opencode");
  const orchestrator = winJoin(profile, ".openwork", "openwork-orchestrator");
  const localShareOpencode = winJoin(profile, ".local", "share", "opencode");
  const cacheOpencode = winJoin(profile, ".cache", "opencode");
  return {
    appData,
    localAppData,
    configHome,
    appDataOpenwork,
    userData,
    opencode,
    orchestrator,
    localShareOpencode,
    cacheOpencode,
    bootstrap: winJoin(configHome, "desktop-bootstrap.json"),
    pending: winJoin(configHome, ".nuke-pending.json"),
    localRuntimeSqlite: winJoin(configHome, "runtime.sqlite"),
    temp: winJoin(localAppData, "Temp"),
    windowsTemp: "C:\\Windows\\Temp",
  };
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function evidenceText(input) {
  if (typeof input === "string") return input.slice(0, 4000);
  return JSON.stringify(input, null, 2).slice(0, 4000);
}

function witness(ctx, condition, assertion, actual) {
  ctx.recordEvidence({
    type: "assertion",
    status: condition ? "passed" : "failed",
    assertion,
    actual: actual === undefined ? undefined : evidenceText(actual),
  });
  ctx.assert(condition, assertion + (actual === undefined ? "" : ` (actual: ${evidenceText(actual).slice(0, 500)})`));
}

function daytonaCmd(ctx, label, command, options = {}) {
  const result = spawnSync("daytona", ["exec", SANDBOX_ID, "--", "cmd", "/c", command], {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
  });
  const output = [
    `$ daytona exec ${SANDBOX_ID} -- cmd /c ${command}`,
    `exit=${result.status ?? "null"}`,
    result.error ? `error=${result.error.message}` : "",
    result.stdout ? `stdout:\n${result.stdout}` : "stdout:",
    result.stderr ? `stderr:\n${result.stderr}` : "stderr:",
  ].filter(Boolean).join("\n");
  ctx.output(label, output);
  if (result.error && options.allowFailure !== true) throw result.error;
  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(`Daytona command ${label} failed with exit ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function daytonaPowerShell(ctx, label, script, options = {}) {
  const encoded = encodePowerShell(script);
  const command = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  if (command.length > 7900) {
    throw new Error(`PowerShell payload for ${label} is too long for cmd /c (${command.length} chars). Split the command.`);
  }
  return daytonaCmd(ctx, label, command, options);
}

function parseJsonOutput(stdout, label) {
  const lines = String(stdout ?? "").trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning: Daytona shells may print status text before JSON.
    }
  }
  throw new Error(`Could not parse JSON output for ${label}: ${stdout}`);
}

function daytonaPowerShellJson(ctx, label, script, options = {}) {
  const result = daytonaPowerShell(ctx, label, script, options);
  return parseJsonOutput(result.stdout, label);
}

async function attachApp(ctx, timeoutMs = 90_000) {
  ctx.cdpBaseUrl = CDP_URL;
  try {
    ctx.client?.close();
  } catch {
    // The app may have relaunched between frames.
  }
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const target = await pickAppTarget(CDP_URL);
      const client = await connect(debuggerUrlFor(CDP_URL, target));
      await client.send("Page.enable").catch(() => undefined);
      ctx.client = client;
      ctx.log(`Attached to remote Windows Electron target: ${target.title || target.url}`);
      return target;
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms attaching to ${CDP_URL}: ${lastError?.message ?? "unknown error"}`);
}

async function waitForAppShell(ctx, label = "OpenWork renderer") {
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 60_000, label: `${label} document complete` });
  await ctx.waitFor("Boolean(window.__OPENWORK_ELECTRON__)", { timeoutMs: 60_000, label: `${label} Electron bridge` });
}

async function waitForRendererDisconnect(ctx, label, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await ctx.client.send("Runtime.evaluate", { expression: "1", returnByValue: true });
    } catch {
      ctx.log(`${label}: renderer CDP disconnected.`);
      return;
    }
    await sleep(500);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label} to disconnect the renderer.`);
}

async function waitForRelaunch(ctx, label) {
  await waitForRendererDisconnect(ctx, label);
  await ctx.reconnect({ timeoutMs: 120_000 });
  await waitForAppShell(ctx, `${label} relaunched app`);
}

async function enableRendererState(ctx, options = {}) {
  const includePreferences = options.includePreferences !== false;
  await ctx.eval(`(() => {
    localStorage.setItem('openwork.developerMode', '1');
    localStorage.setItem('openwork.den.authToken', ${JSON.stringify(FAKE_AUTH_TOKEN)});
    localStorage.setItem('openwork.den.activeOrgId', 'org_eval_debug_nuke');
    localStorage.setItem('openwork.den.activeOrgSlug', 'debug-nuke');
    localStorage.setItem('openwork.den.activeOrgName', 'Debug Nuke Eval');
    localStorage.setItem('openwork.react.settings.theme-mode', 'light');
    if (${includePreferences ? "true" : "false"}) {
      localStorage.setItem('openwork.preferences', JSON.stringify({ hasCompletedOnboarding: true, seededBy: ${JSON.stringify(FLOW_ID)}, runTag: ${JSON.stringify(RUN_TAG)} }));
    }
    return true;
  })()`);
  const marker = `debug-nuke-reload-${Date.now()}`;
  await ctx.eval(`(() => { window.__debugNukeReloadMarker = ${JSON.stringify(marker)}; location.reload(); return true; })()`);
  await ctx.waitFor(
    `window.__debugNukeReloadMarker !== ${JSON.stringify(marker)} && document.readyState === 'complete' && Boolean(window.__OPENWORK_ELECTRON__)`,
    { timeoutMs: 60_000, label: "renderer reload after eval storage seed" },
  );
}

async function navigateToSettings(ctx, tab) {
  await ctx.navigateHash(`/settings/${tab}`);
  await ctx.waitFor(`location.hash.includes(${JSON.stringify(`/settings/${tab}`)})`, {
    timeoutMs: 30_000,
    label: `${tab} settings hash`,
  });
}

async function clickButtonByText(ctx, text, timeoutMs = 30_000) {
  const clicked = await ctx.waitFor(`(() => {
    const wanted = ${JSON.stringify(text)};
    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    for (const el of buttons) {
      const label = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      if (label.includes(wanted) && !disabled) {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return label;
      }
    }
    return null;
  })()`, { timeoutMs, label: `enabled button ${JSON.stringify(text)}` });
  ctx.log(`Clicked button: ${clicked}`);
  return clicked;
}

async function openNukeDialog(ctx) {
  await navigateToSettings(ctx, "debug");
  await ctx.waitForText("Danger zone", { timeoutMs: 90_000 });
  await ctx.waitForText("Nuke & fresh start", { timeoutMs: 90_000 });
  await clickButtonByText(ctx, "Nuke & fresh start", 90_000);
  await ctx.waitForText("Nuke local state and start fresh?", { timeoutMs: 60_000 });
  await ctx.waitFor("Boolean(document.querySelector('input[placeholder=\"Type NUKE\"]'))", {
    timeoutMs: 20_000,
    label: "NUKE confirmation input",
  });
}

async function executeNukeFromDialog(ctx, label) {
  await ctx.fill('input[placeholder="Type NUKE"]', "NUKE");
  await clickButtonByText(ctx, "Nuke & relaunch", 20_000);
  await waitForRelaunch(ctx, label);
}

function bootstrapFixture() {
  return {
    baseUrl: BOOTSTRAP_BASE_URL,
    requireSignin: true,
    brandAppName: BRAND_APP_NAME,
    brandIconUrl: "https://openwork-poc.example.test/icon.png",
    handoff: {
      grant: "secret-grant",
      denBaseUrl: BOOTSTRAP_BASE_URL,
      orgId: "org_debug_nuke",
      orgName: "Debug Nuke Org",
      orgSlug: "debug-nuke-org",
      createdAt: "2026-07-20T00:00:00.000Z",
    },
    prepared: {
      orgId: "org_debug_nuke",
      orgName: "Debug Nuke Org",
      orgSlug: "debug-nuke-org",
      skillId: "skill_secret_prepared",
      skillTitle: "Secret Prepared Skill",
      skillsDir: "C:\\secret\\skills",
      skillPath: "C:\\secret\\skills\\prepared",
      preparedAt: "2026-07-20T00:01:00.000Z",
    },
    claimLinks: [
      {
        id: "claim_debug_nuke",
        role: "admin",
        token: "secret-token",
        url: `${BOOTSTRAP_BASE_URL}/claim/debug-nuke`,
        expiresAt: "2026-07-20T00:05:00.000Z",
      },
    ],
    writtenAt: "2026-07-20T00:00:00.000Z",
  };
}

function seedFilesScript() {
  return `
$profilePath=${psQuote(WIN_PROFILE)}
$appData=${psQuote(paths.appData)}
$localAppData=${psQuote(paths.localAppData)}
$userData=${psQuote(paths.userData)}
$opencode=${psQuote(paths.opencode)}
$appOpenwork=${psQuote(paths.appDataOpenwork)}
$configHome=${psQuote(paths.configHome)}
$orchestrator=${psQuote(paths.orchestrator)}
$localShareOpencode=${psQuote(paths.localShareOpencode)}
$cacheOpencode=${psQuote(paths.cacheOpencode)}
$dirs=@($userData,$opencode,$appOpenwork,$configHome,$orchestrator,$localShareOpencode,$cacheOpencode)
foreach($dir in $dirs){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }
Set-Content -Path (Join-Path $userData 'eval-userdata-marker.txt') -Value 'delete-me-userdata' -Encoding UTF8
Set-Content -Path (Join-Path $opencode 'auth.json') -Value '{"token":"dummy-opencode-auth"}' -Encoding UTF8
Set-Content -Path (Join-Path $opencode 'mcp-auth.json') -Value '{"mcp":"dummy-opencode-mcp-auth"}' -Encoding UTF8
[IO.File]::WriteAllBytes((Join-Path $opencode 'opencode.db'), [Text.Encoding]::UTF8.GetBytes('dummy opencode db ${RUN_TAG}'))
Set-Content -Path (Join-Path $appOpenwork 'server.json') -Value '{"server":"dummy"}' -Encoding UTF8
Set-Content -Path (Join-Path $appOpenwork 'env.json') -Value '{"APPDATA_ENV":"dummy"}' -Encoding UTF8
Set-Content -Path (Join-Path $appOpenwork 'tokens.json') -Value '{"APPDATA_TOKEN":"dummy"}' -Encoding UTF8
[IO.File]::WriteAllBytes((Join-Path $appOpenwork 'runtime.sqlite'), [Text.Encoding]::UTF8.GetBytes('dummy appdata runtime db ${RUN_TAG}'))
Set-Content -Path (Join-Path $configHome 'env.json') -Value '{"LOCAL_ENV":"dummy"}' -Encoding UTF8
Set-Content -Path (Join-Path $configHome 'tokens.json') -Value '{"LOCAL_TOKEN":"dummy"}' -Encoding UTF8
Set-Content -Path (Join-Path $configHome 'desktop-bootstrap.json') -Value ${psQuote(JSON.stringify(bootstrapFixture()))} -Encoding UTF8
Set-Content -Path (Join-Path $orchestrator 'openwork-orchestrator-auth.json') -Value '{"orchestrator":"dummy"}' -Encoding UTF8
Set-Content -Path (Join-Path $localShareOpencode 'data-marker.txt') -Value 'dummy local share opencode' -Encoding UTF8
Set-Content -Path (Join-Path $cacheOpencode 'cache-marker.txt') -Value 'dummy cache opencode' -Encoding UTF8
$result=[ordered]@{ profile=$profilePath; paths=[ordered]@{ userData=$userData; opencode=$opencode; appOpenwork=$appOpenwork; configHome=$configHome; bootstrap=(Join-Path $configHome 'desktop-bootstrap.json'); orchestrator=$orchestrator; localShareOpencode=$localShareOpencode; cacheOpencode=$cacheOpencode } }
Write-Output ($result | ConvertTo-Json -Depth 6 -Compress)
`;
}

function fixtureProbeScript() {
  return `
$paths=@{
  userData=${psQuote(paths.userData)}; opencode=${psQuote(paths.opencode)}; appOpenwork=${psQuote(paths.appDataOpenwork)}; configHome=${psQuote(paths.configHome)}; orchestrator=${psQuote(paths.orchestrator)}; localShareOpencode=${psQuote(paths.localShareOpencode)}; cacheOpencode=${psQuote(paths.cacheOpencode)}; bootstrap=${psQuote(paths.bootstrap)}
}
$checks=[ordered]@{}
foreach($name in $paths.Keys){ $checks[$name]=[ordered]@{ path=$paths[$name]; exists=(Test-Path -LiteralPath $paths[$name]) } }
$checks['opencode']['auth']=Test-Path -LiteralPath (Join-Path $paths.opencode 'auth.json')
$checks['opencode']['mcpAuth']=Test-Path -LiteralPath (Join-Path $paths.opencode 'mcp-auth.json')
$checks['opencode']['db']=Test-Path -LiteralPath (Join-Path $paths.opencode 'opencode.db')
$checks['configHome']['env']=Test-Path -LiteralPath (Join-Path $paths.configHome 'env.json')
$checks['configHome']['tokens']=Test-Path -LiteralPath (Join-Path $paths.configHome 'tokens.json')
$checks['orchestrator']['auth']=Test-Path -LiteralPath (Join-Path $paths.orchestrator 'openwork-orchestrator-auth.json')
Write-Output ($checks | ConvertTo-Json -Depth 6 -Compress)
`;
}

function postNukeProbeScript() {
  return `
function Names($p){ if(Test-Path -LiteralPath $p){ @(Get-ChildItem -LiteralPath $p -Force | ForEach-Object { $_.Name }) } else { @() } }
$userData=${psQuote(paths.userData)}
$opencode=${psQuote(paths.opencode)}
$appOpenwork=${psQuote(paths.appDataOpenwork)}
$configHome=${psQuote(paths.configHome)}
$bootstrap=${psQuote(paths.bootstrap)}
$pending=${psQuote(paths.pending)}
$tempCandidates=@(${psQuote(paths.temp)},${psQuote(paths.windowsTemp)}) | Select-Object -Unique
$receipts=@()
foreach($dir in $tempCandidates){ if(Test-Path -LiteralPath $dir){ $receipts += @(Get-ChildItem -LiteralPath $dir -Filter 'openwork-nuke-receipt-*.json' -File -ErrorAction SilentlyContinue) } }
$latest=$receipts | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$receiptRaw=''
$receipt=$null
if($latest){ $receiptRaw=Get-Content -Raw -LiteralPath $latest.FullName; try { $receipt=$receiptRaw | ConvertFrom-Json } catch {} }
$bootstrapRaw=''
$bootstrapParsed=$null
if(Test-Path -LiteralPath $bootstrap){ $bootstrapRaw=Get-Content -Raw -LiteralPath $bootstrap; try { $bootstrapParsed=$bootstrapRaw | ConvertFrom-Json } catch {} }
$appOpenworkSeeded=@('server.json','env.json','tokens.json','runtime.sqlite') | ForEach-Object { [ordered]@{ name=$_; exists=(Test-Path -LiteralPath (Join-Path $appOpenwork $_)) } }
$result=[ordered]@{
  userData=[ordered]@{ path=$userData; exists=(Test-Path -LiteralPath $userData); markerExists=(Test-Path -LiteralPath (Join-Path $userData 'eval-userdata-marker.txt')); entries=(Names $userData) }
  opencode=[ordered]@{ path=$opencode; exists=(Test-Path -LiteralPath $opencode); entries=(Names $opencode) }
  appOpenwork=[ordered]@{ path=$appOpenwork; exists=(Test-Path -LiteralPath $appOpenwork); seededFiles=$appOpenworkSeeded; entries=(Names $appOpenwork) }
  localOpenwork=[ordered]@{ path=$configHome; exists=(Test-Path -LiteralPath $configHome); entries=(Names $configHome); pendingExists=(Test-Path -LiteralPath $pending); envExists=(Test-Path -LiteralPath (Join-Path $configHome 'env.json')); tokensExists=(Test-Path -LiteralPath (Join-Path $configHome 'tokens.json')) }
  bootstrap=[ordered]@{ path=$bootstrap; exists=(Test-Path -LiteralPath $bootstrap); raw=$bootstrapRaw; parsed=$bootstrapParsed }
  receipt=[ordered]@{ searched=$tempCandidates; path=$(if($latest){$latest.FullName}else{$null}); raw=$receiptRaw; parsed=$receipt }
}
Write-Output ($result | ConvertTo-Json -Depth 10 -Compress)
`;
}

function lockedStateScript() {
  return `
$lockedPath=${psQuote(paths.localRuntimeSqlite)}
$pendingPath=${psQuote(paths.pending)}
$tempCandidates=@(${psQuote(paths.temp)},${psQuote(paths.windowsTemp)}) | Select-Object -Unique
$receipts=@()
foreach($dir in $tempCandidates){ if(Test-Path -LiteralPath $dir){ $receipts += @(Get-ChildItem -LiteralPath $dir -Filter 'openwork-nuke-receipt-*.json' -File -ErrorAction SilentlyContinue) } }
$latest=$receipts | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$receiptRaw=''
$receipt=$null
if($latest){ $receiptRaw=Get-Content -Raw -LiteralPath $latest.FullName; try { $receipt=$receiptRaw | ConvertFrom-Json } catch {} }
$pendingRaw=''
$pending=$null
if(Test-Path -LiteralPath $pendingPath){ $pendingRaw=Get-Content -Raw -LiteralPath $pendingPath; try { $pending=$pendingRaw | ConvertFrom-Json } catch {} }
$result=[ordered]@{ lockedPath=$lockedPath; lockedExists=(Test-Path -LiteralPath $lockedPath); pendingPath=$pendingPath; pendingExists=(Test-Path -LiteralPath $pendingPath); pendingRaw=$pendingRaw; pending=$pending; receiptPath=$(if($latest){$latest.FullName}else{$null}); receiptRaw=$receiptRaw; receipt=$receipt }
Write-Output ($result | ConvertTo-Json -Depth 10 -Compress)
`;
}

function lockRuntimeScript() {
  return `
$lockPath=${psQuote(paths.localRuntimeSqlite)}
$scriptPath=Join-Path ${psQuote(paths.temp)} ${psQuote(LOCKER_SCRIPT_NAME)}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lockPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $scriptPath) | Out-Null
Set-Content -Path $lockPath -Value 'locked runtime sqlite ${RUN_TAG}' -Encoding UTF8
$locker=@'
$path = ${psQuote(paths.localRuntimeSqlite)}
$fs = [System.IO.File]::Open($path, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  while ($true) { Start-Sleep -Seconds 1 }
} finally {
  $fs.Dispose()
}
'@
Set-Content -Path $scriptPath -Value $locker -Encoding UTF8
$process=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptPath) -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 900
$locked=$false
try { $probe=[System.IO.File]::Open($lockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None); $probe.Dispose() } catch [System.IO.IOException] { $locked=$true }
$result=[ordered]@{ path=$lockPath; script=$scriptPath; pid=$process.Id; locked=$locked; exists=(Test-Path -LiteralPath $lockPath) }
Write-Output ($result | ConvertTo-Json -Depth 4 -Compress)
if(-not $locked){ exit 44 }
`;
}

function unlockProbeScript() {
  return `
$lockPath=${psQuote(paths.localRuntimeSqlite)}
$unlocked=$false
$lastError=''
for($i=0; $i -lt 30; $i++){
  try { $probe=[System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None); $probe.Dispose(); $unlocked=$true; break } catch { $lastError=$_.Exception.Message; Start-Sleep -Milliseconds 250 }
}
$result=[ordered]@{ path=$lockPath; exists=(Test-Path -LiteralPath $lockPath); unlocked=$unlocked; lastError=$lastError }
Write-Output ($result | ConvertTo-Json -Depth 4 -Compress)
if(-not $unlocked){ exit 45 }
`;
}

function containsPath(pathsToSearch, expectedPath) {
  const expected = cleanWinPath(expectedPath).toLowerCase();
  return arrayValue(pathsToSearch).some((entry) => {
    const candidate = cleanWinPath(entry).toLowerCase();
    return candidate === expected || candidate === cleanWinPath(paths.configHome).toLowerCase();
  });
}

function receiptPendingPaths(data) {
  return arrayValue(data?.receipt?.pendingRetry);
}

function pendingFilePaths(data) {
  return arrayValue(data?.pending?.paths);
}

async function triggerShellRelaunch(ctx) {
  const hasRelaunch = await ctx.eval("Boolean(window.__OPENWORK_ELECTRON__?.shell?.relaunch)");
  witness(ctx, hasRelaunch === true, "The packaged Electron bridge exposes shell.relaunch for the boot-guard retry", hasRelaunch);
  await ctx.eval("window.__OPENWORK_ELECTRON__.shell.relaunch()", { awaitPromise: true }).catch(() => undefined);
  await waitForRelaunch(ctx, "shell relaunch after locked-path retry");
}

function assertPostFirstNuke(ctx, data) {
  const localEntries = arrayValue(data.localOpenwork?.entries).map(String);
  const unexpectedLocal = localEntries.filter((entry) => entry !== "desktop-bootstrap.json");
  const seededAppOpenwork = arrayValue(data.appOpenwork?.seededFiles);
  const appOpenworkSurvivors = seededAppOpenwork.filter((entry) => entry?.exists === true).map((entry) => entry.name);
  const bootstrapRaw = String(data.bootstrap?.raw ?? "");
  const bootstrap = data.bootstrap?.parsed ?? {};
  const receipt = data.receipt?.parsed ?? {};

  witness(ctx, data.userData?.markerExists === false, "%APPDATA%\\com.differentai.openwork lost the seeded userData marker after relaunch", data.userData);
  witness(ctx, data.opencode?.exists === false, "%APPDATA%\\opencode is gone after the nuke", data.opencode);
  witness(ctx, appOpenworkSurvivors.length === 0, "%APPDATA%\\openwork no longer contains the seeded server/runtime/token files", data.appOpenwork);
  witness(ctx, data.localOpenwork?.exists === true, "%LOCALAPPDATA%\\openwork survives only as the preserved config directory", data.localOpenwork);
  witness(ctx, unexpectedLocal.length === 0, "%LOCALAPPDATA%\\openwork contains only desktop-bootstrap.json", localEntries);
  witness(ctx, data.localOpenwork?.pendingExists === false, ".nuke-pending.json is absent after the unlocked nuke", data.localOpenwork);
  witness(ctx, data.localOpenwork?.envExists === false && data.localOpenwork?.tokensExists === false, "Seeded LOCALAPPDATA env.json and tokens.json were removed", data.localOpenwork);
  witness(ctx, data.bootstrap?.exists === true, "desktop-bootstrap.json still exists", data.bootstrap?.path);
  witness(ctx, bootstrap.baseUrl === BOOTSTRAP_BASE_URL, "desktop-bootstrap.json keeps baseUrl https://openwork-poc.example.test", bootstrap);
  witness(ctx, bootstrap.requireSignin === true, "desktop-bootstrap.json keeps requireSignin true", bootstrap);
  witness(ctx, bootstrap.brandAppName === BRAND_APP_NAME, `desktop-bootstrap.json keeps brandAppName ${BRAND_APP_NAME}`, bootstrap);
  witness(ctx, !bootstrapRaw.includes("secret-grant"), "desktop-bootstrap.json no longer contains secret-grant", bootstrapRaw);
  witness(ctx, !bootstrapRaw.includes("secret-token"), "desktop-bootstrap.json no longer contains secret-token", bootstrapRaw);
  witness(ctx, !bootstrapRaw.includes("handoff") && !bootstrapRaw.includes("claimLinks") && !bootstrapRaw.includes("prepared"), "desktop-bootstrap.json strips handoff, claimLinks, and prepared", bootstrapRaw);
  witness(ctx, Array.isArray(receipt.deleted) && receipt.deleted.length > 0, "The newest openwork-nuke-receipt JSON has a non-empty deleted[]", data.receipt);
  state.firstReceiptPath = String(data.receipt?.path ?? "");
}

export default {
  id: FLOW_ID,
  title: "Debug nuke wipes Windows local state and relaunches to sanitized sign-in",
  kind: "user-facing",
  requiresApp: false,
  spec: "evals/voiceovers/debug-nuke-fresh-start.md",
  precondition: async (ctx) => {
    const missing = ENV_NAMES.filter((name) => !ctx.env[name]?.trim());
    if (missing.length > 0) {
      throw new Error(`debug-nuke-fresh-start requires a running remote Windows packaged app. Missing env: ${missing.join(", ")}. Set OPENWORK_EVAL_WIN_SANDBOX_ID, OPENWORK_EVAL_CDP_URL, and OPENWORK_EVAL_WIN_PROFILE.`);
    }
    if (!/^[a-zA-Z]:\\/.test(WIN_PROFILE)) {
      throw new Error(`OPENWORK_EVAL_WIN_PROFILE must be an absolute Windows profile path, got ${JSON.stringify(WIN_PROFILE)}.`);
    }
    ctx.cdpBaseUrl = CDP_URL;
    await attachApp(ctx, 60_000);
    await waitForAppShell(ctx, "precondition app");
  },
  steps: [
    {
      name: "Frame 1 — A tester's machine is full of real state",
      run: async (ctx) => {
        await ctx.prove("The Windows tester profile has seeded OpenWork, OpenCode, bootstrap, orchestrator, Chromium, and renderer state", {
          voiceover: vo[0],
          action: async () => {
            await attachApp(ctx);
            const seed = daytonaPowerShellJson(ctx, "seed-windows-profile-state", seedFilesScript());
            ctx.output("seeded path summary", JSON.stringify(seed, null, 2));
            daytonaCmd(ctx, "seeded-directories-dir", `dir "${paths.opencode}" & dir "${paths.configHome}" & dir "${paths.orchestrator}" & dir "${paths.userData}"`);
            await enableRendererState(ctx);
            await navigateToSettings(ctx, "general");
            await ctx.waitForText("Overview of all settings", { timeoutMs: 60_000 });
          },
          assert: async () => {
            const probe = daytonaPowerShellJson(ctx, "seeded-files-probe", fixtureProbeScript());
            witness(ctx, probe.opencode?.auth === true, "%APPDATA%\\opencode\\auth.json exists", probe.opencode);
            witness(ctx, probe.opencode?.mcpAuth === true, "%APPDATA%\\opencode\\mcp-auth.json exists", probe.opencode);
            witness(ctx, probe.opencode?.db === true, "%APPDATA%\\opencode\\opencode.db exists", probe.opencode);
            witness(ctx, probe.configHome?.env === true && probe.configHome?.tokens === true, "%LOCALAPPDATA%\\openwork env.json and tokens.json exist", probe.configHome);
            witness(ctx, probe.bootstrap?.exists === true, "%LOCALAPPDATA%\\openwork\\desktop-bootstrap.json exists", probe.bootstrap);
            witness(ctx, probe.orchestrator?.auth === true, "profile .openwork\\openwork-orchestrator auth exists", probe.orchestrator);
            const storage = await ctx.eval(`(() => {
              const pick = ['openwork.preferences', 'openwork.developerMode', 'openwork.den.authToken'];
              const result = {};
              for (const key of pick) result[key] = localStorage.getItem(key);
              result.allOpenworkKeys = Object.keys(localStorage).filter((key) => key.startsWith('openwork.')).sort();
              return result;
            })()`);
            witness(ctx, storage["openwork.developerMode"] === "1", "Renderer localStorage has openwork.developerMode = 1", storage);
            witness(ctx, String(storage["openwork.preferences"] ?? "").includes("hasCompletedOnboarding"), "Renderer localStorage has openwork.preferences with hasCompletedOnboarding", storage);
            witness(ctx, storage["openwork.den.authToken"] === FAKE_AUTH_TOKEN, "Renderer localStorage has the seeded fake openwork.den.authToken", { ...storage, "openwork.den.authToken": "<seeded>" });
            ctx.output("renderer-localStorage-before-nuke", JSON.stringify({ ...storage, "openwork.den.authToken": "<seeded>" }, null, 2));
          },
          screenshot: { name: "stateful-machine-before-nuke", requireText: ["Overview of all settings"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Frame 2 — The tester arms the nuke in Debug settings",
      run: async (ctx) => {
        await ctx.prove("Debug settings exposes the Danger zone nuke dialog with delete/survive lists and typed confirmation", {
          voiceover: vo[1],
          action: async () => {
            await attachApp(ctx);
            await openNukeDialog(ctx);
          },
          assert: async () => {
            await ctx.expectText("Danger zone");
            await ctx.expectText("Nuke & fresh start");
            await ctx.expectText("Nuke local state and start fresh?");
            await ctx.expectText("This removes local OpenWork, OpenCode, browser, token, runtime, cache, and orchestrator state on this device.");
            await ctx.expectText("Will delete");
            await ctx.expectText("Will survive");
            await ctx.expectText("Type NUKE to confirm");
            await ctx.expectText("Chromium storage cleared: default, persist:openwork-browser");
            await ctx.expectText("Nuke & relaunch");
          },
          screenshot: {
            name: "debug-danger-zone-nuke-dialog",
            requireText: [
              "Nuke local state and start fresh?",
              "This removes local OpenWork, OpenCode, browser, token, runtime, cache, and orchestrator state on this device.",
              "Will delete",
              "Will survive",
              "Type NUKE to confirm",
              "Chromium storage cleared: default, persist:openwork-browser",
              "Nuke & relaunch",
            ],
          },
        });
      },
    },
    {
      name: "Frame 3 — One typed word wipes the machine and the app comes back asking for sign-in",
      run: async (ctx) => {
        await ctx.prove("Typing NUKE executes the cleanup, relaunches Electron, preserves required sign-in, and clears seeded Chromium storage", {
          voiceover: vo[2],
          action: async () => {
            await executeNukeFromDialog(ctx, "first nuke execute-and-relaunch");
            await ctx.waitForText(`Welcome to ${BRAND_APP_NAME}`, { timeoutMs: 90_000 });
          },
          assert: async () => {
            await ctx.expectText(`Welcome to ${BRAND_APP_NAME}`, { timeoutMs: 90_000 });
            await ctx.expectText("Sign in to get started with your workspace.");
            await ctx.expectText(`Sign in to ${BRAND_APP_NAME}`);
            await ctx.expectText("Paste sign-in code");
            const storage = await ctx.eval(`(() => ({
              preferences: localStorage.getItem('openwork.preferences'),
              developerMode: localStorage.getItem('openwork.developerMode'),
              authToken: localStorage.getItem('openwork.den.authToken'),
              openworkKeys: Object.keys(localStorage).filter((key) => key.startsWith('openwork.')).sort(),
            }))()`);
            witness(ctx, storage.authToken === null, "Seeded openwork.den.authToken is gone after Chromium storage clear", storage);
            witness(ctx, storage.preferences === null, "Seeded openwork.preferences is gone after Chromium storage clear", storage);
            witness(ctx, storage.developerMode === null, "Seeded openwork.developerMode is gone after Chromium storage clear", storage);
            ctx.output("renderer-localStorage-after-first-nuke", JSON.stringify(storage, null, 2));
          },
          screenshot: {
            name: "fresh-start-forced-signin",
            requireText: [
              `Welcome to ${BRAND_APP_NAME}`,
              "Sign in to get started with your workspace.",
              `Sign in to ${BRAND_APP_NAME}`,
              "Paste sign-in code",
            ],
            rejectText: ["Nuke local state and start fresh?"],
          },
        });
      },
    },
    {
      name: "Frame 4 — Nothing stateful survived except stripped provisioning",
      run: async (ctx) => {
        await ctx.prove("Filesystem witnesses show only sanitized desktop-bootstrap.json survived and the nuke receipt recorded deleted paths", {
          voiceover: vo[3],
          assert: async () => {
            const data = daytonaPowerShellJson(ctx, "post-first-nuke-filesystem-probe", postNukeProbeScript());
            daytonaCmd(ctx, "post-first-nuke-config-dir", `if exist "${paths.configHome}" (dir "${paths.configHome}") else (echo MISSING "${paths.configHome}")`, { allowFailure: true });
            daytonaCmd(ctx, "post-first-nuke-opencode-dir", `if exist "${paths.opencode}" (dir "${paths.opencode}") else (echo MISSING "${paths.opencode}")`, { allowFailure: true });
            ctx.output("post-first-nuke-witness-json", JSON.stringify(data, null, 2));
            assertPostFirstNuke(ctx, data);
          },
        });
      },
    },
    {
      name: "Frame 5 — A locked database is retried on the next boot",
      run: async (ctx) => {
        await ctx.prove("A locked runtime.sqlite is recorded for retry, then the boot guard removes it after the locker is killed and the app relaunches", {
          voiceover: vo[4],
          action: async () => {
            await attachApp(ctx);
            const lock = daytonaPowerShellJson(ctx, "start-exclusive-runtime-sqlite-lock", lockRuntimeScript());
            state.lockPid = Number(lock.pid) || 0;
            state.lockVerified = lock.locked === true;
            witness(ctx, state.lockVerified, "PowerShell holds an exclusive FileShare.None handle on %LOCALAPPDATA%\\openwork\\runtime.sqlite", lock);
            await enableRendererState(ctx, { includePreferences: false });
            await openNukeDialog(ctx);
            await executeNukeFromDialog(ctx, "second nuke with locked runtime.sqlite");
            state.afterLockedNuke = daytonaPowerShellJson(ctx, "after-locked-nuke-pending-or-receipt", lockedStateScript());
            ctx.output("after-locked-nuke-witness-json", JSON.stringify(state.afterLockedNuke, null, 2));
            state.killResult = daytonaCmd(ctx, "kill-runtime-sqlite-locker", `taskkill /F /PID ${state.lockPid}`, { allowFailure: true, timeoutMs: 30_000 });
            state.unlockProbe = daytonaPowerShellJson(ctx, "verify-runtime-sqlite-lock-released", unlockProbeScript(), { timeoutMs: 30_000 });
            ctx.output("runtime-sqlite-unlock-probe", JSON.stringify(state.unlockProbe, null, 2));
            await triggerShellRelaunch(ctx);
            state.afterBootGuard = daytonaPowerShellJson(ctx, "after-boot-guard-locked-path-probe", lockedStateScript());
            ctx.output("after-boot-guard-witness-json", JSON.stringify(state.afterBootGuard, null, 2));
          },
          assert: async () => {
            const afterLocked = state.afterLockedNuke;
            const afterBoot = state.afterBootGuard;
            const pendingPaths = pendingFilePaths(afterLocked);
            const receiptPaths = receiptPendingPaths(afterLocked);
            state.secondReceiptPath = String(afterLocked?.receiptPath ?? "");
            const hasPendingEvidence =
              (afterLocked?.pendingExists === true && containsPath(pendingPaths, paths.localRuntimeSqlite)) ||
              containsPath(receiptPaths, paths.localRuntimeSqlite);
            witness(ctx, state.lockPid > 0, "The detached locker process has a PID", state.lockPid);
            witness(ctx, afterLocked?.lockedExists === true, "The locked runtime.sqlite still exists immediately after the locked nuke", afterLocked);
            witness(ctx, state.secondReceiptPath.length > 0 && state.secondReceiptPath !== state.firstReceiptPath, "The second nuke wrote a new receipt", { firstReceiptPath: state.firstReceiptPath, secondReceiptPath: state.secondReceiptPath });
            witness(ctx, hasPendingEvidence, "The pending retry file or newest receipt names the locked runtime.sqlite/config root", { pendingPaths, receiptPaths, pendingExists: afterLocked?.pendingExists });
            witness(ctx, state.killResult?.status === 0, "taskkill terminated the detached PowerShell locker", { status: state.killResult?.status, stdout: state.killResult?.stdout, stderr: state.killResult?.stderr });
            witness(ctx, state.unlockProbe?.unlocked === true, "The runtime.sqlite exclusive handle was released before the retry boot", state.unlockProbe);
            witness(ctx, afterBoot?.pendingExists === false, "After the retry boot, .nuke-pending.json is gone", afterBoot);
            witness(ctx, afterBoot?.lockedExists === false, "After the retry boot, the formerly locked runtime.sqlite is gone", afterBoot);
          },
        });
      },
    },
  ],
};
