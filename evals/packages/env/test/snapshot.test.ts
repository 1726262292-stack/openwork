import assert from "node:assert/strict";
import test from "node:test";
import { defineWorld } from "../src/topology.ts";
import { buildSnapshot, fromSnapshot } from "../src/world.ts";

test("world snapshots round-trip their declarative topology and name", () => {
  const topology = defineWorld({
    den: { orgs: { acme: { admin: { name: "Alex" } } }, web: false },
    apps: { main: { sessions: ["Q3 report", "Invoice cleanup"] } },
  }).topology;
  const snapshot = buildSnapshot({
    name: "round-trip",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "local",
    topology,
    resolved: {
      den: {
        apiUrl: "http://127.0.0.1:8790",
        webUrl: "http://127.0.0.1:3005",
        database: "openwork_eval_round_trip",
        ports: { api: 8790, web: 3005 },
      },
      apps: {
        main: {
          cdpUrl: "http://127.0.0.1:9222",
          workspaceId: "workspace-1",
          sessions: ["Q3 report", "Invoice cleanup"],
        },
      },
    },
  });

  assert.deepEqual(fromSnapshot(JSON.stringify(snapshot)), {
    topology,
    name: "round-trip",
  });
  assert.deepEqual(snapshot.resolved.apps.main?.sessions, ["Q3 report", "Invoice cleanup"]);
  assert.deepEqual(snapshot.resolved.den, {
    apiUrl: "http://127.0.0.1:8790",
    webUrl: "http://127.0.0.1:3005",
    database: "openwork_eval_round_trip",
    ports: { api: 8790, web: 3005 },
  });
});

test("fromSnapshot rejects unknown fields", () => {
  const topology = defineWorld({ den: { orgs: { acme: {} } } }).topology;
  const snapshot = buildSnapshot({
    name: "strict-snapshot",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "local",
    topology,
    resolved: {
      den: { apiUrl: "http://127.0.0.1:8788", webUrl: "http://127.0.0.1:3005" },
      apps: {},
    },
  });

  assert.throws(
    () => fromSnapshot(JSON.stringify({ ...snapshot, unknownSnapshotField: true })),
    /Unrecognized key.*unknownSnapshotField/,
  );
});

test("kind world snapshots preserve their resolved Den substrate", () => {
  const topology = defineWorld({
    den: {
      substrate: "kind",
      orgs: { "Acme Robotics": {} },
    },
  }).topology;
  const snapshot = buildSnapshot({
    name: "kind-world",
    createdAt: "2026-08-22T12:00:00.000Z",
    place: "local",
    topology,
    resolved: {
      den: {
        apiUrl: "http://127.0.0.1:8790",
        webUrl: "http://127.0.0.1:3005",
        substrate: "kind",
      },
      apps: {},
    },
  });

  assert.equal(snapshot.resolved.den.substrate, "kind");
  assert.deepEqual(fromSnapshot(JSON.stringify(snapshot)), { topology, name: "kind-world" });
});
