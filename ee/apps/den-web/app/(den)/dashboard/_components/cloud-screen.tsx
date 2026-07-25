"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Cloud, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

type CloudInstanceStatus = "provisioning" | "ready" | "failed";

type CloudInstance = {
  status: CloudInstanceStatus;
  url: string | null;
};

const CLOUD_POLL_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCloudInstance(payload: unknown): CloudInstance | null {
  if (!isRecord(payload)) {
    return null;
  }

  const status = payload.status;
  if (status !== "provisioning" && status !== "ready" && status !== "failed") {
    return null;
  }

  const url = typeof payload.url === "string" ? payload.url : null;
  if (status === "ready" && !url) {
    return null;
  }

  return { status, url };
}

function openCloudTab(url: string) {
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
  }
  return Boolean(opened);
}

export function CloudScreen() {
  const { orgContext } = useOrgDashboard();
  const organizationId = orgContext?.organization.id ?? null;
  const [instance, setInstance] = useState<CloudInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);
  const [autoOpenBlocked, setAutoOpenBlocked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadInstance() {
      setLoading(true);
      setError(null);
      setUnavailable(false);

      try {
        const { response, payload } = await requestJson("/v1/cloud/instance", { method: "GET" }, 20000);
        if (cancelled) {
          return;
        }

        if (response.status === 404) {
          setInstance(null);
          setUnavailable(true);
          return;
        }

        if (!response.ok) {
          throw new Error(getErrorMessage(payload, `Cloud could not start (${response.status}).`));
        }

        const parsed = parseCloudInstance(payload);
        if (!parsed) {
          throw new Error("Cloud response was incomplete.");
        }

        setInstance(parsed);
        if (parsed.status === "provisioning") {
          pollTimer = setTimeout(() => void loadInstance(), CLOUD_POLL_MS);
        }
      } catch (loadError) {
        if (!cancelled) {
          setInstance(null);
          setError(loadError instanceof Error ? loadError.message : "Cloud could not start.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInstance();

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [organizationId, refreshKey]);

  useEffect(() => {
    if (instance?.status !== "ready" || !instance.url || openedUrl === instance.url) {
      return;
    }

    setOpenedUrl(instance.url);
    setAutoOpenBlocked(!openCloudTab(instance.url));
  }, [instance, openedUrl]);

  function retry() {
    setOpenedUrl(null);
    setAutoOpenBlocked(false);
    setRefreshKey((value) => value + 1);
  }

  function openReadyCloud() {
    if (instance?.status !== "ready" || !instance.url) {
      return;
    }

    setOpenedUrl(instance.url);
    setAutoOpenBlocked(!openCloudTab(instance.url));
  }

  const readyUrl = instance?.status === "ready" ? instance.url : null;
  const failed = instance?.status === "failed";
  const starting = !readyUrl && !failed && !error && !unavailable && (loading || instance?.status === "provisioning");

  return (
    <DashboardPageTemplate
      icon={Cloud}
      badgeLabel="Alpha"
      title="Cloud"
      description="Open a full OpenWork instance in your browser. Nothing to install."
      colors={["#EFF6FF", "#0F172A", "#2563EB", "#BAE6FD"]}
    >
      <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.35)]">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            {starting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {readyUrl ? <ExternalLink className="size-5" aria-hidden="true" /> : null}
            {failed || error || unavailable ? <AlertTriangle className="size-5" aria-hidden="true" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">Cloud Alpha</p>

            {starting ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">Starting Cloud</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  We’re bringing up a full OpenWork instance for this organization. This usually takes a few seconds.
                </p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  Keep this page open. Cloud opens in a new tab as soon as it is ready.
                </p>
              </>
            ) : null}

            {readyUrl ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">Cloud is ready</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  {autoOpenBlocked
                    ? "Your browser blocked the new tab. Click Open Cloud to continue."
                    : "Cloud opened in a new tab. If you do not see it, open it again here."}
                </p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  Alpha note: the Cloud URL is itself the credential. Do not share it or paste it anywhere public.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <DenButton icon={ExternalLink} onClick={openReadyCloud}>Open Cloud</DenButton>
                  <DenButton variant="secondary" icon={RefreshCw} onClick={retry}>Refresh status</DenButton>
                </div>
              </>
            ) : null}

            {failed ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">Cloud could not start</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  Ask an OpenWork admin to check the Cloud alpha configuration, then try again.
                </p>
                <div className="mt-5">
                  <DenButton variant="secondary" icon={RefreshCw} onClick={retry}>Try again</DenButton>
                </div>
              </>
            ) : null}

            {unavailable ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">Cloud is not available</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  Ask an OpenWork admin to enable Cloud for this organization and confirm hosted Cloud is configured.
                </p>
                <div className="mt-5">
                  <DenButton variant="secondary" icon={RefreshCw} onClick={retry}>Check again</DenButton>
                </div>
              </>
            ) : null}

            {error ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">Cloud needs attention</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">{error}</p>
                <div className="mt-5">
                  <DenButton variant="secondary" icon={RefreshCw} onClick={retry}>Try again</DenButton>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </DashboardPageTemplate>
  );
}
