# OpenWork HandsFree Computer Use

Native macOS computer-use runtime imported from the HandsFree prototype.

This package focuses on the reusable control layer:

- Semantic AX snapshots with compact refs like `{e1}`.
- Strict background mode that avoids foreground cursor/HID fallbacks.
- Target-window screenshots via `CGWindowListCreateImage(.optionIncludingWindow)`.
- Background input through `CGEvent.postToPid` with window-addressing fields.
- Background activation using per-process event taps plus AppKit and center-click primers.
- Non-UI orchestration modules from the original Electron prototype: realtime tool schemas/instructions and the GPT computer-use loop.

Build the native stdio server:

```bash
pnpm --filter @openwork/handsfree check:native
```

Run it as an MCP-compatible adapter:

```bash
pnpm --filter @openwork/handsfree exec openwork-handsfree-computer-use mcp
```

The core runtime is intentionally MCP-independent. `ComputerUseRuntime` exposes a small direct surface (`snapshot`, `click`, `typeText`, `pressKey`, `scroll`, `wait`, `setValue`, `performAction`); `MCPServer` is only a thin stdio wrapper.
