/** @jsxImportSource react */
import * as React from "react";
import { ArrowUpRight, CheckCircle2, CircleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { t } from "@/i18n";
import { useCloudAccount } from "../cloud/cloud-account-provider";
import { CloudAccountSection } from "../cloud/cloud-account-section";
import { useCloudSession } from "../cloud/cloud-session-provider";
import { CloudDevMode } from "../cloud/dev-mode";
import {
  SettingsSection,
  SettingsSectionHeader,
  SettingsSectionHeaderContent,
  SettingsSectionHeaderDescription,
  SettingsSectionHeaderTitle,
  SettingsStack,
  SettingsStatusBadge,
} from "../settings-section";

interface EnterSignInCodeDialogProps {
  disabled: boolean;
}

function EnterSignInCodeDialog({ disabled }: EnterSignInCodeDialogProps) {
  const { session } = useCloudAccount();
  const [open, setOpen] = React.useState(false);
  const [manualAuthInput, setManualAuthInput] = React.useState("");

  const submitManualAuth = async () => {
    const ok = await session.onSubmitManualAuth(manualAuthInput);

    if (!ok) {
      return;
    }

    setManualAuthInput("");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        session.onClearAuthError();
      }}
    >
      <DialogTrigger
        render={<Button variant="link" size="sm" className="w-fit self-start" disabled={disabled} />}
      >
        {t("den.enter_code_trigger")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("den.enter_code_title")}</DialogTitle>
          <DialogDescription>{t("den.enter_code_hint")}</DialogDescription>
        </DialogHeader>
        <Field data-disabled={disabled}>
          <FieldLabel htmlFor="den-signin-link">{t("den.enter_code_label")}</FieldLabel>
          <Input
            id="den-signin-link"
            value={manualAuthInput}
            onChange={(event) => setManualAuthInput(event.currentTarget.value)}
            placeholder={t("den.enter_code_placeholder")}
            disabled={disabled}
          />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={disabled} />}>
            {t("common.cancel")}
          </DialogClose>
          <Button
            onClick={() => void submitManualAuth()}
            disabled={[disabled, !manualAuthInput.trim()].some(Boolean)}
          >
            {session.authBusy ? t("den.enter_code_submitting") : t("den.enter_code_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DenSignedOutPanel() {
  const { error, session } = useCloudAccount();
  const disabled = [session.authBusy, session.sessionBusy].some(Boolean);

  return (
    <SettingsSection>
      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsSectionHeader>
        <SettingsSectionHeaderContent>
          <SettingsSectionHeaderTitle>{t("den.signin_title")}</SettingsSectionHeaderTitle>
          <SettingsSectionHeaderDescription className="max-w-[54ch]">
            {t("den.cloud_sleep_hint")}
          </SettingsSectionHeaderDescription>
        </SettingsSectionHeaderContent>
      </SettingsSectionHeader>

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => session.onOpenBrowserAuth("sign-in")}>
            {t("den.signin_button")}
            <ArrowUpRight size={13} />
          </Button>
          <Button variant="outline" onClick={() => session.onOpenBrowserAuth("sign-up")}>
            {t("den.create_account")}
            <ArrowUpRight size={13} />
          </Button>
        </div>

        <EnterSignInCodeDialog disabled={disabled} />
      </div>
    </SettingsSection>
  );
}

export function CloudAccountView() {
  const { developerMode, error, session } = useCloudAccount();
  const { isSignedIn, statusMessage } = useCloudSession();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!isSignedIn || !session.needsOrgSelection) {
      return;
    }

    navigate("/onboarding", { replace: true });
  }, [isSignedIn, navigate, session.needsOrgSelection]);

  return (
    <SettingsStack>
      <Separator />

      {isSignedIn ? (
        <SettingsSection>
          <SettingsSectionHeader>
            <SettingsSectionHeaderContent>
              <SettingsSectionHeaderTitle>
                {t("den.cloud_section_title")}
                <SettingsStatusBadge tone={session.summaryTone} label={session.summaryLabel} />
              </SettingsSectionHeaderTitle>
              <SettingsSectionHeaderDescription>
                {t("den.cloud_signed_in_desc")}
              </SettingsSectionHeaderDescription>
            </SettingsSectionHeaderContent>
          </SettingsSectionHeader>

          {developerMode ? <CloudDevMode /> : null}

          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {statusMessage && !error ? (
            <Alert>
              <CheckCircle2 />
              <AlertDescription>{statusMessage}</AlertDescription>
            </Alert>
          ) : null}

          <CloudAccountSection />
        </SettingsSection>
      ) : (
        <DenSignedOutPanel />
      )}
    </SettingsStack>
  );
}
