"use client";

import Link from "next/link";
import { useState } from "react";
import { requestJson, getErrorMessage } from "../../../../_lib/den-flow";
import { getMembersRoute } from "../../../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { OPENWORK_DOCS_URL, useOrgTemplates } from "./shared-setup-data";

export function SharedSetupsScreen() {
  const { orgSlug, activeOrg, orgContext } = useOrgDashboard();
  const { templates, busy, error, reloadTemplates } = useOrgTemplates(orgSlug);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canDelete = orgContext?.currentMember.isOwner ?? false;

  async function deleteTemplate(templateId: string) {
    setDeletingId(templateId);
    setDeleteError(null);
    try {
      const { response, payload } = await requestJson(
        `/v1/orgs/${encodeURIComponent(orgSlug)}/templates/${encodeURIComponent(templateId)}`,
        { method: "DELETE" },
        12000,
      );

      if (response.status !== 204 && !response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to delete template (${response.status}).`));
      }

      await reloadTemplates();
    } catch (nextError) {
      setDeleteError(nextError instanceof Error ? nextError.message : "Failed to delete template.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="den-page flex max-w-6xl flex-col gap-6 py-4 md:py-8">
      <div className="den-frame grid gap-6 p-6 md:p-8 lg:p-10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3">
            <p className="den-eyebrow">OpenWork Cloud</p>
            <h1 className="den-title-xl max-w-[12ch]">Shared setups</h1>
            <p className="den-copy max-w-2xl">
              Create and update shared templates your team can use right away.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <a href={OPENWORK_DOCS_URL} target="_blank" rel="noreferrer" className="den-button-secondary">
              Learn how
            </a>
            <Link href={getMembersRoute(orgSlug)} className="den-button-secondary">
              Members
            </Link>
            <a href="https://openworklabs.com/download" className="den-button-primary">
              Use desktop app
            </a>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="den-stat-card">
            <p className="den-stat-label">Organization</p>
            <p className="den-stat-value text-[1.4rem] md:text-[1.6rem]">{activeOrg?.name ?? "OpenWork"}</p>
            <p className="den-stat-copy">Shared templates stay available to this team.</p>
          </div>
          <div className="den-stat-card">
            <p className="den-stat-label">Templates</p>
            <p className="den-stat-value">{templates.length}</p>
            <p className="den-stat-copy">Current shared setups created from the desktop app.</p>
          </div>
          <div className="den-stat-card">
            <p className="den-stat-label">Members</p>
            <p className="den-stat-value">{orgContext?.members.length ?? 0}</p>
            <p className="den-stat-copy">Teammates who can use these shared templates.</p>
          </div>
        </div>
      </div>

      {error ? <div className="den-notice is-error">{error}</div> : null}
      {deleteError ? <div className="den-notice is-error">{deleteError}</div> : null}

      <div className="den-list-shell">
        <div className="flex flex-col gap-2 px-5 py-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="den-eyebrow">Template library</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--dls-text-primary)]">
              Team templates
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-[var(--dls-text-secondary)] md:text-right">
            Review what your team is sharing now, and remove templates that are no longer current.
          </p>
        </div>

        {busy ? (
          <div className="den-list-row text-sm text-[var(--dls-text-secondary)]">Loading shared setups...</div>
        ) : templates.length === 0 ? (
          <div className="den-list-row text-sm text-[var(--dls-text-secondary)]">
            No shared setups yet. Create one from the OpenWork desktop app and it will appear here.
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
                  {template.createdAt ? `Updated ${new Date(template.createdAt).toLocaleString()}` : "Updated recently"}
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
    </section>
  );
}
