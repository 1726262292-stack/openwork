/** @jsxImportSource react */
import { AlertTriangle, Cloud, Lock, RotateCcw } from "lucide-react";
import { useShellConfig, DEFAULT_SHELL_CONFIG, type ShellConfig } from "../../../shell/shell-config";
import { useEffectiveConfig } from "../../../shell/effective-config";
import { useDesktopConfig } from "../../cloud/desktop-config-provider";
import { useCloudSession } from "../cloud/cloud-session-provider";
import { readDenSettings, resolveDenBaseUrls } from "../../../../app/lib/den";
import { usePlatform } from "../../../kernel/platform";
import {
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionHeaderContent,
  SettingsSectionHeaderTitle,
  SettingsSectionHeaderDescription,
  SettingsStack,
} from "../settings-section";
import { Separator } from "@/components/ui/separator";

/* ------------------------------------------------------------------ */
/*  Toggle row                                                         */
/* ------------------------------------------------------------------ */

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  locked,
  lockedHint,
  nested,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  locked?: boolean;
  lockedHint?: string;
  nested?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${nested ? "ml-6" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-dls-text">{label}</div>
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-dls-hover px-1.5 py-0.5 text-[10px] font-medium text-dls-secondary">
              <Cloud size={10} />
              Managed
            </span>
          ) : null}
        </div>
        <div className="text-xs text-dls-secondary">{description}</div>
        {locked && lockedHint ? (
          <div className="mt-0.5 text-[10px] text-dls-secondary/70">{lockedHint}</div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={locked}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${checked ? "bg-dls-text" : "bg-dls-hover"}`}
        onClick={() => !locked && onChange(!checked)}
      >
        <span
          className={`inline-block size-3.5 rounded-full bg-dls-surface transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Policy row (read-only indicator for Category B)                    */
/* ------------------------------------------------------------------ */

function PolicyRow({
  label,
  description,
  active,
}: {
  label: string;
  description: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-dls-text">{label}</div>
        <div className="text-xs text-dls-secondary">{description}</div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
          active
            ? "bg-amber-3 text-amber-11"
            : "bg-green-3 text-green-11"
        }`}
      >
        {active ? "Restricted" : "Allowed"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main view                                                          */
/* ------------------------------------------------------------------ */

export function ShellCustomizationView() {
  const { config, update, reset } = useShellConfig();
  const effectiveConfig = useEffectiveConfig();
  const { isSignedIn } = useCloudSession();
  const platform = usePlatform();

  const hasChanges = Object.keys(DEFAULT_SHELL_CONFIG).some(
    (key) => config[key as keyof ShellConfig] !== DEFAULT_SHELL_CONFIG[key as keyof ShellConfig],
  );

  return (
    <SettingsStack>
      {/* Section 1: Layout preferences */}
      <SettingsSection>
        <SettingsSectionHeader>
          <SettingsSectionHeaderContent>
            <SettingsSectionHeaderTitle>Layout</SettingsSectionHeaderTitle>
            <SettingsSectionHeaderDescription>
              Control which UI elements are visible. Your organization can override these settings.
            </SettingsSectionHeaderDescription>
          </SettingsSectionHeaderContent>
        </SettingsSectionHeader>

        <div className="space-y-5">
          <ToggleRow
            label="Status bar"
            description="Bottom bar showing connection status and quick links."
            checked={effectiveConfig.statusBar}
            onChange={(v) => update({ statusBar: v })}
            locked={effectiveConfig.cloudManaged.statusBar}
            lockedHint="Set by your organization."
          />
          {effectiveConfig.statusBar ? (
            <>
              <ToggleRow
                label="Documentation link"
                description="Link to docs in the status bar."
                checked={effectiveConfig.docsButton}
                onChange={(v) => update({ docsButton: v })}
                locked={effectiveConfig.cloudManaged.docsButton}
                nested
              />
              <ToggleRow
                label="Feedback button"
                description="Send feedback from the status bar."
                checked={effectiveConfig.feedbackButton}
                onChange={(v) => update({ feedbackButton: v })}
                locked={effectiveConfig.cloudManaged.feedbackButton}
                nested
              />
              <ToggleRow
                label="Cloud sign-in"
                description="Sign-in prompt for users who aren't logged in."
                checked={effectiveConfig.cloudSignin}
                onChange={(v) => update({ cloudSignin: v })}
                locked={effectiveConfig.cloudManaged.cloudSignin}
                nested
              />
            </>
          ) : null}
          <ToggleRow
            label="Task suggestions"
            description="Starter task cards in empty sessions."
            checked={effectiveConfig.starterCards}
            onChange={(v) => update({ starterCards: v })}
            locked={effectiveConfig.cloudManaged.starterCards}
          />
          <ToggleRow
            label="Model picker"
            description="Model selection in the composer."
            checked={effectiveConfig.modelPicker}
            onChange={(v) => update({ modelPicker: v })}
            locked={effectiveConfig.cloudManaged.modelPicker}
          />
          <ToggleRow
            label="New workspace button"
            description="Button to create or join workspaces."
            checked={effectiveConfig.addWorkspace}
            onChange={(v) => update({ addWorkspace: v })}
            locked={effectiveConfig.cloudManaged.addWorkspace}
          />
        </div>

        <div className="mt-2 rounded-lg bg-dls-hover/50 px-3 py-2 text-[11px] text-dls-secondary">
          Hidden items are still accessible via the command palette (Cmd+K).
        </div>
      </SettingsSection>

      <Separator />

      {/* Section 2: Organization policies (Category B) */}
      {isSignedIn ? (
        <SettingsSection>
          <SettingsSectionHeader>
            <SettingsSectionHeaderContent>
              <SettingsSectionHeaderTitle>
                Organization policies
                <Lock size={14} className="ml-1.5 inline text-dls-secondary" />
              </SettingsSectionHeaderTitle>
              <SettingsSectionHeaderDescription>
                These settings are managed by your organization.{" "}
                <button
                  type="button"
                  className="font-medium text-dls-text underline underline-offset-2"
                  onClick={() => {
                    const settings = readDenSettings();
                    platform.openLink(resolveDenBaseUrls(settings.baseUrl).baseUrl);
                  }}
                >
                  Open dashboard
                </button>
              </SettingsSectionHeaderDescription>
            </SettingsSectionHeaderContent>
          </SettingsSectionHeader>

          <div className="space-y-5">
            <PolicyRow
              label="Non-cloud models"
              description="Allow models not deployed through OpenWork Cloud."
              active={effectiveConfig.disallowNonCloudModels}
            />
            <PolicyRow
              label="OpenCode Zen"
              description="Allow the built-in OpenCode Zen provider."
              active={effectiveConfig.blockZenModel}
            />
            <PolicyRow
              label="Multiple workspaces"
              description="Allow users to create and manage multiple workspaces."
              active={effectiveConfig.blockMultipleWorkspaces}
            />
            <PolicyRow
              label="Settings access"
              description="Allow users to access app settings."
              active={effectiveConfig.blockSettingsAccess}
            />
            <PolicyRow
              label="Extensions"
              description="Allow users to install and manage extensions."
              active={effectiveConfig.restrictExtensions}
            />
          </div>
        </SettingsSection>
      ) : null}

      <Separator />

      {/* Reset */}
      {hasChanges ? (
        <SettingsSection>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-dls-text">Reset preferences</div>
              <div className="text-xs text-dls-secondary">
                Restore all layout preferences to their defaults. Organization policies are not affected.
              </div>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-dls-border px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
              onClick={reset}
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>
        </SettingsSection>
      ) : null}
    </SettingsStack>
  );
}
