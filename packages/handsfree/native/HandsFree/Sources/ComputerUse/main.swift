/// HandsFreeComputerUse: semantic AX and background-safe macOS computer use.
///
/// The runtime is MCP-independent. This binary exposes it over a small stdio
/// adapter because existing agent clients already speak MCP.

import Foundation

setbuf(stdout, nil)

let args = CommandLine.arguments
if args.count >= 2 && args[1] == "mcp" {
    let server = MCPServer()
    await server.run()
} else {
    fputs("Usage: HandsFreeComputerUse mcp\n", stderr)
    exit(1)
}
