# runtime-config-ownership — OpenWork never writes into your personal OpenCode config again, and cleans up what old versions left behind

Older OpenWork versions wrote MCP entries, agent definitions, and provider
state directly into the user's own OpenCode config files
(`~/.config/opencode/*`). Those leftovers survive every upgrade, deep-merge
into the effective config underneath the injected runtime config, and
manufacture ghost entries nobody can trace (field incident: a stale Cloud
MCP URL "from an old version" that no screen in the product could explain).
The app also still writes through the engine's `config.update` into the
user's global file today. This flow makes the managed runtime config file
the only thing OpenWork ever writes, and sweeps legacy residue out — with a
backup — on first launch.

1. I open the OpenCode config file in my home folder and find leftovers an old version of OpenWork wrote there — including a stale connection URL that no settings screen can explain.

2. I update OpenWork and launch it once; it spots the legacy leftovers, backs the file up next to the original, and sweeps the OpenWork-written keys out of my personal config automatically.

3. In Settings, a cleanup notice tells me exactly which keys were removed and where the backup lives, so nothing happened behind my back.

4. Now I disable a provider in Settings — and my personal config file does not change; the change lands in OpenWork's own managed runtime file instead.

5. My agent keeps working exactly as before — same tools, same connections — because everything OpenWork manages now lives in the one file it owns, and everything I own stays mine.
