/** @jsxImportSource react */
import { useEffect } from "react"
import { AUTOMATION_MODEL_ATTENTION_CAPABILITY, type AutomationDesktopRunnerRegistration } from "@openwork/types/automations"

import { createDenClient, DenApiError, readDenSettings } from "@/app/lib/den"
import { denSettingsChangedEvent } from "@/app/lib/den-session-events"
import { isDesktopRuntime } from "@/app/utils"
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider"

const RUNNER_TOKEN_REFRESH_MS = 5 * 60_000
const RUNNER_ID_KEY = "openwork.automations.desktop-runner-id"

function desktopRunnerId() {
  const existing = localStorage.getItem(RUNNER_ID_KEY)?.trim()
  if (existing) return existing
  const created = crypto.randomUUID()
  localStorage.setItem(RUNNER_ID_KEY, created)
  return created
}

function resetDesktopRunnerId() {
  localStorage.removeItem(RUNNER_ID_KEY)
  return desktopRunnerId()
}

/** Keeps this signed-in, preview-enabled desktop registered as the owner's Automation runner. */
export function AutomationRunnerBridge({ enabled }: { enabled: boolean }) {
  const { status } = useDenAuth()

  useEffect(() => {
    if (!isDesktopRuntime() || !window.__OPENWORK_ELECTRON__?.invokeDesktop) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const disconnect = () => window.__OPENWORK_ELECTRON__?.invokeDesktop?.("automationRunnerConfigure", null)
      .catch(() => undefined)
    const connect = async () => {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      if (disposed || !enabled || status !== "signed_in") {
        await disconnect()
        return
      }
      const settings = readDenSettings()
      const authToken = settings.authToken?.trim() ?? ""
      const organizationId = settings.activeOrgId?.trim() ?? ""
      if (!authToken || !organizationId) {
        await disconnect()
        return
      }
      try {
        const client = createDenClient({ baseUrl: settings.baseUrl, token: authToken })
        let runnerId = desktopRunnerId()
        const build = await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("appBuildInfo")
        const agent = navigator.userAgent
        const platform = /Mac/i.test(agent) ? "darwin" : /Win/i.test(agent) ? "win32" : "linux"
        const registration = (id: string, protocolVersion: 1 | 2): AutomationDesktopRunnerRegistration => ({
          runnerId: id,
          protocolVersion,
          supportedExecutionTargets: ["desktop"],
          capabilities: [AUTOMATION_MODEL_ATTENTION_CAPABILITY],
          appVersion: String(build?.version ?? "unknown"),
          platform,
          concurrency: 1,
        })
        const mint = async (id: string) => {
          try {
            return await client.mintAutomationRunnerToken(organizationId, registration(id, 2))
          } catch (error) {
            // Older Den APIs only accept protocol v1 registrations; those
            // credentials stay on the proxied base URL this client already uses.
            if (error instanceof DenApiError && error.status === 400 && error.code === "invalid_request") {
              return client.mintAutomationRunnerToken(organizationId, registration(id, 1))
            }
            throw error
          }
        }
        let runner: Awaited<ReturnType<typeof mint>>
        try {
          runner = await mint(runnerId)
        } catch (error) {
          if (!(error instanceof DenApiError) || error.status !== 409 || error.code !== "automation_runner_identity_conflict") {
            throw error
          }
          runnerId = resetDesktopRunnerId()
          runner = await mint(runnerId)
        }
        if (disposed) return
        await window.__OPENWORK_ELECTRON__?.invokeDesktop?.("automationRunnerConfigure", {
          // The minted baseUrl is the credential's signed audience; sending the
          // runner anywhere else would fail the desktop's binding check.
          baseUrl: runner.baseUrl ?? client.baseUrls.apiBaseUrl,
          token: runner.token,
          runnerId,
        })
      } catch (error) {
        console.warn("[automation-runner] registration failed", error)
      } finally {
        if (!disposed) timer = setTimeout(() => void connect(), RUNNER_TOKEN_REFRESH_MS)
      }
    }

    const handleSettingsChanged = () => void connect()
    window.addEventListener(denSettingsChangedEvent, handleSettingsChanged)
    void connect()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      window.removeEventListener(denSettingsChangedEvent, handleSettingsChanged)
      void disconnect()
    }
  }, [enabled, status])

  return null
}
