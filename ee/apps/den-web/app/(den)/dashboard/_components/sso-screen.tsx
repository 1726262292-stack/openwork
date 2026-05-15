"use client";

import { Copy, KeyRound, RefreshCw, Shield, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import { getOrgAccessFlags, parseOrgSsoPayload, type DenOrgSsoConnection } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

function formatDateTime(value: string | null) {
  if (!value) return "Not configured";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not configured";
  return date.toLocaleString();
}

type FormMode = "saml" | "oidc";

export function SsoScreen() {
  const { orgId, orgContext } = useOrgDashboard();
  const [connection, setConnection] = useState<DenOrgSsoConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [domainVerificationToken, setDomainVerificationToken] = useState<string | null>(null);
  const [requestingDomainToken, setRequestingDomainToken] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("saml");
  const [issuer, setIssuer] = useState("");
  const [domain, setDomain] = useState("");
  const [entryPoint, setEntryPoint] = useState("");
  const [cert, setCert] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const access = useMemo(
    () => getOrgAccessFlags(orgContext?.currentMember.role ?? "member", orgContext?.currentMember.isOwner ?? false),
    [orgContext?.currentMember.isOwner, orgContext?.currentMember.role],
  );

  async function loadSsoConfig() {
    if (!orgId || !access.canManageSso) {
      setConnection(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/v1/sso", { method: "GET" }, 12000);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to load SSO settings (${response.status}).`));
      }

      const parsed = parseOrgSsoPayload(payload);
      setConnection(parsed.connection);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load SSO settings.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadSsoConfig();
  }, [orgId, access.canManageSso]);

  useEffect(() => {
    if (!copiedValue) return;
    const timeout = window.setTimeout(() => setCopiedValue(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedValue]);

  async function copyValue(value: string | null, key: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(key);
    } catch {
      setError("Could not copy that SSO value.");
    }
  }

  async function handleSave() {
    if (!orgId) {
      setError("Organization not found.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const path = formMode === "saml" ? "/v1/sso/saml" : "/v1/sso/oidc";
      const body = formMode === "saml"
        ? { issuer, domain, entryPoint, cert }
        : { issuer, domain, clientId, clientSecret };

      const { response, payload } = await requestJson(path, { method: "POST", body: JSON.stringify(body) }, 20000);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to save SSO settings (${response.status}).`));
      }

      const parsed = parseOrgSsoPayload(payload);
      setConnection(parsed.connection);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save SSO settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!orgId || !window.confirm("Delete this SSO connection?")) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/v1/sso", { method: "DELETE" }, 12000);
      if (response.status !== 204 && !response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to delete SSO settings (${response.status}).`));
      }
      setConnection(null);
      await loadSsoConfig();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete SSO settings.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRequestDomainToken() {
    if (!orgId || !connection) return;
    setRequestingDomainToken(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/v1/sso/request-domain-verification", { method: "POST", body: JSON.stringify({}) }, 12000);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to request domain verification (${response.status}).`));
      }

      const token = typeof (payload as { domainVerificationToken?: unknown } | null)?.domainVerificationToken === "string"
        ? (payload as { domainVerificationToken: string }).domainVerificationToken
        : "";
      if (!token) {
        throw new Error("SSO domain verification token was missing from the response.");
      }
      setDomainVerificationToken(token);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to request domain verification.");
    } finally {
      setRequestingDomainToken(false);
    }
  }

  async function handleVerifyDomain() {
    if (!orgId || !connection) return;
    setVerifyingDomain(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/v1/sso/verify-domain", { method: "POST", body: JSON.stringify({}) }, 12000);
      if (response.status !== 204 && !response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to verify domain (${response.status}).`));
      }
      setDomainVerificationToken(null);
      await loadSsoConfig();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to verify the SSO domain.");
    } finally {
      setVerifyingDomain(false);
    }
  }

  if (!orgContext) {
    return (
      <DashboardPageTemplate icon={Shield} badgeLabel="Admin" title="SSO" description="Set up enterprise single sign-on for this workspace." colors={["#F5F3FF", "#4C1D95", "#8B5CF6", "#DDD6FE"]}>
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">Loading organization details...</div>
      </DashboardPageTemplate>
    );
  }

  return (
    <DashboardPageTemplate icon={Shield} badgeLabel="Admin" title="SSO" description="Configure one enterprise SSO connection per workspace and share the generated sign-in URL with your team." colors={["#F5F3FF", "#4C1D95", "#8B5CF6", "#DDD6FE"]}>
      {!access.canManageSso ? (
        <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5 text-[14px] text-amber-900">Only organization owners and admins can manage SSO.</div>
      ) : (
        <>
          {error ? <div className="mb-6 rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[14px] text-red-700">{error}</div> : null}

          <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex flex-wrap items-center gap-3">
              <DenButton variant={formMode === "saml" ? "primary" : "secondary"} onClick={() => setFormMode("saml")}>SAML</DenButton>
              <DenButton variant={formMode === "oidc" ? "primary" : "secondary"} onClick={() => setFormMode("oidc")}>OIDC</DenButton>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block text-[14px] text-gray-700">
                <span className="mb-2 block font-medium">Issuer URL</span>
                <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="https://idp.example.com" />
              </label>
              <label className="block text-[14px] text-gray-700">
                <span className="mb-2 block font-medium">Domain</span>
                <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" />
              </label>
              {formMode === "saml" ? (
                <>
                  <label className="block text-[14px] text-gray-700 md:col-span-2">
                    <span className="mb-2 block font-medium">SAML Entry Point</span>
                    <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={entryPoint} onChange={(event) => setEntryPoint(event.target.value)} placeholder="https://idp.example.com/sso" />
                  </label>
                  <label className="block text-[14px] text-gray-700 md:col-span-2">
                    <span className="mb-2 block font-medium">IdP Certificate</span>
                    <textarea className="min-h-[140px] w-full rounded-[18px] border border-gray-200 px-4 py-3" value={cert} onChange={(event) => setCert(event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
                  </label>
                </>
              ) : (
                <>
                  <label className="block text-[14px] text-gray-700">
                    <span className="mb-2 block font-medium">Client ID</span>
                    <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={clientId} onChange={(event) => setClientId(event.target.value)} />
                  </label>
                  <label className="block text-[14px] text-gray-700">
                    <span className="mb-2 block font-medium">Client Secret</span>
                    <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />
                  </label>
                </>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <DenButton variant="primary" icon={RefreshCw} onClick={() => void handleSave()} disabled={saving}>{saving ? "Saving..." : "Save SSO connection"}</DenButton>
              <DenButton variant="secondary" icon={Trash2} onClick={() => void handleDelete()} disabled={deleting || !connection}>{deleting ? "Deleting..." : "Delete connection"}</DenButton>
            </div>
          </div>

          <div className="rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">Current connection</p>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">Use the generated sign-in and provider setup URLs below.</p>
              </div>
            </div>

            {!connection && !busy ? <p className="mt-4 text-[14px] text-gray-500">No SSO connection configured yet.</p> : null}

            {connection ? (
              <div className="mt-5 space-y-4">
                {[
                  ["Sign-in URL", connection.signInUrl, "signin"],
                  ["Redirect URL", connection.redirectUrl, "redirect"],
                  ["ACS URL", connection.acsUrl, "acs"],
                  ["Metadata URL", connection.metadataUrl, "metadata"],
                ].map(([label, value, key]) => (
                  <div key={key as string} className="rounded-[20px] border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-gray-500">{label as string}</p>
                      <DenButton variant="secondary" icon={Copy} onClick={() => void copyValue((value as string | null) ?? null, key as string)} disabled={!value}>{copiedValue === key ? "Copied" : "Copy"}</DenButton>
                    </div>
                    <code className="block break-all text-[13px] leading-6 text-gray-700">{(value as string | null) ?? "Not applicable"}</code>
                  </div>
                ))}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-4 text-[14px] text-gray-700">
                    <p className="font-medium text-gray-900">Provider</p>
                    <p className="mt-2">{connection.providerId}</p>
                    <p className="mt-2">{connection.kind.toUpperCase()} · {connection.domain}</p>
                    <p className="mt-2">Domain verified: {connection.domainVerified ? "Yes" : "No"}</p>
                  </div>
                  <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-4 text-[14px] text-gray-700">
                    <p className="font-medium text-gray-900">Status</p>
                    <p className="mt-2">{connection.status}</p>
                    <p className="mt-2">Last tested: {formatDateTime(connection.lastTestedAt)}</p>
                    <p className="mt-2">Updated: {formatDateTime(connection.updatedAt)}</p>
                  </div>
                </div>

                {!connection.domainVerified ? (
                  <div className="rounded-[20px] border border-violet-200 bg-violet-50 p-4 text-[14px] text-violet-900">
                    <p className="font-medium">Domain verification</p>
                    <p className="mt-2 text-violet-800">
                      Request a DNS TXT token, publish it for `{connection.domain}`, then verify the domain before using this connection in production.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <DenButton variant="secondary" icon={KeyRound} onClick={() => void handleRequestDomainToken()} disabled={requestingDomainToken}>
                        {requestingDomainToken ? "Requesting..." : "Request token"}
                      </DenButton>
                      <DenButton variant="secondary" icon={RefreshCw} onClick={() => void handleVerifyDomain()} disabled={verifyingDomain}>
                        {verifyingDomain ? "Verifying..." : "Verify domain"}
                      </DenButton>
                    </div>
                    {domainVerificationToken ? (
                      <div className="mt-4 rounded-[16px] border border-violet-200 bg-white px-4 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-violet-500">TXT token</p>
                          <DenButton variant="secondary" icon={Copy} onClick={() => void copyValue(domainVerificationToken, "domain-token")}>
                            {copiedValue === "domain-token" ? "Copied" : "Copy"}
                          </DenButton>
                        </div>
                        <code className="block break-all text-[13px] leading-6 text-gray-700">{domainVerificationToken}</code>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {connection.lastError ? <div className="rounded-[20px] border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">{connection.lastError}</div> : null}
              </div>
            ) : null}
          </div>
        </>
      )}
    </DashboardPageTemplate>
  );
}
