import { describe, expect, test } from "bun:test"
import {
  buildBackgroundJobPromptBody,
  buildCloudTaskRunJobInput,
  readOpencodeSessionId,
  startWorkerBackgroundJob,
} from "../src/workers/background-jobs.js"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("worker background jobs", () => {
  test("reads OpenCode session ids from common response shapes", () => {
    expect(readOpencodeSessionId({ id: "ses_direct" })).toBe("ses_direct")
    expect(readOpencodeSessionId({ data: { id: "ses_data" } })).toBe("ses_data")
    expect(readOpencodeSessionId({ session: { id: "ses_session" } })).toBe("ses_session")
    expect(readOpencodeSessionId({})).toBeNull()
  })

  test("builds prompt_async body from a simple cloud prompt", () => {
    expect(buildBackgroundJobPromptBody({
      openworkUrl: "https://worker.example/w/ws_1",
      clientToken: "client-token",
      prompt: "Review the repo",
      model: { providerID: "openwork", modelID: "openwork/deepseek/deepseek-v4-flash" },
      agent: "openwork",
      variant: "medium",
    })).toEqual({
      model: { providerID: "openwork", modelID: "openwork/deepseek/deepseek-v4-flash" },
      agent: "openwork",
      variant: "medium",
      parts: [{ type: "text", text: "Review the repo" }],
    })
  })

  test("builds worker job input from a cloud task row without changing secrets", () => {
    expect(buildCloudTaskRunJobInput({
      task: {
        name: "Daily repo review",
        prompt: "Review the repo",
        model_provider_id: "openwork",
        model_id: "openwork/deepseek/deepseek-v4-flash",
        agent: "openwork",
        variant: "medium",
      },
      openworkUrl: "https://worker.example/w/ws_1",
      clientToken: "client-token",
    })).toEqual({
      openworkUrl: "https://worker.example/w/ws_1",
      clientToken: "client-token",
      prompt: "Review the repo",
      title: "Daily repo review",
      model: { providerID: "openwork", modelID: "openwork/deepseek/deepseek-v4-flash" },
      agent: "openwork",
      variant: "medium",
    })
  })

  test("creates a cloud session and starts prompt_async through injected fetch", async () => {
    const calls: Array<{ url: string; body: unknown; authorization: string | null }> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      const request = new Request(url, init)
      calls.push({
        url: request.url,
        body: await request.json(),
        authorization: request.headers.get("authorization"),
      })

      if (request.url.endsWith("/opencode/session")) {
        return jsonResponse({ data: { id: "ses_cloud" } })
      }

      if (request.url.endsWith("/opencode/session/ses_cloud/prompt_async")) {
        return jsonResponse({ ok: true, accepted: true })
      }

      return jsonResponse({ message: "unexpected request" }, 404)
    }

    const job = await startWorkerBackgroundJob({
      openworkUrl: "https://worker.example/w/ws_1/",
      clientToken: "client-token",
      prompt: "Run in cloud",
      title: "Cloud job",
    }, fetchImpl)

    expect(job.status).toBe("accepted")
    expect(job.sessionId).toBe("ses_cloud")
    expect(job.openworkUrl).toBe("https://worker.example/w/ws_1")
    expect(job.jobId.startsWith("job_")).toBe(true)
    expect(calls).toEqual([
      {
        url: "https://worker.example/w/ws_1/opencode/session",
        body: { title: "Cloud job" },
        authorization: "Bearer client-token",
      },
      {
        url: "https://worker.example/w/ws_1/opencode/session/ses_cloud/prompt_async",
        body: { parts: [{ type: "text", text: "Run in cloud" }] },
        authorization: "Bearer client-token",
      },
    ])
  })
})
