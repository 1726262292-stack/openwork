"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useDenFlow } from "../../../../_providers/den-flow-provider";
import {
  formatRoleLabel,
  getManageMembersRoute,
  getOrgDashboardRoute,
} from "../../../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m2 4 4 4 4-4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </svg>
  );
}

function OrgMark({ name }: { name: string }) {
  const initials = useMemo(() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return (parts[0]?.slice(0, 1) ?? "O") + (parts[1]?.slice(0, 1) ?? "");
  }, [name]);

  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#011627] text-sm font-semibold uppercase tracking-[0.08em] text-white">
      {initials}
    </div>
  );
}

export function OrgDashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useDenFlow();
  const {
    activeOrg,
    orgDirectory,
    orgBusy,
    orgError,
    mutationBusy,
    createOrganization,
    switchOrganization,
  } = useOrgDashboard();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [orgNameDraft, setOrgNameDraft] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const navItems = [
    { href: activeOrg ? getOrgDashboardRoute(activeOrg.slug) : "#", label: "Dashboard" },
    { href: activeOrg ? getManageMembersRoute(activeOrg.slug) : "#", label: "Manage members" },
    { href: "/checkout", label: "Billing" },
  ];

  return (
    <section className="flex min-h-screen min-h-dvh w-full bg-[var(--dls-app-bg)] md:flex-row">
      <aside className="w-full shrink-0 border-b border-[var(--dls-border)] bg-white/70 md:w-[304px] md:border-b-0 md:border-r">
        <div className="flex h-full flex-col gap-5 p-4 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="den-eyebrow">OpenWork Den</p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-[var(--dls-text-primary)]">Workspace</p>
            </div>
            {orgBusy ? <span className="text-xs text-[var(--dls-text-secondary)]">Refreshing...</span> : null}
          </div>

          <div className="relative">
            <button
              type="button"
              className="den-frame-soft flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
              onClick={() => setSwitcherOpen((current) => !current)}
            >
              <div className="flex min-w-0 items-center gap-3">
                <OrgMark name={activeOrg?.name ?? "OpenWork"} />
                <div className="min-w-0">
                  <p className="den-eyebrow">Organization</p>
                  <p className="truncate text-base font-semibold tracking-tight text-[var(--dls-text-primary)]">
                    {activeOrg?.name ?? "Loading..."}
                  </p>
                  <p className="truncate text-xs text-[var(--dls-text-secondary)]">
                    {activeOrg ? formatRoleLabel(activeOrg.role) : "Preparing workspace"}
                  </p>
                </div>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--dls-text-secondary)] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_0_rgba(0,0,0,0.04)]">
                <ChevronDownIcon />
              </span>
            </button>

            {switcherOpen ? (
              <div className="den-frame absolute left-0 right-0 top-[calc(100%+0.75rem)] z-30 grid gap-4 p-4">
                <div className="grid gap-2">
                  <p className="den-eyebrow">Switch organization</p>
                  <div className="grid gap-2">
                    {orgDirectory.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => {
                          setSwitcherOpen(false);
                          switchOrganization(org.slug);
                        }}
                        className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition ${
                          org.isActive
                            ? "bg-white text-[var(--dls-text-primary)] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_0_rgba(0,0,0,0.04)]"
                            : "bg-[var(--dls-sidebar)] text-[var(--dls-text-secondary)] hover:text-[var(--dls-text-primary)]"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{org.name}</span>
                          <span className="block truncate text-xs">{formatRoleLabel(org.role)}</span>
                        </span>
                        {org.isActive ? <span className="den-status-pill is-neutral">Current</span> : null}
                      </button>
                    ))}
                  </div>
                </div>

                <form
                  className="den-frame-inset grid gap-3 rounded-[1.5rem] p-4"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setCreateError(null);
                    try {
                      await createOrganization(orgNameDraft);
                      setOrgNameDraft("");
                      setSwitcherOpen(false);
                    } catch (error) {
                      setCreateError(error instanceof Error ? error.message : "Could not create organization.");
                    }
                  }}
                >
                  <label className="grid gap-2">
                    <span className="den-label">Create organization</span>
                    <input
                      type="text"
                      value={orgNameDraft}
                      onChange={(event) => setOrgNameDraft(event.target.value)}
                      placeholder="Acme Labs"
                      className="den-input"
                    />
                  </label>
                  <button
                    type="submit"
                    className="den-button-primary"
                    disabled={mutationBusy === "create-organization"}
                  >
                    <PlusIcon />
                    {mutationBusy === "create-organization" ? "Creating..." : "Create organization"}
                  </button>
                  {createError ? <p className="text-xs font-medium text-rose-600">{createError}</p> : null}
                </form>
              </div>
            ) : null}
          </div>

          <div className="den-frame-soft grid gap-3 p-3">
            <div className="px-2 pt-1">
              <p className="den-eyebrow">Navigation</p>
            </div>
            <nav className="grid gap-1.5">
              {navItems.map((item) => {
                const selected = item.href !== "#" && pathname === item.href;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`rounded-full px-4 py-3 text-sm font-medium transition ${
                      selected
                        ? "bg-white text-[var(--dls-text-primary)] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_0_rgba(0,0,0,0.04)]"
                        : "text-[var(--dls-text-secondary)] hover:text-[var(--dls-text-primary)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="mt-auto den-frame-soft grid gap-3 p-4">
            <div>
              <p className="den-eyebrow">Signed in as</p>
              <p className="mt-2 break-words text-sm font-medium text-[var(--dls-text-primary)]">
                {user?.email ?? "Unknown user"}
              </p>
              {orgError ? <p className="mt-3 text-xs font-medium text-rose-600">{orgError}</p> : null}
            </div>
            <button
              type="button"
              className="den-button-secondary w-full"
              onClick={() => void signOut()}
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main className="min-h-screen min-h-dvh flex-1">{children}</main>
    </section>
  );
}
