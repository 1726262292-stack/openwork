"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getErrorMessage, requestJson } from "../../../../_lib/den-flow";
import { getManageMembersRoute } from "../../../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

type TemplateCard = {
  id: string;
  name: string;
  createdAt: string | null;
  creator: {
    name: string;
    email: string;
  };
};

function asTemplateCard(value: unknown): TemplateCard | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const creator = entry.creator && typeof entry.creator === "object"
    ? (entry.creator as Record<string, unknown>)
    : null;

  if (
    typeof entry.id !== "string" ||
    typeof entry.name !== "string" ||
    !creator ||
    typeof creator.name !== "string" ||
    typeof creator.email !== "string"
  ) {
    return null;
  }

  return {
    id: entry.id,
    name: entry.name,
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
    creator: {
      name: creator.name,
      email: creator.email,
    },
  };
}

export function TemplatesDashboardScreen() {
  const { orgSlug, activeOrg, orgContext } = useOrgDashboard();
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canDelete = orgContext?.currentMember.isOwner ?? false;
  const pendingInvitations = useMemo(
    () => (orgContext?.invitations ?? []).filter((invitation) => invitation.status === "pending"),
    [orgContext?.invitations],
  );

  async function loadTemplates() {
    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson(
        `/v1/orgs/${encodeURIComponent(orgSlug)}/templates`,
        { method: "GET" },
        12000,
      );

      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to load templates (${response.status}).`));
      }

      const list =
        payload && typeof payload === "object" && Array.isArray((payload as { templates?: unknown[] }).templates)
          ? (payload as { templates: unknown[] }).templates
          : [];

      setTemplates(list.map(asTemplateCard).filter((entry): entry is TemplateCard => entry !== null));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load templates.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(templateId: string) {
    setDeletingId(templateId);
    setError(null);
    try {
      const { response, payload } = await requestJson(
        `/v1/orgs/${encodeURIComponent(orgSlug)}/templates/${encodeURIComponent(templateId)}`,
        { method: "DELETE" },
        12000,
      );

      if (response.status !== 204 && !response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to delete template (${response.status}).`));
      }

      await loadTemplates();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete template.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void loadTemplates();
  }, [orgSlug]);

  return (
    <section className="den-page flex max-w-6xl flex-col gap-6 py-4 md:py-8">
      <div className="den-frame grid gap-6 p-6 md:p-8 lg:p-10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3">
            <p className="den-eyebrow">Den dashboard</p>
            <h1 className="den-title-xl max-w-[11ch]">{activeOrg?.name ?? "OpenWork"}</h1>
            <p className="den-copy max-w-2xl">
              Share setup once, keep team access tidy, and manage the links your
              organization actually uses.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href={getManageMembersRoute(orgSlug)} className="den-button-secondary">
              Manage members
            </Link>
            <Link href="/checkout" className="den-button-primary">
              Billing
            </Link>
          </div>
        </div>

        <div className="den-stat-grid">
          <div className="den-stat-card">
            <p className="den-stat-label">Members</p>
            <p className="den-stat-value">{orgContext?.members.length ?? 0}</p>
            <p className="den-stat-copy">Everyone who can access this workspace.</p>
          </div>
          <div className="den-stat-card">
            <p className="den-stat-label">Pending invites</p>
            <p className="den-stat-value">{pendingInvitations.length}</p>
            <p className="den-stat-copy">Invites waiting to be accepted.</p>
          </div>
          <div className="den-stat-card">
            <p className="den-stat-label">Shared links</p>
            <p className="den-stat-value">{templates.length}</p>
            <p className="den-stat-copy">Setup packages created from the desktop app.</p>
          </div>
        </div>
      </div>

      {error ? <div className="den-notice is-error">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="den-list-shell">
          <div className="flex flex-col gap-2 px-5 py-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="den-eyebrow">Shared setup links</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--dls-text-primary)]">
                Current workspace templates
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-[var(--dls-text-secondary)] md:text-right">
              Create new links from the OpenWork desktop app. Keep only the
              setups your team still needs.
            </p>
          </div>

          {busy ? (
            <div className="den-list-row text-sm text-[var(--dls-text-secondary)]">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="den-list-row text-sm text-[var(--dls-text-secondary)]">
              No shared links yet. Create one from the desktop app and it will
              appear here.
            </div>
          ) : (
            templates.map((template) => (
              <article key={template.id} className="den-list-row">
                <div className="grid gap-1">
                  <h3 className="text-base font-semibold text-[var(--dls-text-primary)]">{template.name}</h3>
                  <p className="text-sm text-[var(--dls-text-secondary)]">
                    Created by {template.creator.name} · {template.creator.email}
                  </p>
                  <p className="text-xs text-[var(--dls-text-secondary)]">
                    {template.createdAt ? `Created ${new Date(template.createdAt).toLocaleString()}` : "Created recently"}
                  </p>
                </div>

                {canDelete ? (
                  <button
                    type="button"
                    className="den-button-danger shrink-0"
                    onClick={() => void deleteTemplate(template.id)}
                    disabled={deletingId === template.id}
                  >
                    {deletingId === template.id ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>

        <aside className="den-frame-soft grid h-fit gap-4 p-5 md:p-6">
          <div className="grid gap-2">
            <p className="den-eyebrow">Quick actions</p>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--dls-text-primary)]">
              Keep the workspace moving.
            </h2>
            <p className="den-copy text-sm">
              Invite teammates, review billing, or clean up old links without
              leaving this area.
            </p>
          </div>

          <Link href={getManageMembersRoute(orgSlug)} className="den-button-secondary w-full">
            Add or edit members
          </Link>
          <Link href="/checkout" className="den-button-secondary w-full">
            Open billing
          </Link>
          <a href="https://openworklabs.com/download" className="den-button-secondary w-full">
            Download desktop app
          </a>
        </aside>
      </div>
    </section>
  );
}
