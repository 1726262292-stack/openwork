import {
  UI_ARTIFACT_PROTOCOL,
  UI_ARTIFACT_SCHEMA_VERSION,
  type UiArtifactPayload,
  type UiArtifactRenderResult,
} from "@openwork/types/ui-artifact"

function compactFact(value: string) {
  const normalized = value.trim()
  if (normalized.length <= 160) return normalized
  return `${normalized.slice(0, 159).trimEnd()}…`
}

function calendarNarration(artifact: Extract<UiArtifactPayload, { artifactId: "calendar.day" }>) {
  const count = artifact.data.events.length
  const visibleFacts = artifact.data.events.slice(0, 5).map((event) => `${event.start}: ${event.title}`)
  if (artifact.data.focusWindow) {
    visibleFacts.push(`${artifact.data.focusWindow.label}: ${artifact.data.focusWindow.start} to ${artifact.data.focusWindow.end}`)
  }
  return {
    summary: `Rendered ${artifact.title} with ${count} calendar ${count === 1 ? "event" : "events"} for ${artifact.data.date} in ${artifact.data.timezone}.`,
    visibleFacts,
  }
}

function threadNarration(artifact: Extract<UiArtifactPayload, { artifactId: "communication.thread" }>) {
  const count = artifact.data.messages.length
  const authors = [...new Set(artifact.data.messages.map((message) => message.author))]
  return {
    summary: `Rendered ${count} ${count === 1 ? "message" : "messages"} from #${artifact.data.channel} in ${artifact.data.workspace}.`,
    visibleFacts: [
      `Participants: ${authors.join(", ")}`,
      ...artifact.data.messages.slice(0, 4).map((message) => `${message.author}: ${message.body}`),
    ],
  }
}

function mailNarration(artifact: Extract<UiArtifactPayload, { artifactId: "mail.inbox" }>) {
  const count = artifact.data.messages.length
  return {
    summary: `Rendered ${count} inbox ${count === 1 ? "message" : "messages"} for ${artifact.data.account}; ${artifact.data.unreadCount} unread.`,
    visibleFacts: artifact.data.messages.slice(0, 5).map((message) => `${message.sender}: ${message.subject}`),
  }
}

function attentionNarration(artifact: Extract<UiArtifactPayload, { artifactId: "work.attention" }>) {
  const count = artifact.data.items.length
  const critical = artifact.data.items.filter((item) => item.priority === "critical").length
  return {
    summary: `Rendered ${count} ${count === 1 ? "item" : "items"} needing attention${critical > 0 ? `, including ${critical} critical` : ""}.`,
    visibleFacts: artifact.data.items.slice(0, 5).map((item) => `${item.priority}: ${item.title}`),
  }
}

function metricsNarration(artifact: Extract<UiArtifactPayload, { artifactId: "metrics.glance" }>) {
  const visibleFacts = artifact.data.metrics.map((metric) => `${metric.label}: ${metric.value}`)
  if (artifact.data.focusWindow) {
    visibleFacts.push(`${artifact.data.focusWindow.label}: ${artifact.data.focusWindow.start} to ${artifact.data.focusWindow.end}`)
  }
  return {
    summary: `Rendered ${artifact.title} with ${artifact.data.metrics.length} summary metrics.`,
    visibleFacts,
  }
}

function progressNarration(artifact: Extract<UiArtifactPayload, { artifactId: "work.progress" }>) {
  return {
    summary: `Rendered ${artifact.data.items.length} compact work progress widgets.`,
    visibleFacts: artifact.data.items.map((item) => `${item.label}: ${item.value}${item.detail ? ` · ${item.detail}` : ""}`),
  }
}

function approvalsNarration(artifact: Extract<UiArtifactPayload, { artifactId: "work.approvals" }>) {
  const pending = artifact.data.items.filter((item) => item.status === "pending").length
  return {
    summary: `Rendered ${artifact.data.items.length} mock approval requests; ${pending} ${pending === 1 ? "is" : "are"} still pending.`,
    visibleFacts: artifact.data.items.map((item) => `${item.status}: ${item.title} from ${item.requestor}`),
  }
}

function workspaceBriefNarration(artifact: Extract<UiArtifactPayload, { artifactId: "workspace.brief" }>) {
  return {
    summary: `Rendered a complete workspace brief with ${artifact.data.metrics.length} metrics, ${artifact.data.schedule.length} events, ${artifact.data.attention.length} attention items, and ${artifact.data.progress.length} progress widgets.`,
    visibleFacts: [
      artifact.data.summary,
      ...artifact.data.metrics.slice(0, 4).map((metric) => `${metric.label}: ${metric.value}`),
      ...artifact.data.attention.slice(0, 2).map((item) => `${item.priority}: ${item.title}`),
    ],
  }
}

export function renderUiArtifact(artifact: UiArtifactPayload): UiArtifactRenderResult {
  const narration = (() => {
    switch (artifact.artifactId) {
      case "workspace.brief":
        return workspaceBriefNarration(artifact)
      case "calendar.day":
        return calendarNarration(artifact)
      case "communication.thread":
        return threadNarration(artifact)
      case "mail.inbox":
        return mailNarration(artifact)
      case "work.attention":
        return attentionNarration(artifact)
      case "work.approvals":
        return approvalsNarration(artifact)
      case "work.progress":
        return progressNarration(artifact)
      case "metrics.glance":
        return metricsNarration(artifact)
    }
  })()

  return {
    protocol: UI_ARTIFACT_PROTOCOL,
    schemaVersion: UI_ARTIFACT_SCHEMA_VERSION,
    status: "rendered",
    artifact,
    narration: {
      ...narration,
      visibleFacts: narration.visibleFacts.slice(0, 8).map(compactFact),
    },
  }
}
