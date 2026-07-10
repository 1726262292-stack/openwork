import { renderEmailHtml } from "@openwork/email"
import { expect, test } from "bun:test"

test("organization invitation HTML uses the organization install page", async () => {
  const downloadUrl = "https://on-prem.example.test/install?token=org-install-token"
  const html = await renderEmailHtml("organizationInvite", {
    inviteLink: "https://on-prem.example.test/join-org?invite=invitation-token",
    invitedByName: "Riley",
    invitedByEmail: "riley@example.test",
    organizationName: "Acme Robotics",
    role: "member",
    downloadUrl,
  })

  expect(html).toContain("Download the desktop app")
  expect(html).toContain(downloadUrl.replace("&", "&amp;"))
})
