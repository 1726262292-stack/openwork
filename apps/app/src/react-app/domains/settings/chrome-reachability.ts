import { checkChromeDebuggingPort } from "../../../app/lib/desktop";

const CHROME_REMOTE_DEBUGGING_PORTS = [9222, 9229];
const CHROME_DYNAMIC_PORT_START = 64000;
const CHROME_DYNAMIC_PORT_END = 65535;
const CHROME_PROBE_CONCURRENCY = 64;

async function probeChromePort(port: number): Promise<number | null> {
  try {
    const result = await checkChromeDebuggingPort(port);
    return result.connected ? port : null;
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
    const results = await Promise.all(batch.map((port) => probeChromePort(port)));
    const match = results.find((port): port is number => typeof port === "number");
    if (match) return match;
  }

  return null;
}

export async function findReachableChromeDebuggingPort(preferredPort?: number | null): Promise<number | null> {
  if (preferredPort && Number.isInteger(preferredPort) && preferredPort > 0) {
    const preferredMatch = await probeChromePort(preferredPort);
    if (preferredMatch) return preferredMatch;
  }

  const knownResults = await Promise.all(CHROME_REMOTE_DEBUGGING_PORTS.map((port) => probeChromePort(port)));
  const knownMatch = knownResults.find((port): port is number => typeof port === "number");
  if (knownMatch) return knownMatch;

  return scanChromeDynamicPorts();
}
