# runtime-config-ownership — OpenWork never writes into your personal OpenCode config again, and cleans up what old versions left behind

Older OpenWork versions wrote MCP entries and provider state directly into
the user's own OpenCode config files (`~/.config/opencode/*`). Those
leftovers survive every upgrade, deep-merge underneath the injected runtime
config, and manufacture ghost entries nobody can trace (field incident: a
stale Cloud MCP URL "from an old version" that no screen in the product
could explain). The app also still writes through the engine's
`config.update` into the user's global file today. After this change, the
managed runtime config file is the only thing OpenWork ever writes.

1. I open the OpenCode config in my home folder and find leftovers an old version of OpenWork wrote there — including a stale connection URL that no settings screen can explain.

2. I update OpenWork and launch it once: it backs up the file, sweeps out the OpenWork-written keys, and shows me exactly what it removed and where the backup lives.

3. When I change a setting now — like disabling a provider — my personal config stays untouched; the change lands in OpenWork's own managed file instead.

4. My agent keeps working exactly as before: everything OpenWork manages lives in the one file it owns, and everything I own stays mine.
