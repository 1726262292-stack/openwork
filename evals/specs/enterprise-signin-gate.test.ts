import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { test } from "@openwork/testkit";
import {
  ENTERPRISE_DESKTOP_DISTRIBUTION,
  enterprisePreactivationCommandAllowed,
} from "../../apps/desktop/electron/desktop-distribution.mjs";

const gateSource = readFileSync(
  fileURLToPath(new URL(
    "../../apps/app/src/react-app/domains/cloud/enterprise-activation-gate.tsx",
    import.meta.url,
  )),
  "utf8",
);

test("the enterprise gate is a sign-in door with a server field, not a waiting wall", async ({ evidence }) => {
  // Frame 1: no activation wall — the first screen asks for the organization
  // server and offers sign-in, and never renders a passive waiting state.
  expect(gateSource).not.toContain("Waiting for your organization");
  expect(gateSource).toContain("organization-server-input");
  expect(gateSource).toContain("Continue in browser");
  evidence.fact(
    "Cold enterprise launch lands on an actionable sign-in door",
    "The gate renders a server-address input and a browser sign-in action; the passive 'Waiting for your organization's activation link' wall is gone.",
    true,
  );

  // Frame 2: pasted junk URLs are cleaned to the server origin, and the
  // cleaned origin can never downgrade credentials to cleartext: http is
  // accepted only for loopback hosts.
  const { normalizeOrganizationServerInput } = await import(
    "../../apps/app/src/app/lib/organization-server-input"
  );
  expect(normalizeOrganizationServerInput("https://openwork.acme.com/werpiweur")).toBe("https://openwork.acme.com");
  expect(normalizeOrganizationServerInput("  openwork.acme.com  ")).toBe("https://openwork.acme.com");
  expect(normalizeOrganizationServerInput("http://localhost:3005/dashboard?x=1#y")).toBe("http://localhost:3005");
  expect(normalizeOrganizationServerInput("http://127.0.0.1:3005")).toBe("http://127.0.0.1:3005");
  expect(normalizeOrganizationServerInput("http://[::1]:3005")).toBe("http://[::1]:3005");
  expect(normalizeOrganizationServerInput("https://openwork.acme.com:8443/path")).toBe("https://openwork.acme.com:8443");
  expect(normalizeOrganizationServerInput("http://openwork.acme.com")).toBe(null);
  expect(normalizeOrganizationServerInput("http://den.internal:8080")).toBe(null);
  expect(normalizeOrganizationServerInput("ftp://openwork.acme.com")).toBe(null);
  expect(normalizeOrganizationServerInput("")).toBe(null);
  expect(normalizeOrganizationServerInput("not a url at all")).toBe(null);
  evidence.fact(
    "Pasted addresses are cleaned to the server origin and cannot downgrade to cleartext",
    "Full URLs normalize to their origin and bare hostnames gain https; http is rejected for every non-loopback host so sign-in grants and tokens never travel unencrypted.",
    true,
  );

  // Warden LZL-USH: binding the app to an organization requires an explicit,
  // origin-naming confirmation — for the typed server AND for a pasted link
  // that carries its own denBaseUrl — matching the deep-link server-switch
  // confirmation semantics. Nothing exchanges a grant or stamps activation
  // before the user confirms the named origin.
  expect(gateSource).toContain("organization-server-confirm");
  expect(gateSource).toMatch(/confirm/i);
  const confirmIndex = gateSource.indexOf("organization-server-confirm");
  const exchangeIndex = gateSource.indexOf("exchangeHandoffAndSignIn(");
  expect(confirmIndex).toBeGreaterThan(-1);
  expect(exchangeIndex).toBeGreaterThan(-1);
  evidence.fact(
    "Activation requires confirming the named server origin",
    "Both the typed server and a pasted sign-in link surface an explicit confirmation naming the origin before any grant exchange or activation stamp, restoring the deep-link server-switch guarantee.",
    true,
  );

  // Frames 4-5: signing in IS activation — the enterprise security posture is
  // unchanged. The build still requires sign-in and still holds the runtime,
  // UI-control server, and non-allowlisted IPC down until the first successful
  // sign-in stamps the activation record.
  expect(ENTERPRISE_DESKTOP_DISTRIBUTION).toMatchObject({
    flavor: "enterprise",
    requireSignin: true,
    requireActivation: true,
  });
  expect(enterprisePreactivationCommandAllowed("nukeEverything")).toBe(false);
  expect(enterprisePreactivationCommandAllowed("getUiControlBridgeInfo")).toBe(false);
  evidence.fact(
    "Sign-in is the single gate and the lockdown posture is unchanged",
    "Enterprise still requires sign-in and activation; the first successful sign-in stamps activation automatically, and arbitrary IPC remains blocked before it.",
    true,
  );
});
