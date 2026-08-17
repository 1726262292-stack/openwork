"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, ExternalLink, History, Link2, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenChip } from "../../_components/ui/chip";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenPageHeader } from "../../_components/ui/page-header";
import { getPluginRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
  downloadPluginMcpAppRevision,
  useActivatePluginMcpApp,
  usePluginMcpApp,
  usePluginMcpAppLifecycle,
  usePreviewPluginMcpApp,
  useRefreshPluginMcpApp,
} from "./plugin-mcp-app-data";

function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

/**
 * Plugin-scoped detail view for one installed MCP App: active immutable
 * revision, source origin, validation status, refresh/update review flow,
 * revision activation and rollback, and non-destructive retirement.
 */
export function PluginMcpAppDetailScreen({ pluginId, appId }: { pluginId: string; appId: string }) {
  const { orgContext, orgSlug } = useOrgDashboard();
  const appQuery = usePluginMcpApp(appId);
  const preview = usePreviewPluginMcpApp();
  const refresh = useRefreshPluginMcpApp(appId, pluginId);
  const activate = useActivatePluginMcpApp(appId, pluginId);
  const lifecycle = usePluginMcpAppLifecycle(appId, pluginId);
  const [refreshUrl, setRefreshUrl] = useState("");
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<Error | null>(null);
  const [retireConfirmOpen, setRetireConfirmOpen] = useState(false);
  const app = appQuery.data;
  const pluginMcpAppsEnabled = orgContext?.capabilities.pluginMcpApps === true;

  useEffect(() => {
    if (!app) return;
    setRefreshUrl(app.sourceUrl);
  }, [app?.id, app?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const canEdit = app?.role === "editor" || app?.role === "manager";
  const canManage = app?.role === "manager";
  const operationError = preview.error ?? refresh.error ?? activate.error ?? lifecycle.error ?? downloadError;

  if (!pluginMcpAppsEnabled) {
    return (
      <div className="mx-auto max-w-[860px] px-6 py-10">
        <DenNotice tone="warning" message="Plugin-installed MCP Apps are not enabled for this organization." />
      </div>
    );
  }
  if (appQuery.isLoading && !app) {
    return <div className="mx-auto max-w-[860px] px-6 py-10 text-[13px] text-gray-400">Loading MCP App…</div>;
  }
  if (!app || app.pluginId !== pluginId) {
    return (
      <div className="mx-auto max-w-[860px] px-6 py-10">
        <DenNotice tone="error" message={appQuery.error?.message ?? "That MCP App could not be found in this plugin."} />
      </div>
    );
  }

  const metadata = app.activeRevision?.metadata ?? app.latestRevision?.metadata;
  if (!metadata) {
    return (
      <div className="mx-auto max-w-[860px] px-6 py-10">
        <DenNotice tone="error" message="This installation has no readable app revision." />
      </div>
    );
  }
  const installedAppId = app.id;
  const safeDownloadName = metadata.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const updateAvailable = app.latestRevision !== null
    && app.activeRevision !== null
    && app.latestRevision.id !== app.activeRevision.id;

  async function cacheRefresh() {
    await refresh.mutateAsync({ sourceUrl: refreshUrl });
    preview.reset();
  }

  async function downloadRevision(versionId: string) {
    setDownloadingVersionId(versionId);
    setDownloadError(null);
    try {
      await downloadPluginMcpAppRevision(installedAppId, versionId, `${safeDownloadName || "mcp-app"}.html`);
    } catch (error) {
      setDownloadError(error instanceof Error ? error : new Error("The cached app could not be downloaded."));
    } finally {
      setDownloadingVersionId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-6 py-8 md:px-8" data-plugin-mcp-app-detail={app.id}>
      <Link
        href={getPluginRoute(orgSlug, pluginId)}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-gray-400 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to plugin
      </Link>
      <DenPageHeader
        title={metadata.name}
        description={metadata.description ?? "An MCP App installed into this plugin and served by OpenWork."}
        action={(
          <div className="flex items-center gap-2">
            <DenChip tone={app.status === "active" ? "success" : "warning"}>{app.status === "active" ? "Ready" : "Retired"}</DenChip>
            <DenChip tone="neutral">v{metadata.version}</DenChip>
            {updateAvailable ? <DenChip tone="info">Update cached</DenChip> : null}
          </div>
        )}
        className="mb-8"
      />

      {operationError ? <div className="mb-5"><DenNotice tone="error" message={operationError.message} /></div> : null}

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-semibold text-gray-900">Installed copy</h2>
            <p className="mt-1 text-[12px] leading-5 text-gray-500">The active App runs from this immutable OpenWork resource, not from its source URL.</p>
          </div>
          {app.activeRevision ? (
            <DenButton
              variant="secondary"
              size="sm"
              icon={Download}
              loading={downloadingVersionId === app.activeRevision.id}
              onClick={() => void downloadRevision(app.activeRevision!.id)}
              data-testid="plugin-mcp-app-download"
            >
              Download cached app
            </DenButton>
          ) : null}
        </div>
        {app.activeRevision ? (
          <dl className="mt-5 grid gap-4 text-[12px] sm:grid-cols-2">
            <div><dt className="text-gray-400">Immutable resource</dt><dd className="mt-1 break-all font-mono text-[11px] text-gray-700">{app.activeRevision.resourceUri}</dd></div>
            <div><dt className="text-gray-400">SHA-256 digest</dt><dd className="mt-1 break-all font-mono text-[11px] text-gray-700">{app.activeRevision.resource.digest}</dd></div>
            <div><dt className="text-gray-400">Cached</dt><dd className="mt-1 text-gray-700">{timestamp(app.activeRevision.createdAt)} · {Math.ceil(app.activeRevision.resource.byteSize / 1024)} KiB</dd></div>
            <div><dt className="text-gray-400">Source origin</dt><dd className="mt-1 truncate text-gray-700" title={app.sourceUrl}>{app.sourceUrl}</dd></div>
            <div><dt className="text-gray-400">Last validation</dt><dd className="mt-1 text-gray-700">{app.activeRevision.diagnostics[0] ?? "Self-contained HTML validated."}</dd></div>
            <div><dt className="text-gray-400">Runtime policy</dt><dd className="mt-1 inline-flex items-center gap-1.5 text-gray-700"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Closed network and resource CSP</dd></div>
          </dl>
        ) : <DenNotice tone="warning" message="This app has no active revision." />}
      </section>

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[14px] font-semibold text-gray-900">Standard MCP App delivery</h2>
        <p className="mt-1 text-[12px] leading-5 text-gray-500">
          OpenWork exposes this immutable HTML as a standard MCP App on the central OpenWork Connect server: an app-visible launch tool binds the exact ui:// revision, and any standards-compliant MCP Apps host can render it. The rendered App discovers and executes your authorized capabilities only through capability search on that same connection.
        </p>
      </section>

      {canEdit && app.status === "active" ? (
        <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-4 w-4 text-blue-600" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-semibold text-gray-900">Refresh from source</h2>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">Review the published file, then cache it as a new immutable draft. The active revision does not change until you activate the draft.</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1"><DenInput icon={Link2} value={refreshUrl} onChange={(event) => setRefreshUrl(event.target.value)} /></div>
                {!preview.data ? (
                  <DenButton variant="secondary" icon={ExternalLink} loading={preview.isPending} onClick={() => preview.mutate(refreshUrl)} data-testid="plugin-mcp-app-review-update">Review update</DenButton>
                ) : (
                  <DenButton icon={Check} loading={refresh.isPending} onClick={() => void cacheRefresh()} data-testid="plugin-mcp-app-cache-draft">Cache draft</DenButton>
                )}
              </div>
              {preview.data ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-[12px] text-blue-900">
                  <span>Validated {preview.data.metadata.name} v{preview.data.metadata.version} · {Math.ceil(preview.data.resource.byteSize / 1024)} KiB · activation remains unchanged</span>
                  <button type="button" onClick={() => preview.reset()} className="font-semibold">Cancel review</button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2"><History className="h-4 w-4 text-gray-500" /><h2 className="text-[14px] font-semibold text-gray-900">Immutable revisions</h2></div>
        <div className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-100">
          {app.revisions.map((revision, index) => (
            <div key={revision.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4" data-plugin-mcp-app-revision={revision.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-gray-800">{revision.metadata.name} v{revision.metadata.version}</span>
                  {revision.active ? <DenChip tone="success">Active</DenChip> : index === 0 ? <DenChip tone="info">Latest draft</DenChip> : null}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">{timestamp(revision.createdAt)} · <span className="font-mono">{revision.resource.digest.slice(0, 22)}…</span></p>
              </div>
              <div className="flex items-center gap-2">
                <DenButton size="xs" variant="ghost" loading={downloadingVersionId === revision.id} onClick={() => void downloadRevision(revision.id)}>Download</DenButton>
                {canEdit && !revision.active && app.status === "active" ? (
                  <DenButton size="xs" variant="secondary" icon={RotateCcw} loading={activate.isPending} onClick={() => activate.mutate({ versionId: revision.id })}>
                    {index === 0 ? "Activate" : "Roll back"}
                  </DenButton>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {canManage ? (
        <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-[13px] font-semibold text-gray-800">{app.status === "active" ? "Retire this app" : "Restore this app"}</h2>
              <p className="mt-1 text-[12px] text-gray-500">{app.status === "active" ? "Removes it from capability search and launch without deleting cached revisions." : "Makes the active revision discoverable and launchable again."}</p>
            </div>
            {app.status === "active" && !retireConfirmOpen ? (
              <DenButton variant="destructive" onClick={() => setRetireConfirmOpen(true)} data-testid="plugin-mcp-app-retire">
                Retire app
              </DenButton>
            ) : app.status === "active" ? (
              <div className="flex items-center gap-2">
                <DenButton variant="ghost" onClick={() => setRetireConfirmOpen(false)}>Cancel</DenButton>
                <DenButton
                  variant="destructive"
                  loading={lifecycle.isPending}
                  onClick={() => {
                    lifecycle.mutate({ action: "retire" });
                    setRetireConfirmOpen(false);
                  }}
                  data-testid="plugin-mcp-app-retire-confirm"
                >
                  Confirm retire
                </DenButton>
              </div>
            ) : (
              <DenButton variant="secondary" loading={lifecycle.isPending} onClick={() => lifecycle.mutate({ action: "restore" })} data-testid="plugin-mcp-app-restore">
                Restore app
              </DenButton>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
