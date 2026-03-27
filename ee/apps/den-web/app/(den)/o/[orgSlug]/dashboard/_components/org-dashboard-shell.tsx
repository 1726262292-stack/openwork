"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronDown,
  CreditCard,
  Cpu,
  FileText,
  Home,
  LogOut,
  MessageSquare,
  Share2,
  Users,
} from "lucide-react";
import { useDenFlow } from "../../../../_providers/den-flow-provider";
import {
  formatRoleLabel,
  getBackgroundAgentsRoute,
  getBillingRoute,
  getCustomLlmProvidersRoute,
  getMembersRoute,
  getOrgDashboardRoute,
  getSharedSetupsRoute,
} from "../../../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { OPENWORK_DOCS_URL, buildDenFeedbackUrl } from "./shared-setup-data";

function OrgMark({ name }: { name: string }) {
  const initials = useMemo(() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return (parts[0]?.slice(0, 1) ?? "O") + (parts[1]?.slice(0, 1) ?? "");
  }, [name]);

  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#011627] text-xs font-semibold uppercase tracking-[0.08em] text-white">
      {initials}
    </div>
  );
}

function getDashboardPageTitle(pathname: string, orgSlug: string | null) {
  if (!orgSlug) {
    return "Home";
  }

  const dashboardRoot = getOrgDashboardRoute(orgSlug);

  if (pathname === dashboardRoot) {
    return "Home";
  }
  if (pathname.startsWith(getSharedSetupsRoute(orgSlug))) {
    return "Team Templates";
  }
  if (pathname.startsWith(getMembersRoute(orgSlug))) {
    return "Members";
  }
  if (pathname.startsWith(getBackgroundAgentsRoute(orgSlug))) {
    return "Agents";
  }
  if (pathname.startsWith(getCustomLlmProvidersRoute(orgSlug))) {
    return "Custom LLM providers";
  }
  if (pathname.startsWith(getBillingRoute(orgSlug)) || pathname === "/checkout") {
    return "Billing";
  }

  return "Home";
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

  const pageTitle = getDashboardPageTitle(pathname, activeOrg?.slug ?? null);
  const feedbackHref = buildDenFeedbackUrl({
    pathname,
    orgSlug: activeOrg?.slug,
  });

  const navItems = [
    {
      href: activeOrg ? getOrgDashboardRoute(activeOrg.slug) : "#",
      label: "Dashboard",
      icon: Home,
    },
    {
      href: activeOrg ? getSharedSetupsRoute(activeOrg.slug) : "#",
      label: "Team Templates",
      icon: Share2,
    },
    {
      href: activeOrg ? getMembersRoute(activeOrg.slug) : "#",
      label: "Members",
      icon: Users,
    },
    {
      href: activeOrg ? getBackgroundAgentsRoute(activeOrg.slug) : "#",
      label: "Shared Workspace",
      icon: Bot,
      badge: "Alpha",
    },
    {
      href: activeOrg ? getCustomLlmProvidersRoute(activeOrg.slug) : "#",
      label: "Custom LLMs",
      icon: Cpu,
      badge: "Soon",
    },
    {
      href: activeOrg ? getBillingRoute(activeOrg.slug) : "/checkout",
      label: "Billing",
      icon: CreditCard,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa] md:flex-row">
      <aside className="w-full shrink-0 border-b border-gray-100 bg-white md:flex md:min-h-screen md:w-[260px] md:flex-col md:border-b-0 md:border-r">
        <div className="flex flex-1 flex-col">
          <div className="border-b border-gray-100 px-4 pb-4 pt-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              OpenWork Cloud
            </p>

            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-gray-50"
                onClick={() => setSwitcherOpen((current) => !current)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <OrgMark name={activeOrg?.name ?? "OpenWork"} />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold tracking-[-0.2px] text-gray-900">
                      {activeOrg?.name ?? "Loading..."}
                    </p>
                    <p className="truncate text-[12px] text-gray-400">
                      {activeOrg ? formatRoleLabel(activeOrg.role) : "Preparing workspace"}
                    </p>
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
              </button>

              {switcherOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-30 grid gap-4 rounded-[1.5rem] border border-gray-200 bg-white p-4 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.28)]">
                  <div className="grid gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                      Switch organization
                    </p>
                    <div className="grid gap-1.5">
                      {orgDirectory.map((org) => (
                        <button
                          key={org.id}
                          type="button"
                          onClick={() => {
                            setSwitcherOpen(false);
                            switchOrganization(org.slug);
                          }}
                          className={`flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                            org.isActive
                              ? "bg-gray-100 text-gray-900"
                              : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">{org.name}</span>
                            <span className="block truncate text-[11px] text-gray-400">
                              {formatRoleLabel(org.role)}
                            </span>
                          </span>
                          {org.isActive ? (
                            <span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                              Current
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  <form
                    className="grid gap-3 rounded-[1.25rem] border border-gray-200 bg-gray-50 p-4"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      setCreateError(null);
                      try {
                        await createOrganization(orgNameDraft);
                        setOrgNameDraft("");
                        setSwitcherOpen(false);
                      } catch (error) {
                        setCreateError(
                          error instanceof Error
                            ? error.message
                            : "Could not create organization.",
                        );
                      }
                    }}
                  >
                    <label className="grid gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                        Create organization
                      </span>
                      <input
                        type="text"
                        value={orgNameDraft}
                        onChange={(event) => setOrgNameDraft(event.target.value)}
                        placeholder="Acme Labs"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none transition focus:border-gray-300 focus:ring-4 focus:ring-gray-900/5"
                      />
                    </label>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-full bg-gray-900 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={mutationBusy === "create-organization"}
                    >
                      {mutationBusy === "create-organization"
                        ? "Creating..."
                        : "Create organization"}
                    </button>
                    {createError ? (
                      <p className="text-[12px] font-medium text-rose-600">{createError}</p>
                    ) : null}
                  </form>
                </div>
              ) : null}
            </div>
          </div>

          <nav className="flex-1 px-3 py-5">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              Navigation
            </p>
            <div className="space-y-1">
              {navItems.map((item) => {
                const isDashboardRoot =
                  activeOrg && item.href === getOrgDashboardRoute(activeOrg.slug);
                const selected =
                  item.href !== "#" &&
                  (isDashboardRoot
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`));

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[13px] tracking-[-0.1px] transition-colors ${
                      selected
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <item.icon className="h-4 w-4" strokeWidth={1.8} />
                      {item.label}
                    </span>
                    {item.badge ? (
                      <span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="mt-auto border-t border-gray-100 p-3">
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold uppercase text-white">
                  {(user?.name ?? user?.email ?? "OW")
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium tracking-[-0.1px] text-gray-900">
                    {user?.name ?? user?.email ?? "OpenWork user"}
                  </p>
                  <p className="truncate text-[11px] text-gray-400">
                    {user?.email ?? (activeOrg ? formatRoleLabel(activeOrg.role) : "Signed in")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded-full p-2 text-gray-400 transition-colors hover:bg-white hover:text-gray-700"
                  aria-label="Log out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
              {orgBusy ? (
                <p className="mt-3 text-[11px] text-gray-400">Refreshing workspace…</p>
              ) : null}
              {orgError ? (
                <p className="mt-3 text-[11px] font-medium text-rose-600">{orgError}</p>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-100 bg-white px-5 md:px-6">
          <div className="flex items-center gap-2">
            <span className="text-[14px] tracking-[-0.1px] text-gray-900">
              {pageTitle}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <a
              href={feedbackHref}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
            >
              <MessageSquare className="h-4 w-4" />
              Feedback
            </a>
            <a
              href={OPENWORK_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
            >
              <FileText className="h-4 w-4" />
              Docs
            </a>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#fafafa]">{children}</main>
      </div>
    </div>
  );
}
