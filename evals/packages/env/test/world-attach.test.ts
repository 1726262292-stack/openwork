import assert from "node:assert/strict";
import test from "node:test";
import { defineWorld, resolveWorldPerson } from "../src/topology.ts";
import { buildSnapshot, fromSnapshot } from "../src/world.ts";

test("prod attached Dens refuse organizations while staging attached Dens allow them", () => {
  assert.throws(
    () => defineWorld({
      den: {
        attach: { apiUrl: "https://den.example.test", tier: "prod" },
        orgs: { acme: {} },
      },
    }),
    /you own what you launch; you never own what you attach/,
  );

  assert.doesNotThrow(() => defineWorld({
    den: {
      attach: { apiUrl: "https://den.example.test", tier: "staging" },
      orgs: { acme: {} },
    },
  }));
});

test("den.attach rejects launch-only Den options", () => {
  const attach: { apiUrl: string; tier: "staging" } = {
    apiUrl: "https://den.example.test",
    tier: "staging",
  };
  assert.throws(
    () => defineWorld({ den: { attach, orgs: { acme: {} }, seed: "demo-org" } }),
    /den\.attach conflicts with den\.seed/,
  );
  assert.throws(
    () => defineWorld({ den: { attach, orgs: { acme: {} }, substrate: "local" } }),
    /den\.attach conflicts with den\.substrate/,
  );
  assert.throws(
    () => defineWorld({ den: { attach, orgs: { acme: {} }, env: { DEN_ORG_MODE: "multi_org" } } }),
    /den\.attach conflicts with den\.env/,
  );
});

function attachedSnapshot(apiUrl: string) {
  return buildSnapshot({
    name: "attached-snapshot",
    createdAt: "2026-08-23T12:00:00.000Z",
    place: "local",
    topology: defineWorld({
      den: {
        attach: { apiUrl, tier: "staging" },
        orgs: { acme: {} },
      },
    }).topology,
    resolved: {
      den: { apiUrl, webUrl: apiUrl, origin: "attached" },
      apps: {},
    },
  });
}

test("fromSnapshot accepts only clean http(s) attached Den URLs", () => {
  for (const apiUrl of [
    "https://user:pw@host",
    "ftp://host",
    "https://host/path#hash",
  ]) {
    assert.throws(
      () => fromSnapshot(JSON.stringify(attachedSnapshot(apiUrl))),
      /attached Den URLs|expected an http\(s\) URL/,
    );
  }

  assert.doesNotThrow(() => fromSnapshot(JSON.stringify(attachedSnapshot("https://host"))));
});

test("secretRef people resolve both credential variables and report missing variables", () => {
  const secretRef = "OPENWORK_WORLD_ATTACH_UNIT_PERSON";
  assert.deepEqual(
    resolveWorldPerson(
      { secretRef, name: "Jordan" },
      {
        [`${secretRef}_EMAIL`]: "jordan@example.test",
        [`${secretRef}_PASSWORD`]: "unit-secret-password",
      },
    ),
    {
      email: "jordan@example.test",
      name: "Jordan",
      password: "unit-secret-password",
    },
  );

  assert.throws(
    () => resolveWorldPerson(
      { secretRef },
      { [`${secretRef}_EMAIL`]: "jordan@example.test" },
    ),
    new RegExp(`${secretRef}_PASSWORD`),
  );
  assert.throws(
    () => defineWorld({
      den: {
        orgs: { acme: { members: { jordan: { secretRef, password: "inline" } } } },
      },
    }),
    /secretRef and password are mutually exclusive/,
  );
});
