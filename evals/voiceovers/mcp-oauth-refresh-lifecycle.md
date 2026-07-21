# MCP OAuth refresh lifecycle

1. OpenWork exercises the real OAuth and MCP endpoints with two-second access tokens. Serial refreshes stay connected, while concurrent rotation, token reuse, and revoked-session behavior are captured as explicit regression evidence.
