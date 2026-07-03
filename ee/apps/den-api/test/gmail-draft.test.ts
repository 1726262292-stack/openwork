import { beforeAll, describe, expect, test } from "bun:test"

function seedRequiredEnv() {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "mysql://root:password@127.0.0.1:3306/openwork_test"
  process.env.DEN_DB_ENCRYPTION_KEY = process.env.DEN_DB_ENCRYPTION_KEY ?? "x".repeat(32)
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "y".repeat(32)
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:8790"
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://127.0.0.1:8790"
}

let gmail: typeof import("../src/capability-sources/gmail.js")

beforeAll(async () => {
  seedRequiredEnv()
  gmail = await import("../src/capability-sources/gmail.js")
})

describe("buildGmailDraftRaw", () => {
  test("encodes a plain-ASCII draft as base64url RFC 822 with the body base64-encoded", () => {
    const raw = gmail.buildGmailDraftRaw({ to: "sam@acme.test", subject: "Follow up", body: "Hello Sam" })
    const decoded = Buffer.from(raw, "base64url").toString("utf8")
    expect(decoded).toContain("To: sam@acme.test\r\n")
    expect(decoded).toContain("Subject: Follow up\r\n")
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"')
    const bodyPart = decoded.split("\r\n\r\n")[1]
    expect(Buffer.from(bodyPart, "base64").toString("utf8")).toBe("Hello Sam")
    // base64url alphabet only — Gmail rejects standard base64 for `raw`.
    expect(raw).not.toMatch(/[+/=]/)
  })

  test("non-ASCII subjects get RFC 2047 B-encoding, bodies survive UTF-8 round trips", () => {
    const raw = gmail.buildGmailDraftRaw({ to: "sam@acme.test", subject: "Résumé — próxima reunión", body: "Grüße aus Zürich ✅" })
    const decoded = Buffer.from(raw, "base64url").toString("utf8")
    const subjectLine = decoded.split("\r\n").find((line) => line.startsWith("Subject: "))
    expect(subjectLine).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    expect(Buffer.from(subjectLine!.slice("Subject: =?UTF-8?B?".length, -2), "base64").toString("utf8")).toBe("Résumé — próxima reunión")
    const bodyPart = decoded.split("\r\n\r\n")[1]
    expect(Buffer.from(bodyPart, "base64").toString("utf8")).toBe("Grüße aus Zürich ✅")
  })
})

describe("encodeMimeHeaderValue", () => {
  test("leaves ASCII untouched and encodes anything else", () => {
    expect(gmail.encodeMimeHeaderValue("plain subject")).toBe("plain subject")
    expect(gmail.encodeMimeHeaderValue("café")).toBe(`=?UTF-8?B?${Buffer.from("café", "utf8").toString("base64")}?=`)
  })
})

describe("readGmailDraftIds", () => {
  test("reads Gmail-shaped responses", () => {
    expect(gmail.readGmailDraftIds(JSON.stringify({ id: "draft-1", message: { id: "msg-1" } })))
      .toEqual({ draftId: "draft-1", messageId: "msg-1" })
  })

  test("tolerates malformed and partial responses", () => {
    expect(gmail.readGmailDraftIds("not json")).toEqual({ draftId: null, messageId: null })
    expect(gmail.readGmailDraftIds(JSON.stringify({ id: "draft-1" }))).toEqual({ draftId: "draft-1", messageId: null })
    expect(gmail.readGmailDraftIds(JSON.stringify({ message: { id: "msg-1" } }))).toEqual({ draftId: null, messageId: "msg-1" })
    expect(gmail.readGmailDraftIds(JSON.stringify([1, 2]))).toEqual({ draftId: null, messageId: null })
  })
})
