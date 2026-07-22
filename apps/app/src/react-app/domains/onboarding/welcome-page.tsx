/** @jsxImportSource react */
import { type ReactNode } from "react";
import { PaperGrainGradient } from "@openwork/ui/react";

import { t } from "../../../i18n";
import { resolveExtensionIconSrc } from "@/react-app/design-system/extension-icon-src";
import {
  Page,
  PageBackground,
  PageDescription,
  PageHeader,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { displayCustomControlPlaneUrl } from "../settings/cloud/control-plane-url";
import { OrganizationServerAffordance } from "../settings/cloud/organization-server-affordance";

const capabilities = [
  {
    titleKey: "welcome.capability_spreadsheets",
    descKey: "welcome.capability_spreadsheets_desc",
  },
  {
    titleKey: "welcome.capability_browser",
    descKey: "welcome.capability_browser_desc",
  },
  {
    titleKey: "welcome.capability_files",
    descKey: "welcome.capability_files_desc",
  },
  {
    titleKey: "welcome.capability_automate",
    descKey: "welcome.capability_automate_desc",
  },
  {
    titleKey: "welcome.capability_content",
    descKey: "welcome.capability_content_desc",
  },
  {
    titleKey: "welcome.capability_apis",
    descKey: "welcome.capability_apis_desc",
  },
];

function ShowcasePanel() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {t("welcome.showcase_label")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {capabilities.map((cap) => (
          <div
            key={cap.titleKey}
            className="flex flex-col gap-1.5 rounded-xl border border-border p-3"
          >
            <div className="text-sm font-medium leading-tight text-foreground">
              {t(cap.titleKey)}
            </div>
            <div className="text-xs leading-snug text-muted-foreground">
              {t(cap.descKey)}
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
          <div className="text-sm font-medium text-foreground">
            {t("welcome.showcase_shared_extensions")}
          </div>
          <div className="text-xs leading-snug text-muted-foreground">
            {t("welcome.showcase_shared_extensions_desc")}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
          <div className="text-sm font-medium text-foreground">
            {t("welcome.showcase_provision_team")}
          </div>
          <div className="text-xs leading-snug text-muted-foreground">
            {t("welcome.showcase_provision_team_desc")}
          </div>
        </div>
      </div>
    </div>
  );
}

type WelcomePageProps = {
  onGetStarted: () => void;
  getStartedLabel?: string;
  busy?: boolean;
  error?: string | null;
  manualFolder?: string;
  onManualFolderChange?: (value: string) => void;
  onUseManualFolder?: () => void;
  showManualFolder?: boolean;
  onTeamSignIn?: () => void;
  onJoinOrganization: () => void;
  organizationServerBusy: boolean;
  organizationServerError: string | null;
  organizationServerUrl: string;
  onOrganizationServerSave: (url: string) => Promise<boolean>;
  developerMode: boolean;
};

type OnboardingStepProps = {
  number: string;
  title: string;
  children: ReactNode;
};

function OnboardingStep({ number, title, children }: OnboardingStepProps) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-sm font-medium text-foreground">
        {number}
      </div>
      <div className="flex flex-col gap-0.5 pt-1">
        <div className="text-base font-medium text-foreground">{title}</div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function WelcomePage({
  onGetStarted,
  getStartedLabel,
  busy,
  error,
  manualFolder,
  onManualFolderChange,
  onUseManualFolder,
  showManualFolder,
  onTeamSignIn,
  onJoinOrganization,
  organizationServerBusy,
  organizationServerError,
  organizationServerUrl,
  onOrganizationServerSave,
  developerMode,
}: WelcomePageProps) {
  const showConnectedOrganizationServer =
    !developerMode && displayCustomControlPlaneUrl(organizationServerUrl) !== "";

  return (
    <Page className="min-h-screen">
      <PageBackground />

      <PageTitlebarRegion />

      <ScrollArea className="relative z-10">
        <ScrollAreaViewport>
          <div className="flex min-h-screen">
            {/* ---- Left: onboarding steps ---- */}
            <div className="flex w-full flex-col items-center justify-center px-8 py-16 lg:w-[45%] lg:px-12">
              <div className="flex w-full max-w-md flex-col gap-10">
                <img
                  src={resolveExtensionIconSrc("/openwork-mark.svg")}
                  alt=""
                  width={32}
                  height={32}
                  className="size-8"
                  data-testid="welcome-brand-mark"
                />

                {/* Header */}
                <PageHeader className="text-left">
                  <PageTitle>{t("welcome.title")}</PageTitle>
                  <PageDescription>{t("welcome.subtitle")}</PageDescription>
                </PageHeader>

                {/* Steps */}
                <div className="flex flex-col gap-4">
                  <OnboardingStep number="1" title="Pick a folder">
                    Choose any folder on your machine to get started.
                  </OnboardingStep>
                  <OnboardingStep number="2" title="Chat">
                    Describe what you need. OpenWork handles the rest.
                  </OnboardingStep>
                  <OnboardingStep number="3" title="Interact">
                    Review results, approve actions, and iterate.
                  </OnboardingStep>
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    size="lg"
                    className="w-full"
                    onClick={onGetStarted}
                    disabled={busy}
                    data-testid="welcome-primary-cta"
                  >
                    {busy
                      ? t("welcome.creating_workspace")
                      : (getStartedLabel || t("welcome.pick_folder"))}
                  </Button>
                  <div className="flex flex-col gap-2">
                    <div
                      className="flex items-center gap-3 py-1"
                      data-testid="welcome-or-divider"
                    >
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("welcome.or")}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {onTeamSignIn ? (
                        <button
                          type="button"
                          className="rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50"
                          onClick={onTeamSignIn}
                          data-testid="welcome-team-signin"
                        >
                          <div className="text-sm font-medium">
                            {t("welcome.use_cloud")}
                          </div>
                          <div
                            className="text-xs leading-snug text-muted-foreground"
                            data-testid="welcome-team-signin-subtitle"
                          >
                            {t("welcome.use_cloud_subtitle")}
                          </div>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50"
                        onClick={onJoinOrganization}
                        data-testid="welcome-join-org"
                      >
                        <div className="text-sm font-medium">
                          {t("welcome.join_org")}
                        </div>
                        <div
                          className="text-xs leading-snug text-muted-foreground"
                          data-testid="welcome-join-org-subtitle"
                        >
                          {t("welcome.join_org_subtitle")}
                        </div>
                      </button>
                    </div>
                  </div>
                  {error ? (
                    <p className="text-center text-xs text-destructive">{error}</p>
                  ) : null}
                  {developerMode ? (
                    <section
                      className="flex flex-col gap-3"
                      data-testid="welcome-developer-section"
                    >
                      <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {t("welcome.developer_section")}
                      </div>
                      <OrganizationServerAffordance
                        busy={organizationServerBusy}
                        error={organizationServerError}
                        onSave={onOrganizationServerSave}
                        url={organizationServerUrl}
                      />
                      {showManualFolder ? (
                        <div className="rounded-xl border border-dashed border-border p-3">
                          <label className="grid gap-2 text-xs font-medium text-muted-foreground">
                            Daytona folder path
                            <input
                              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-ring"
                              value={manualFolder ?? ""}
                              onChange={(event) => onManualFolderChange?.(event.target.value)}
                              placeholder="/workspace/my-project"
                            />
                          </label>
                          <Button
                            className="mt-2 w-full"
                            variant="outline"
                            onClick={onUseManualFolder}
                            disabled={busy || !manualFolder?.trim()}
                          >
                            Use this folder
                          </Button>
                        </div>
                      ) : null}
                    </section>
                  ) : showConnectedOrganizationServer ? (
                    <OrganizationServerAffordance
                      busy={organizationServerBusy}
                      error={organizationServerError}
                      onSave={onOrganizationServerSave}
                      url={organizationServerUrl}
                    />
                  ) : null}
                </div>
              </div>
            </div>

            {/* ---- Right: shader outer card > white inner card ---- */}
            <div className="hidden lg:flex lg:w-[55%] lg:items-center lg:justify-center lg:p-6">
              <div className="relative w-full max-w-xl overflow-hidden rounded-3xl">
                {/* Shader background */}
                <div className="absolute inset-0 z-0">
                  <PaperGrainGradient
                    className="size-full bg-white"
                    speed={0}
                    scale={1}
                    rotation={0}
                    offsetX={0}
                    offsetY={0}
                    softness={0.5}
                    intensity={0.5}
                    noise={0.25}
                    shape="corners"
                    frame={37706.748}
                    colors={["#0E33D9", "#FF7E2E", "#FFE340", "#000000"]}
                    colorBack="#00000000"
                  />
                </div>

                {/* Inner white card */}
                <div className="relative z-10 m-3 rounded-2xl bg-background p-7">
                  <ShowcasePanel />
                </div>
              </div>
            </div>
          </div>
        </ScrollAreaViewport>
      </ScrollArea>
    </Page>
  );
}
