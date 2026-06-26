/** @jsxImportSource react */
import * as React from "react";
import { CheckCircle2, Sparkles, Building2, Server, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Page, PageBackground } from "@/components/page";
import { getDesktopBootstrapConfig } from "@/app/lib/desktop";
import { readDenSettings } from "@/app/lib/den";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";

type PreparedSummary = {
  orgName: string;
  skillTitle: string;
  serverUrl: string;
  account: string;
};

/**
 * ReadyRoute: the human-facing payoff after an agent-first install prepared the
 * desktop app. Shows a polished "You're ready" first-run screen with the
 * account, organization, and first skill, plus a single clear next action.
 *
 * The `data-openwork-ready` attributes give the e2e a machine-readable hook
 * without exposing a debug-looking surface to the user.
 */
export function ReadyRoute() {
  const navigate = useNavigate();
  const { user } = useDenAuth();
  const [prepared, setPrepared] = React.useState<PreparedSummary | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void getDesktopBootstrapConfig()
      .then((config) => {
        if (cancelled) return;
        const settings = readDenSettings();
        const summary: PreparedSummary = {
          orgName: config.prepared?.orgName || settings.activeOrgName || "",
          skillTitle: config.prepared?.skillTitle || "",
          serverUrl: config.baseUrl || settings.baseUrl || "",
          account: user?.email ?? "",
        };
        setPrepared(summary);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const settings = readDenSettings();
  const account = prepared?.account || user?.email || "";
  const orgName = prepared?.orgName || settings.activeOrgName || "";
  const skillTitle = prepared?.skillTitle || "";
  const serverUrl = prepared?.serverUrl || settings.baseUrl || "";
  const firstName = account ? account.split("@")[0] : "";
  const ready = Boolean(account && orgName && skillTitle);

  return (
    <Page
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
      data-openwork-ready={ready ? "true" : "false"}
    >
      <PageBackground />
      <div className="relative z-10 w-full max-w-2xl">
        <div className="overflow-hidden rounded-[28px] border border-border bg-background/80 shadow-[0_28px_90px_rgba(15,23,42,0.18)] backdrop-blur">
          <div className="flex flex-col items-center gap-4 px-8 pb-2 pt-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600">
              <CheckCircle2 className="size-8" />
            </div>
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Setup complete
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-foreground">
                {firstName ? `You're ready, ${firstName}` : "You're ready"}
              </h1>
              <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                OpenWork installed itself, signed you in, and set up your workspace.
                Everything below was configured automatically.
              </p>
            </div>
          </div>

          <div className="grid gap-3 px-8 py-6 sm:grid-cols-2">
            <ReadyTile
              icon={<Building2 className="size-4" />}
              label="Organization"
              value={orgName || "—"}
              testId="ready-org"
            />
            <ReadyTile
              icon={<Server className="size-4" />}
              label="Connected to"
              value={serverUrl}
              testId="ready-server"
            />
            <ReadyTile
              icon={<CheckCircle2 className="size-4" />}
              label="Account"
              value={account || "—"}
              testId="ready-account"
            />
            <ReadyTile
              icon={<Sparkles className="size-4" />}
              label="First skill ready"
              value={skillTitle || "—"}
              testId="ready-skill"
              highlight
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-8 py-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted-foreground">
              Your first skill is installed and ready to run.
            </p>
            <Button
              size="lg"
              className="gap-2"
              data-openwork-ready-cta="true"
              onClick={() => navigate("/session")}
            >
              Start your first task
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </Page>
  );
}

function ReadyTile({
  icon,
  label,
  value,
  testId,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  testId: string;
  highlight?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-col gap-2 rounded-2xl border p-4 ${
        highlight
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className={highlight ? "text-emerald-600" : "text-muted-foreground"}>{icon}</span>
        {label}
      </div>
      <div className="break-words text-[15px] font-semibold text-foreground">{value}</div>
    </div>
  );
}
