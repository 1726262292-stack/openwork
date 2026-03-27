"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  OPENWORK_APP_CONNECT_BASE_URL,
  buildOpenworkAppConnectUrl,
  buildOpenworkDeepLink,
  getErrorMessage,
  getWorkerStatusMeta,
  getWorkerTokens,
  requestJson,
  type WorkerStatusBucket,
} from "../../../../_lib/den-flow";
import { useDenFlow } from "../../../../_providers/den-flow-provider";
import { getSharedSetupsRoute } from "../../../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
  formatTemplateTimestamp,
  useOrgTemplates,
} from "./shared-setup-data";

type ConnectionDetails = {
  openworkUrl: string | null;
  ownerToken: string | null;
  clientToken: string | null;
  openworkAppConnectUrl: string | null;
  openworkDeepLink: string | null;
};

const statusOptions: Array<{ label: string; value: WorkerStatusBucket | "all" }> = [
  { label: "All", value: "all" },
  { label: "Ready", value: "ready" },
  { label: "Starting", value: "starting" },
  { label: "Attention", value: "attention" },
];

function getTemplateAccent(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) % 360;
  }

  return {
    background: `hsl(${hash} 92% 96%)`,
    gradient: `radial-gradient(circle at 30% 30%, hsl(${(hash + 60) % 360} 92% 68%), hsl(${hash} 82% 48%), hsl(${(hash + 140) % 360} 88% 28%))`,
  };
}

export function BackgroundAgentsScreen() {
  const router = useRouter();
  const { orgSlug } = useOrgDashboard();
  const { templates } = useOrgTemplates(orgSlug);
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);
  const [connectBusyWorkerId, setConnectBusyWorkerId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [connectionDetailsByWorkerId, setConnectionDetailsByWorkerId] = useState<
    Record<string, ConnectionDetails>
  >({});
  const [showTemplatesBanner, setShowTemplatesBanner] = useState(true);
  const {
    filteredWorkers,
    workerQuery,
    setWorkerQuery,
    workerStatusFilter,
    setWorkerStatusFilter,
    workersBusy,
    workersLoadedOnce,
    workersError,
    launchBusy,
    launchWorker,
    renameWorker,
    renameBusyWorkerId,
  } = useDenFlow();

  async function handleAddSandbox() {
    const result = await launchWorker({ source: "manual" });
    if (result === "checkout") {
      router.push("/checkout");
    }
  }

  async function copyValue(field: string, value: string | null) {
    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => {
      setCopiedField((current) => (current === field ? null : current));
    }, 1500);
  }

  async function loadConnectionDetails(workerId: string, workerName: string) {
    setConnectBusyWorkerId(workerId);
    setConnectError(null);

    try {
      const { response, payload } = await requestJson(
        `/v1/workers/${encodeURIComponent(workerId)}/tokens`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
        12000,
      );

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, `Failed to load connection details (${response.status}).`),
        );
      }

      const tokens = getWorkerTokens(payload);
      if (!tokens) {
        throw new Error("Connection details were missing from the worker response.");
      }

      const nextDetails: ConnectionDetails = {
        openworkUrl: tokens.openworkUrl,
        ownerToken: tokens.ownerToken,
        clientToken: tokens.clientToken,
        openworkAppConnectUrl: buildOpenworkAppConnectUrl(
          OPENWORK_APP_CONNECT_BASE_URL,
          tokens.openworkUrl,
          tokens.clientToken,
          workerId,
          workerName,
          { autoConnect: true },
        ),
        openworkDeepLink: buildOpenworkDeepLink(
          tokens.openworkUrl,
          tokens.clientToken,
          workerId,
          workerName,
        ),
      };

      setConnectionDetailsByWorkerId((current) => ({
        ...current,
        [workerId]: nextDetails,
      }));
      return nextDetails;
    } catch (error) {
      setConnectError(
        error instanceof Error ? error.message : "Failed to load connection details.",
      );
      return null;
    } finally {
      setConnectBusyWorkerId(null);
    }
  }

  async function toggleConnect(workerId: string, workerName: string) {
    if (expandedWorkerId === workerId) {
      setExpandedWorkerId(null);
      return;
    }

    setExpandedWorkerId(workerId);
    if (!connectionDetailsByWorkerId[workerId]) {
      await loadConnectionDetails(workerId, workerName);
    }
  }

  const bannerTemplates = useMemo(() => templates.slice(0, 3), [templates]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 md:px-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.5px] text-gray-900">
            Agents
          </h1>
          <p className="mt-2 text-[14px] text-gray-500">
            Launch cloud sandboxes, connect them to OpenWork, and keep background workflows available for the team.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={getSharedSetupsRoute(orgSlug)}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Browse templates
          </Link>
          <button
            type="button"
            onClick={() => void handleAddSandbox()}
            disabled={launchBusy}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            {launchBusy ? "Adding..." : "New agent"}
          </button>
        </div>
      </div>

      {showTemplatesBanner ? (
        <div className="relative mb-8 rounded-[20px] border border-gray-100 bg-white p-6 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.02)]">
          <button
            type="button"
            onClick={() => setShowTemplatesBanner(false)}
            className="absolute right-4 top-4 text-gray-400 transition-colors hover:text-gray-600"
            aria-label="Dismiss template suggestions"
          >
            <X className="h-4 w-4" />
          </button>

          <h2 className="mb-1 text-[15px] font-semibold text-gray-900">
            Get started with a template
          </h2>
          <p className="mb-5 text-[13px] text-gray-500">
            Build faster with shared setups your team has already created.
          </p>

          {bannerTemplates.length > 0 ? (
            <div className="mb-5 grid gap-4 md:grid-cols-3">
              {bannerTemplates.map((template) => {
                const accent = getTemplateAccent(template.name);
                return (
                  <div
                    key={template.id}
                    className="rounded-xl border border-gray-100 bg-white p-4 transition-all hover:border-gray-200 hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div
                        className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full"
                        style={{ backgroundColor: accent.background }}
                      >
                        <div
                          className="absolute inset-0"
                          style={{ backgroundImage: accent.gradient }}
                        />
                      </div>
                      <span className="truncate text-[13px] font-semibold text-gray-900">
                        {template.name}
                      </span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-gray-500">
                      Created by {template.creator.name}
                    </p>
                    <p className="mt-2 text-[12px] text-gray-400">
                      Updated {formatTemplateTimestamp(template.createdAt, { includeTime: true })}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mb-5 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-[13px] text-gray-500">
              No shared templates yet. Create one first, then launch an agent from it.
            </div>
          )}

          <Link
            href={getSharedSetupsRoute(orgSlug)}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-gray-900 transition-colors hover:text-gray-700"
          >
            Browse all templates <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : null}

      <div className="mb-6">
        <div className="relative mb-4">
          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            value={workerQuery}
            onChange={(event) => setWorkerQuery(event.target.value)}
            placeholder="Search agents..."
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-[14px] text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-900/5"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setWorkerStatusFilter(option.value)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                workerStatusFilter === option.value
                  ? "bg-gray-900 text-white"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {workersError ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {workersError}
        </div>
      ) : null}
      {connectError ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {connectError}
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden border-t border-gray-100">
        <div className="grid grid-cols-[2fr_1.2fr_1.2fr_auto] gap-4 border-b border-gray-100 py-3 text-[12px] font-medium text-gray-500">
          <div>Name</div>
          <div>Provider</div>
          <div>Created at</div>
          <div className="w-8" />
        </div>

        {!workersLoadedOnce ? (
          <div className="py-8 text-[13px] text-gray-500">Loading agents…</div>
        ) : filteredWorkers.length === 0 ? (
          <div className="py-10 text-[13px] text-gray-400">
            {workerQuery.trim()
              ? "No agents match that search yet."
              : "No agents launched yet. Start a new agent to see it here."}
          </div>
        ) : (
          <div className="divide-y divide-gray-50/50">
            {filteredWorkers.map((worker) => {
              const meta = getWorkerStatusMeta(worker.status);
              const canConnect = meta.bucket === "ready";
              const isExpanded = expandedWorkerId === worker.workerId;
              const details = connectionDetailsByWorkerId[worker.workerId] ?? null;
              return (
                <div key={worker.workerId} className="group">
                  <div className="grid grid-cols-[2fr_1.2fr_1.2fr_auto] gap-4 items-center rounded-lg px-2 py-4 transition-colors hover:bg-gray-50/50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-gray-900">
                          {worker.workerName}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                          {meta.label}
                        </span>
                      </div>
                      <p className="truncate text-[12px] text-gray-400">
                        {worker.workerId}
                      </p>
                    </div>

                    <div className="text-[13px] text-gray-500">
                      {worker.provider ? `${worker.provider} sandbox` : "Cloud sandbox"}
                    </div>
                    <div className="text-[13px] text-gray-500">
                      {worker.createdAt
                        ? formatTemplateTimestamp(worker.createdAt, { includeTime: true })
                        : "Recently"}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {canConnect ? (
                        <button
                          type="button"
                          onClick={() => void toggleConnect(worker.workerId, worker.workerName)}
                          className="rounded-full border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-50"
                        >
                          {isExpanded ? "Hide" : "Connect"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          const nextName = window.prompt("Rename sandbox", worker.workerName)?.trim();
                          if (!nextName || nextName === worker.workerName) {
                            return;
                          }
                          void renameWorker(worker.workerId, nextName);
                        }}
                        disabled={renameBusyWorkerId === worker.workerId}
                        className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`Rename ${worker.workerName}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && canConnect ? (
                    <div className="mb-4 rounded-[20px] border border-gray-100 bg-white p-4">
                      <div className="mb-4 flex flex-wrap gap-3">
                        <a
                          href={details?.openworkAppConnectUrl ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className={`rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-gray-800 ${
                            details?.openworkAppConnectUrl ? "" : "pointer-events-none opacity-60"
                          }`}
                        >
                          Open in web
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            if (details?.openworkDeepLink) {
                              window.location.href = details.openworkDeepLink;
                            }
                          }}
                          disabled={!details?.openworkDeepLink}
                          className="rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Open in desktop
                        </button>
                        <button
                          type="button"
                          onClick={() => void loadConnectionDetails(worker.workerId, worker.workerName)}
                          disabled={connectBusyWorkerId === worker.workerId}
                          className="rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {connectBusyWorkerId === worker.workerId ? "Refreshing..." : "Refresh tokens"}
                        </button>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-3">
                        {[
                          {
                            label: "Connection URL",
                            value: details?.openworkUrl ?? worker.instanceUrl ?? "Preparing...",
                            key: `url-${worker.workerId}`,
                          },
                          {
                            label: "Owner token",
                            value: details?.ownerToken ?? "Preparing...",
                            key: `owner-${worker.workerId}`,
                          },
                          {
                            label: "Client token",
                            value: details?.clientToken ?? "Preparing...",
                            key: `client-${worker.workerId}`,
                          },
                        ].map((field) => (
                          <div key={field.key} className="grid gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">
                              {field.label}
                            </span>
                            <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5">
                              <input
                                readOnly
                                value={field.value}
                                className="min-w-0 flex-1 border-none bg-transparent font-mono text-xs text-gray-900 outline-none"
                                onClick={(event) => event.currentTarget.select()}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  void copyValue(
                                    field.key,
                                    field.value === "Preparing..." ? null : field.value,
                                  )
                                }
                                disabled={field.value === "Preparing..."}
                                className="rounded-full border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {copiedField === field.key ? "Copied" : "Copy"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {workersLoadedOnce && workersBusy ? (
        <p className="mt-4 text-[12px] text-gray-400">Refreshing agents…</p>
      ) : null}
    </div>
  );
}
