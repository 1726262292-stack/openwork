# engine-attested-apply — "applied" means the engine confirmed it, not that a probe got lucky

Today OpenWork decides whether its managed config was "delivered" by probing
the Cloud MCP endpoint with its own Node fetch — a different TLS stack than
the engine's. On corporate Windows machines behind TLS-intercepting proxies
the probe fails with a bare "fetch failed" while the engine is connected and
working, so diagnostics report `cloud_tools_missing`, `appliedRevision`
stays null forever, and support chases a network ghost (field incident: the
Blue Yonder POC). There are also two parallel delivery paths — the config
file re-read on instance rebuild, and a hot-add API — reconciled by a sync
tracker. This flow collapses delivery to one path and makes the engine
itself the witness: apply = write the file, rebuild the instance, read back
the effective config, and confirm the owned keys match the desired revision.

1. I'm on a corporate laptop behind a TLS-inspecting proxy; my agent's cloud connection actually works, but the diagnostics screen insists delivery failed and my tools are missing.

2. After the update, OpenWork applies its managed config by writing one file, reloading the engine, and reading back what the engine actually loaded — no guessing.

3. The diagnostics now show "applied — confirmed by engine", with the desired and applied revisions matching, because the engine that runs my tools is the one vouching for them.

4. The old network probe still runs as a secondary check, but when the corporate proxy blocks it, it says "probe unreachable — network diagnostic only" instead of pretending my tools are gone.

5. I copy the sanitized diagnostic for support, and for the first time it tells the truth at every layer: config applied, engine connected, and the only red line is the one that's actually red.
