import type { Env, Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { createReadStream } from "node:fs"
import { lstat } from "node:fs/promises"
import { z } from "zod"
import { resolvePublicOrigin } from "../../capability-sources/generic-oauth.js"
import { env } from "../../env.js"
import { publicRoute } from "../../middleware/index.js"
import { jsonResponse } from "../../openapi.js"
import {
  buildDesktopReleaseMetadata,
  desktopReleaseContentType,
  desktopReleaseFilePath,
  expandDesktopReleaseBaseUrl,
  mountedDesktopReleaseAvailability,
} from "../../utils/desktop-releases.js"
import { denApiAppVersion } from "../../version.js"

const desktopReleaseResponseSchema = z.object({
  source: z.enum(["mounted", "external"]),
  version: z.string().min(1),
  updateFeedUrl: z.string().url(),
  alphaUpdateFeedUrl: z.string().url().optional(),
  downloads: z.object({
    "mac-arm64": z.string().url(),
    "mac-x64": z.string().url(),
    "win-x64": z.string().url(),
    "win-arm64": z.string().url().optional(),
  }),
}).nullable()

const appVersionResponseSchema = z.object({
  minAppVersion: z.string(),
  latestAppVersion: z.string().min(1),
  desktopRelease: desktopReleaseResponseSchema,
}).meta({ ref: "DenAppVersionResponse" })

async function desktopReleaseMetadata(request: Request) {
  const version = denApiAppVersion.latestAppVersion
  if (version === "0.0.0") return null

  if (env.desktopReleasesDir) {
    const availability = await mountedDesktopReleaseAvailability({ rootDir: env.desktopReleasesDir, version })
    if (!availability) return null
    const origin = resolvePublicOrigin(request, env.apiPublicUrl)
    const baseUrl = new URL(`/v1/desktop-releases/${encodeURIComponent(version)}`, origin).toString()
    return buildDesktopReleaseMetadata({
      source: "mounted",
      version,
      baseUrl,
      alphaUpdateFeedUrl: env.desktopAlphaUpdateFeedUrl,
      includeWindowsArm64: availability.windowsArm64,
    })
  }

  if (env.desktopReleasesPublicBaseUrl) {
    return buildDesktopReleaseMetadata({
      source: "external",
      version,
      baseUrl: expandDesktopReleaseBaseUrl(env.desktopReleasesPublicBaseUrl, version),
      alphaUpdateFeedUrl: env.desktopAlphaUpdateFeedUrl,
      includeWindowsArm64: true,
    })
  }

  return null
}

async function desktopReleaseResponse(request: Request, version: string, fileName: string) {
  if (!env.desktopReleasesDir) return new Response("Not found", { status: 404 })
  const filePath = desktopReleaseFilePath({
    rootDir: env.desktopReleasesDir,
    supportedVersion: denApiAppVersion.latestAppVersion,
    requestedVersion: version,
    fileName,
  })
  if (!filePath) return new Response("Not found", { status: 404 })

  const fileStat = await lstat(filePath).catch(() => null)
  if (!fileStat?.isFile() || fileStat.isSymbolicLink()) return new Response("Not found", { status: 404 })

  const rangeMatch = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/)
  let start = 0
  let end = fileStat.size - 1
  if (rangeMatch) {
    const requestedStart = rangeMatch[1] ? Number(rangeMatch[1]) : null
    const requestedEnd = rangeMatch[2] ? Number(rangeMatch[2]) : null
    if (requestedStart === null && requestedEnd !== null) {
      start = Math.max(0, fileStat.size - requestedEnd)
    } else if (requestedStart !== null) {
      start = requestedStart
      end = requestedEnd === null ? end : Math.min(requestedEnd, end)
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= fileStat.size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${fileStat.size}` } })
    }
  }
  const partial = Boolean(rangeMatch)
  const headers = {
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": String(end - start + 1),
    "content-type": desktopReleaseContentType(fileName),
    ...(partial ? { "content-range": `bytes ${start}-${end}/${fileStat.size}` } : {}),
  }
  const status = partial ? 206 : 200
  if (request.method === "HEAD") return new Response(null, { status, headers })
  const source = createReadStream(filePath, { start, end })
  source.pause()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      source.on("data", (chunk: Buffer) => {
        source.pause()
        const bytes = new Uint8Array(chunk.byteLength)
        bytes.set(chunk)
        controller.enqueue(bytes)
      })
      source.once("end", () => controller.close())
      source.once("error", (error) => controller.error(error))
    },
    pull() {
      source.resume()
    },
    cancel() {
      source.destroy()
    },
  })
  return new Response(body, { status, headers })
}

export function registerVersionRoutes<T extends Env>(app: Hono<T>) {
  app.get(
    "/v1/app-version",
    describeRoute({
      tags: ["System"],
      summary: "Get desktop app version metadata",
      description: "Returns the supported desktop app versions plus deployment-owned download and update-feed URLs when configured.",
      responses: {
        200: jsonResponse("Desktop app version metadata returned successfully.", appVersionResponseSchema),
      },
    }),
    publicRoute,
    async (c) => {
      return c.json({
        ...denApiAppVersion,
        desktopRelease: await desktopReleaseMetadata(c.req.raw),
      })
    },
  )

  app.get(
    "/v1/desktop-releases/:version/:fileName",
    publicRoute,
    (c) => desktopReleaseResponse(c.req.raw, c.req.param("version"), c.req.param("fileName")),
  )
  app.on(
    "HEAD",
    "/v1/desktop-releases/:version/:fileName",
    publicRoute,
    (c) => desktopReleaseResponse(c.req.raw, c.req.param("version"), c.req.param("fileName")),
  )
}
