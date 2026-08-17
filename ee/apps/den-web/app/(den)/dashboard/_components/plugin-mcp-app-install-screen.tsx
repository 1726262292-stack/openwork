"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Download, Link2, PackagePlus, ShieldCheck } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenChip } from "../../_components/ui/chip";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenPageHeader } from "../../_components/ui/page-header";
import { getPluginMcpAppRoute, getPluginRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { usePlugin } from "./plugin-data";
import { useInstallPluginMcpApp, usePreviewPluginMcpApp } from "./plugin-mcp-app-data";

/**
 * Plugin-scoped MCP App installation: pick a URL, review the validated
 * immutable copy, and confirm. The owning Plugin is fixed by the route —
 * installing an App is a Plugin-management action exactly like adding a
 * skill, never a global library action.
 */
export function PluginMcpAppInstallScreen({ pluginId }: { pluginId: string }) {
  const router = useRouter();
  const { orgContext, orgSlug } = useOrgDashboard();
  const pluginQuery = usePlugin(pluginId);
  const preview = usePreviewPluginMcpApp();
  const install = useInstallPluginMcpApp(pluginId);
  const [sourceUrl, setSourceUrl] = useState("");
  const plugin = pluginQuery.data;
  const pluginMcpAppsEnabled = orgContext?.capabilities.pluginMcpApps === true;

  async function handleInstall() {
    const app = await install.mutateAsync({ sourceUrl });
    router.push(getPluginMcpAppRoute(orgSlug, pluginId, app.id));
  }

  if (!pluginMcpAppsEnabled) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <DenNotice tone="warning" message="Plugin-installed MCP Apps are not enabled for this organization." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-6 py-8 md:px-8" data-plugin-mcp-app-install>
      <Link
        href={getPluginRoute(orgSlug, pluginId)}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-gray-400 transition hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to plugin
      </Link>
      <DenPageHeader
        title={preview.data ? "Review the cached app" : "Add MCP App by URL"}
        description={plugin
          ? `The App is installed into "${plugin.name}" and shared with everyone who can use that plugin.`
          : "The App is installed into this plugin and shared with everyone who can use it."}
        className="mb-6"
      />

      {!preview.data ? (
        <div className="space-y-5">
          <div>
            <label htmlFor="plugin-mcp-app-url" className="mb-2 block text-[12px] font-semibold text-gray-700">
              Published app URL
            </label>
            <DenInput
              id="plugin-mcp-app-url"
              type="url"
              icon={Link2}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.com/project-explorer.html"
              data-testid="plugin-mcp-app-source-url"
            />
            <p className="mt-2 text-[12px] leading-5 text-gray-400">
              One self-contained HTML file with inline JavaScript and CSS, served over HTTPS. Maximum 768 KiB.
              OpenWork downloads one immutable copy; the source URL is never needed when the installed App runs.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [Download, "Downloaded once", "Redirects and private-network targets are checked."],
              [ShieldCheck, "Closed sandbox", "No direct network, subframes, or external resources."],
              [PackagePlus, "Plugin-owned", "Availability follows this plugin's access grants."],
            ].map(([Icon, title, copy]) => {
              const TileIcon = Icon as typeof Download;
              return (
                <div key={String(title)} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                  <TileIcon className="mb-2 h-4 w-4 text-blue-600" />
                  <p className="text-[12px] font-semibold text-gray-800">{String(title)}</p>
                  <p className="mt-1 text-[11px] leading-4 text-gray-500">{String(copy)}</p>
                </div>
              );
            })}
          </div>
          {preview.error ? <DenNotice tone="error" message={preview.error.message} /> : null}
          <div className="flex justify-end gap-2">
            <DenButton
              icon={Download}
              loading={preview.isPending}
              disabled={!sourceUrl.trim()}
              onClick={() => preview.mutate(sourceUrl)}
              data-testid="plugin-mcp-app-preview"
            >
              Download and review
            </DenButton>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[17px] font-semibold text-gray-950">{preview.data.metadata.name}</h3>
                  <DenChip tone="neutral">v{preview.data.metadata.version}</DenChip>
                </div>
                {preview.data.metadata.description ? (
                  <p className="mt-1.5 text-[13px] text-gray-500">{preview.data.metadata.description}</p>
                ) : null}
              </div>
              <DenChip tone="success"><Check className="mr-1 h-3 w-3" />Validated</DenChip>
            </div>
            <dl className="mt-4 grid gap-3 text-[11px] sm:grid-cols-2">
              <div>
                <dt className="text-gray-400">Cached size</dt>
                <dd className="mt-1 font-medium text-gray-700">{Math.ceil(preview.data.resource.byteSize / 1024)} KiB</dd>
              </div>
              <div>
                <dt className="text-gray-400">SHA-256 digest</dt>
                <dd className="mt-1 truncate font-mono text-gray-700" title={preview.data.resource.digest}>{preview.data.resource.digest}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-400">Resolved source</dt>
                <dd className="mt-1 truncate text-gray-700" title={preview.data.resolvedSourceUrl}>{preview.data.resolvedSourceUrl}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-400">Security</dt>
                <dd className="mt-1 inline-flex items-center gap-1.5 text-gray-700">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Self-contained HTML with a closed network and resource CSP
                </dd>
              </div>
            </dl>
          </div>

          <DenNotice tone="info" message="OpenWork serves this cached HTML as a standard MCP App from the central OpenWork Connect server. The rendered App can search and execute your authorized capabilities through that same connection; it never receives credentials or direct provider access." />
          {install.error ? <DenNotice tone="error" message={install.error.message} /> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-5">
            <DenButton variant="ghost" icon={ArrowLeft} onClick={() => preview.reset()}>Use another URL</DenButton>
            <DenButton
              icon={PackagePlus}
              loading={install.isPending}
              onClick={() => void handleInstall()}
              data-testid="plugin-mcp-app-install"
            >
              Install into plugin
            </DenButton>
          </div>
        </div>
      )}
    </div>
  );
}
