import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

function readBootstrapFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), "..", "..", "..", "packages", "openwork-bootstrap", ...segments), "utf8");
}

export function GET() {
  return new Response(readBootstrapFile("start.md"), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
