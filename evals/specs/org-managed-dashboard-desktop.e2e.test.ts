import { expect } from "vitest";
import { denFetch, evalIn, waitFor } from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { app, needs, server, test, unmetNeeds } from "@openwork/testkit";
import type { TestNeeds } from "@openwork/testkit";

const requirements: TestNeeds = {
  optIn: ["OPENWORK_EVAL_E2E_TESTS"],
};
const missingRequirements = unmetNeeds(requirements, process.env);
const title = missingRequirements.length > 0
  ? `organization-managed Desktop dashboard skipped — needs: ${missingRequirements.join(", ")}`
  : "Desktop consumes server-managed dashboards without local authoring or launch consent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function organizationId(session: DenSession): Promise<string> {
  const result = await denFetch(session, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${session.token}` },
  });
  const organizations = isRecord(result.body) && Array.isArray(result.body.orgs)
    ? result.body.orgs.filter(isRecord)
    : [];
  const id = organizations[0] && typeof organizations[0].id === "string" ? organizations[0].id : "";
  if (!result.response.ok || !id) {
    throw new Error(`Finding the active organization failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return id;
}

async function createDashboard(session: DenSession, name: string): Promise<string> {
  const result = await denFetch(session, "/v1/dashboards", {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}` },
    body: JSON.stringify({
      name,
      elements: [{
        serverName: "openwork-app-host-connect-0123456789ab",
        connectionId: "emc_01dashboardfixture0000000000",
        toolName: "render_report",
        projectedToolName: "openwork-app-host-connect-0123456789ab_render_report",
        resourceUri: "ui://fixture/report/view.html",
        title: "Weekly report",
      }],
    }),
  });
  const item = isRecord(result.body) && isRecord(result.body.item) ? result.body.item : null;
  const id = item && typeof item.id === "string" ? item.id : "";
  if (result.response.status !== 201 || !id) {
    throw new Error(`Creating ${name} failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return id;
}

test(title, async ({ evidence, place }) => {
  needs(requirements);
  await using den = await server({
    place,
    org: {
      name: `Managed Desktop dashboard ${Date.now()}`,
      admin: { name: "Managed Dashboard Admin" },
    },
  });

  const orgId = await organizationId(den.admin);
  const grantedName = `Operations board ${Date.now()}`;
  const privateName = `Private board ${Date.now()}`;
  const grantedDashboardId = await createDashboard(den.admin, grantedName);
  await createDashboard(den.admin, privateName);
  const grant = await denFetch(den.admin, `/v1/dashboards/${grantedDashboardId}/access`, {
    method: "POST",
    headers: { authorization: `Bearer ${den.admin.token}` },
    body: JSON.stringify({ orgWide: true, role: "viewer" }),
  });
  if (grant.response.status !== 201) {
    throw new Error(`Granting the dashboard failed: HTTP ${grant.response.status} ${grant.text.slice(0, 500)}`);
  }

  await using desktop = await app({
    den,
    as: "admin",
    place,
    beforeSignIn: async (surface) => {
      await evalIn(surface, `localStorage.setItem("openwork.mcpAppsDashboard", "1")`);
    },
  });
  const dashboardHash = "#/dashboard";
  const dashboardOpened = await evalIn(desktop, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((entry) => entry.textContent?.trim() === "Dashboard");
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  expect(dashboardOpened).toBe(true);
  await waitFor(desktop, `(() => {
    const section = document.querySelector(${JSON.stringify(`[data-granted-dashboard="${grantedDashboardId}"]`)});
    return location.hash === ${JSON.stringify(dashboardHash)}
      && section instanceof HTMLElement
      && section.innerText.includes(${JSON.stringify(grantedName)})
      && section.innerText.includes("Managed by your organization")
      && section.innerText.includes("Weekly report");
  })()`, {
    timeoutMs: 90_000,
    label: "granted organization dashboard rendered in Desktop",
  });

  const state = await evalIn(desktop, `(() => {
    const section = document.querySelector(${JSON.stringify(`[data-granted-dashboard="${grantedDashboardId}"]`)});
    if (!(section instanceof HTMLElement)) return null;
    const allText = document.body.innerText;
    return {
      boardVisible: section.innerText.includes(${JSON.stringify(grantedName)}),
      privateBoardVisible: allText.includes(${JSON.stringify(privateName)}),
      runVisible: Boolean(section.querySelector('button[aria-label="Run Weekly report"]')),
      removeVisible: Boolean(section.querySelector('button[aria-label="Remove Weekly report"]')),
      addAppVisible: [...document.querySelectorAll("button")]
        .some((button) => button.textContent?.trim() === "Add app"),
      managedLabelVisible: section.innerText.includes("Managed by your organization"),
    };
  })()`);
  expect(state).toEqual({
    boardVisible: true,
    privateBoardVisible: false,
    runVisible: true,
    removeVisible: false,
    addAppVisible: false,
    managedLabelVisible: true,
  });
  evidence.recordAssertionEvidence(
    "Desktop renders only dashboards granted to the signed-in member",
    `org=${orgId}; granted=${grantedName}; ungranted=${privateName}; state=${JSON.stringify(state)}`,
    isRecord(state) && state.boardVisible === true && state.privateBoardVisible === false,
  );
  evidence.recordAssertionEvidence(
    "Desktop has no local dashboard authoring, while managed tiles remain manual-first and non-removable",
    `tile=Weekly report; state=${JSON.stringify(state)}`,
    isRecord(state)
      && state.runVisible === true
      && state.removeVisible === false
      && state.addAppVisible === false
      && state.managedLabelVisible === true,
  );
});
