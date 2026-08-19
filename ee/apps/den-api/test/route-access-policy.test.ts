import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ScriptKind,
  ScriptTarget,
  createSourceFile,
  forEachChild,
  isCallExpression,
  isElementAccessExpression,
  isIdentifier,
  isPropertyAccessExpression,
  type Node,
} from "typescript"

const srcRoot = fileURLToPath(new URL("../src", import.meta.url))
const denCoreSrcRoot = fileURLToPath(new URL("../../../packages/den-core/src", import.meta.url))

const routeMethods = ["get", "post", "patch", "put", "delete", "all", "on"]
const accessPolicyMarkers = [
  "publicRoute",
  "authenticatedRoute",
  "orgMemberRoute",
  "orgRoleRoute",
  "adminRoute",
  "signedWebhookRoute",
  "tokenRoute",
  "cloudTransportRoute",
  "delegatedRoute",
]

type RouteCall = {
  filePath: string
  line: number
  call: string
}

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath)
    }

    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : []
  })
}

function findRouteCalls(filePath: string): RouteCall[] {
  const source = readFileSync(filePath, "utf8")
  const sourceFile = createSourceFile(filePath, source, ScriptTarget.Latest, true, ScriptKind.TS)
  const calls: RouteCall[] = []

  function visit(node: Node) {
    if (isCallExpression(node)) {
      const expression = node.expression
      const isStaticRoute = isPropertyAccessExpression(expression)
        && isIdentifier(expression.expression)
        && expression.expression.text === "app"
        && routeMethods.includes(expression.name.text)
      const isDynamicRoute = isElementAccessExpression(expression)
        && isIdentifier(expression.expression)
        && expression.expression.text === "routeApp"
        && isIdentifier(expression.argumentExpression)
        && expression.argumentExpression.text === "method"

      if (isStaticRoute || isDynamicRoute) {
        const start = node.getStart(sourceFile)
        calls.push({
          filePath,
          line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
          call: node.getText(sourceFile),
        })
      }
    }
    forEachChild(node, visit)
  }

  visit(sourceFile)
  return calls
}

describe("Den API route access policies", () => {
  test("every route declares an explicit access policy", () => {
    const missingPolicy = [srcRoot, denCoreSrcRoot]
      .flatMap(listTypeScriptFiles)
      .flatMap(findRouteCalls)
      .filter((route) => !accessPolicyMarkers.some((marker) => route.call.includes(marker)))

    expect(missingPolicy.map((route) => `${route.filePath}:${route.line}`)).toEqual([])
  })

  test("organization analytics requires an admin role", () => {
    const analyticsRoute = findRouteCalls(join(srcRoot, "routes/telemetry/index.ts"))
      .find((route) => route.call.includes('"/v1/telemetry/analytics"'))

    expect(analyticsRoute?.call).toContain('orgRoleRoute(["admin"])')
  })
})
