const CHROME_REMOTE_DEBUGGING_PORTS = [9222, 9229];
const CHROME_DYNAMIC_PORT_START = 64000;
const CHROME_DYNAMIC_PORT_END = 65535;
const CHROME_PROBE_CONCURRENCY = 64;

async function probeChromePort(port: number, timeoutMs: number): Promise<number | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return typeof payload?.webSocketDebuggerUrl === "string" ? port : null;
  } catch {
    return null;
  }
}

async function scanChromeDynamicPorts(): Promise<number | null> {
  const ports: number[] = [];
  for (let port = CHROME_DYNAMIC_PORT_START; port <= CHROME_DYNAMIC_PORT_END; port++) {
    ports.push(port);
  }

  for (let index = 0; index < ports.length; index += CHROME_PROBE_CONCURRENCY) {
    const batch = ports.slice(index, index + CHROME_PROBE_CONCURRENCY);
    const results = await Promise.all(batch.map((port) => probeChromePort(port, 250)));
    const match = results.find((port): port is number => typeof port === "number");
    if (match) return match;
  }

  return null;
}

export async function findReachableChromeDebuggingPort(): Promise<number | null> {
  const knownResults = await Promise.all(CHROME_REMOTE_DEBUGGING_PORTS.map((port) => probeChromePort(port, 1000)));
  const knownMatch = knownResults.find((port): port is number => typeof port === "number");
  if (knownMatch) return knownMatch;

  return scanChromeDynamicPorts();
}
