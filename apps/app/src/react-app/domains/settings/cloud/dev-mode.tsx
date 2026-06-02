/** @jsxImportSource react */
import { ArrowUpRight } from "lucide-react";

import { DEFAULT_DEN_BASE_URL } from "../../../../app/lib/den";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { useCloudAccount } from "./cloud-account-provider";

export function CloudDevMode() {
  const { isBusy, session } = useCloudAccount();

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <Field data-disabled={isBusy}>
        <FieldLabel htmlFor="den-cloud-control-plane-url">
          {t("den.cloud_control_plane_url_label")}
        </FieldLabel>
        <Input
          id="den-cloud-control-plane-url"
          value={session.baseUrlDraft}
          onChange={(event) => session.onBaseUrlDraftChange(event.currentTarget.value)}
          placeholder={DEFAULT_DEN_BASE_URL}
          disabled={isBusy}
        />
        <FieldDescription>{t("den.cloud_control_plane_url_hint")}</FieldDescription>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={session.onResetBaseUrl}
          disabled={isBusy}
        >
          {t("den.cloud_control_plane_reset")}
        </Button>
        <Button
          size="sm"
          onClick={session.onApplyBaseUrl}
          disabled={isBusy}
        >
          {t("den.cloud_control_plane_save")}
        </Button>
        <Button variant="outline" size="sm" onClick={session.onOpenControlPlane}>
          {t("den.cloud_control_plane_open")}
          <ArrowUpRight size={13} />
        </Button>
      </div>
    </div>
  );
}
