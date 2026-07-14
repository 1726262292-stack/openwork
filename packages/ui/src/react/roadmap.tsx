import type { ReactNode } from "react"

export type RoadmapStatus = "live" | "building" | "next" | "exploring"

export type RoadmapItem = {
  title: string
  description: string
  status: RoadmapStatus
}

export type RoadmapSection = {
  id: string
  eyebrow: string
  title: string
  description: string
  callout?: string
  items: RoadmapItem[]
}

export type RoadmapSpec = {
  number: string
  title: string
  description: string
}

type StatusDetails = {
  label: string
  description: string
  className: string
  dotClassName: string
}

const statusDetails: Record<RoadmapStatus, StatusDetails> = {
  live: {
    label: "Live",
    description: "Available today",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dotClassName: "bg-emerald-500",
  },
  building: {
    label: "Building",
    description: "Active work",
    className: "border-blue-200 bg-blue-50 text-blue-800",
    dotClassName: "bg-blue-500",
  },
  next: {
    label: "Next",
    description: "The next product horizon",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    dotClassName: "bg-amber-500",
  },
  exploring: {
    label: "Exploring",
    description: "A direction, not a commitment",
    className: "border-slate-200 bg-slate-50 text-slate-700",
    dotClassName: "bg-slate-400",
  },
}

export const roadmapSections: RoadmapSection[] = [
  {
    id: "desktop-home",
    eyebrow: "01 · the home base",
    title: "the desktop app is home",
    description:
      "The desktop app is the main OpenWork experience. It is where people work with files, run agents, manage sessions, create skills, connect services, and customize a workspace.",
    callout:
      "The desktop app is where most people configure OpenWork today. Connect is how that configuration travels.",
    items: [
      {
        title: "Desktop app for macOS, Windows, and Linux",
        description: "A complete local-first workspace for agentic work.",
        status: "live",
      },
      {
        title: "Local files and workspaces",
        description: "Work directly with the files and repositories already on your computer.",
        status: "live",
      },
      {
        title: "Skills, plugins, MCPs, and connected services",
        description: "Customize what your agent knows and which systems it can use.",
        status: "live",
      },
      {
        title: "Organization-managed capabilities",
        description: "Share approved skills and connections without rebuilding every setup by hand.",
        status: "live",
      },
      {
        title: "Better organization for long-running work",
        description: "Make active, waiting, and completed work easier to understand and return to.",
        status: "building",
      },
    ],
  },
  {
    id: "setup-follows",
    eyebrow: "02 · portable by design",
    title: "your setup follows you",
    description:
      "What you configure in OpenWork should not stay trapped in one interface. OpenWork Connect brings the same capabilities into the agents you already use.",
    items: [
      {
        title: "OpenWork Connect MCP",
        description: "Search and run your assigned capabilities through one remote MCP connection.",
        status: "live",
      },
      {
        title: "Codex, Claude Code, Cursor, and OpenCode",
        description: "Use OpenWork from compatible agents without rewriting skills or changing MCP servers.",
        status: "live",
      },
      {
        title: "Organization marketplaces and access controls",
        description: "Publish capabilities once and decide which people and teams receive them.",
        status: "live",
      },
      {
        title: "Shared and per-user authentication",
        description: "Admins can provide a shared connection or ask each member to sign in with their own account.",
        status: "live",
      },
      {
        title: "Git-based publishing and automatic sync",
        description: "Keep shared capabilities aligned with the repositories where teams build them.",
        status: "building",
      },
    ],
  },
  {
    id: "hosted-workspaces",
    eyebrow: "03 · work that stays on",
    title: "a workspace that stays on",
    description:
      "Hosted workspaces give a person or team a persistent filesystem and a predictable environment in the cloud. Files, dependencies, repository state, and running work remain available after the laptop closes.",
    callout:
      "Start with the desktop app. Leave work running in a hosted workspace. Return from the desktop, Slack, mobile, or another surface.",
    items: [
      {
        title: "Remote workspace connections",
        description: "Open a compatible remote runtime through the normal desktop workspace flow.",
        status: "live",
      },
      {
        title: "Persistent hosted workspaces",
        description: "Give every user or team a durable filesystem and agent environment in the cloud.",
        status: "building",
      },
      {
        title: "Reproducible environments",
        description: "Provision known tools, dependencies, permissions, and workspace configuration every time.",
        status: "building",
      },
      {
        title: "Long-running and background tasks",
        description: "Keep work moving without requiring the desktop app or laptop to remain open.",
        status: "building",
      },
      {
        title: "Scheduled workflows",
        description: "Run recurring work against the same workspace, files, and authenticated services.",
        status: "next",
      },
      {
        title: "Continue from another surface",
        description: "Move between interfaces without losing the workspace or the work already in progress.",
        status: "next",
      },
    ],
  },
  {
    id: "every-surface",
    eyebrow: "04 · meet people where they work",
    title: "OpenWork on every surface",
    description:
      "The desktop app remains the richest OpenWork experience. Other surfaces provide focused ways to reach the same capabilities, permissions, workspaces, and history.",
    items: [
      {
        title: "OpenWork desktop",
        description: "The complete interface for creating, configuring, and doing work.",
        status: "live",
      },
      {
        title: "Existing AI agents through MCP",
        description: "Bring OpenWork into the coding and agent tools you already use.",
        status: "live",
      },
      {
        title: "Slack",
        description: "Start work, receive results, and return to the same workspace from a team channel or private chat.",
        status: "next",
      },
      {
        title: "Mobile",
        description: "Check work, approve actions, and keep tasks moving away from your computer.",
        status: "next",
      },
      {
        title: "Email and messaging",
        description: "Reach OpenWork from more of the places where requests and decisions arrive.",
        status: "exploring",
      },
      {
        title: "Custom organization agents",
        description: "Build specialized surfaces on top of the same OpenWork workspace and capability system.",
        status: "exploring",
      },
    ],
  },
  {
    id: "systems",
    eyebrow: "05 · beyond a single conversation",
    title: "systems, not just conversations",
    description:
      "Persistent environments and portable authentication make it possible to turn successful agent work into reliable systems that can run again.",
    items: [
      {
        title: "Search and execute",
        description: "Keep agent context small while making the full OpenWork capability catalog available on demand.",
        status: "live",
      },
      {
        title: "Authenticated multi-step execution",
        description: "Combine multiple services and actions into one controlled server-side run.",
        status: "building",
      },
      {
        title: "Schedules and event triggers",
        description: "Start work at a specific time or when something changes in a connected system.",
        status: "next",
      },
      {
        title: "Human approvals and resumable runs",
        description: "Pause at sensitive steps, ask for a decision, and continue from the same state.",
        status: "next",
      },
      {
        title: "Retries, logs, and run history",
        description: "Make repeated workflows observable and easier to operate when something fails.",
        status: "next",
      },
    ],
  },
]

export const roadmapSpecs: RoadmapSpec[] = [
  {
    number: "01",
    title: "OpenWork Capability Spec",
    description:
      "How skills, plugins, MCP dependencies, authentication requirements, and permissions are packaged and shared.",
  },
  {
    number: "02",
    title: "OpenWork Workspace Spec",
    description:
      "How a workspace describes its files, environment, dependencies, capabilities, provisioning, and persistence.",
  },
  {
    number: "03",
    title: "OpenWork Surface Spec",
    description:
      "How desktop, MCP clients, Slack, mobile, and custom interfaces attach to the same workspace with the right identity and permissions.",
  },
  {
    number: "04",
    title: "OpenWork Run Spec",
    description:
      "How multi-step workflows define execution, schedules, approvals, retries, outputs, and history.",
  },
]

function StatusBadge({ status }: { status: RoadmapStatus }) {
  const details = statusDetails[status]

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${details.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${details.dotClassName}`} />
      {details.label}
    </span>
  )
}

function WindowDots() {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
    </div>
  )
}

function SurfaceChip({ children, status }: { children: ReactNode; status: RoadmapStatus }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
      <span className={`h-1.5 w-1.5 rounded-full ${statusDetails[status].dotClassName}`} />
      {children}
    </div>
  )
}

function SurfaceMap() {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[#eef3f7] p-5 shadow-[0_30px_80px_-55px_rgba(1,22,39,0.55)] sm:p-8 lg:p-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(100,116,139,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,0.12) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap justify-center gap-2.5">
          <SurfaceChip status="live">Codex</SurfaceChip>
          <SurfaceChip status="live">Claude Code</SurfaceChip>
          <SurfaceChip status="live">Cursor</SurfaceChip>
          <SurfaceChip status="live">OpenCode</SurfaceChip>
        </div>

        <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_-35px_rgba(1,22,39,0.5)]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-4 py-3">
            <WindowDots />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Home base · live</span>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-[0.8fr_1.2fr] sm:p-6">
            <div className="rounded-xl bg-[#f2f5f8] p-4">
              <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-[#011627]">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#011627] text-[10px] text-white">OW</span>
                OpenWork
              </div>
              <div className="space-y-2 text-xs text-slate-500">
                <div className="rounded-lg bg-white px-3 py-2 font-medium text-slate-800 shadow-sm">Workspace</div>
                <div className="px-3 py-1.5">Sessions</div>
                <div className="px-3 py-1.5">Skills</div>
                <div className="px-3 py-1.5">Connections</div>
              </div>
            </div>
            <div className="flex min-h-52 flex-col justify-between rounded-xl border border-slate-100 bg-white p-4">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">Desktop app</div>
                <div className="text-xl font-semibold tracking-tight text-[#011627]">The complete workspace</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">Files, sessions, skills, services, and the full interface for doing work.</p>
              </div>
              <div className="mt-5 flex items-center justify-between rounded-lg bg-[#f7f9fb] px-3 py-2 text-xs text-slate-500">
                <span>Project workspace</span>
                <span className="font-medium text-emerald-700">Ready</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto h-9 w-px bg-gradient-to-b from-slate-400 to-blue-400" aria-hidden="true" />

        <div className="mx-auto max-w-md rounded-2xl border border-blue-200 bg-[#07192c] p-5 text-white shadow-[0_20px_55px_-32px_rgba(7,25,44,0.9)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-300">Building</div>
              <div className="mt-1 text-base font-semibold">Persistent hosted workspace</div>
            </div>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/10">
              <span className="text-lg">⌁</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] text-slate-300">
            <div className="rounded-lg bg-white/5 px-2 py-2.5">Files</div>
            <div className="rounded-lg bg-white/5 px-2 py-2.5">Runtime</div>
            <div className="rounded-lg bg-white/5 px-2 py-2.5">History</div>
          </div>
        </div>

        <div className="mx-auto h-9 w-px bg-gradient-to-b from-blue-400 to-slate-300" aria-hidden="true" />

        <div className="flex flex-wrap justify-center gap-2.5">
          <SurfaceChip status="next">Slack</SurfaceChip>
          <SurfaceChip status="next">Mobile</SurfaceChip>
          <SurfaceChip status="exploring">Email</SurfaceChip>
          <SurfaceChip status="exploring">Custom agents</SurfaceChip>
        </div>
      </div>
    </div>
  )
}

function RoadmapSectionBlock({ section }: { section: RoadmapSection }) {
  return (
    <section id={section.id} className="scroll-mt-24 border-t border-slate-200 py-14 md:py-20">
      <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-600">{section.eyebrow}</div>
          <h2 className="max-w-md text-3xl font-medium leading-[1.05] tracking-[-0.035em] text-[#011627] sm:text-4xl md:text-5xl">
            {section.title}
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-600">{section.description}</p>
          {section.callout ? (
            <p className="mt-6 max-w-lg border-l-2 border-blue-400 pl-4 text-sm font-medium leading-6 text-slate-700">
              {section.callout}
            </p>
          ) : null}
        </div>

        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {section.items.map((item) => (
            <article key={item.title} className="py-5 first:pt-0 last:pb-0 md:py-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="pr-4">
                  <h3 className="text-base font-semibold tracking-tight text-[#011627] md:text-lg">{item.title}</h3>
                  <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-500">{item.description}</p>
                </div>
                <StatusBadge status={item.status} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export function OpenWorkRoadmap({
  feedbackHref = "https://openworklabs.com/feedback?source=roadmap",
  docsHref = "https://openworklabs.com/docs",
}: {
  feedbackHref?: string
  docsHref?: string
}) {
  const statuses: RoadmapStatus[] = ["live", "building", "next", "exploring"]

  return (
    <div data-testid="openwork-roadmap" className="text-[#011627]">
      <section className="pb-14 pt-10 md:pb-20 md:pt-16">
        <div className="mb-7 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm">
            OpenWork roadmap
          </span>
          <span className="text-xs text-slate-500">Updated July 2026</span>
        </div>

        <h1 className="max-w-4xl text-5xl font-medium leading-[0.98] tracking-[-0.05em] text-[#011627] sm:text-6xl md:text-7xl lg:text-[5.5rem]">
          your workspace,
          <br />
          <span className="text-blue-600">on every surface.</span>
        </h1>

        <div className="mt-8 grid gap-6 text-base leading-7 text-slate-600 md:grid-cols-2 md:text-lg md:leading-8">
          <p>
            Most people use OpenWork through the desktop app today. It is where you create a workspace, work with files, connect services, add skills, and customize how your agent works.
          </p>
          <p>
            What you create there should not stay trapped there. OpenWork Connect already brings the same capabilities into compatible agents. Next come persistent hosted workspaces, Slack, mobile, and more.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3 border-y border-slate-200 py-4">
          {statuses.map((status) => {
            const details = statusDetails[status]
            return (
              <div key={status} className="flex items-center gap-2 text-xs text-slate-500" title={details.description}>
                <span className={`h-2 w-2 rounded-full ${details.dotClassName}`} />
                <span className="font-semibold text-slate-700">{details.label}</span>
                <span className="hidden sm:inline">{details.description}</span>
              </div>
            )
          })}
        </div>
      </section>

      <SurfaceMap />

      <div className="mt-10 md:mt-16">
        {roadmapSections.map((section) => (
          <RoadmapSectionBlock key={section.id} section={section} />
        ))}
      </div>

      <section id="specifications" className="scroll-mt-24 rounded-[2.5rem] bg-[#07192c] px-6 py-12 text-white sm:px-8 md:px-12 md:py-16">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-300">Open for discussion</div>
            <h2 className="text-3xl font-medium leading-[1.05] tracking-[-0.035em] sm:text-4xl md:text-5xl">upcoming specifications</h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
              We plan to publish the interfaces behind the roadmap so the community can build with them, question them, and help shape them before they settle.
            </p>
          </div>

          <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2">
            {roadmapSpecs.map((spec) => (
              <article key={spec.number} className="bg-[#0b2036] p-5 md:p-6">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-300">Draft {spec.number}</div>
                <h3 className="mt-3 text-lg font-semibold tracking-tight text-white">{spec.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{spec.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 text-center md:py-24">
        <div className="mx-auto max-w-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-600">Help shape what comes next</div>
          <h2 className="mt-4 text-3xl font-medium tracking-[-0.035em] sm:text-4xl md:text-5xl">what should OpenWork build next?</h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-600">
            Tell us which workflow, workspace, or surface would make the biggest difference to how you work.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href={feedbackHref}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#011627] px-6 text-sm font-medium text-white shadow-[0_14px_32px_-16px_rgba(1,22,39,0.55)] transition hover:-translate-y-0.5 hover:bg-[#102638]"
            >
              Share feedback
            </a>
            <a
              href={docsHref}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300"
            >
              Read the docs
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
