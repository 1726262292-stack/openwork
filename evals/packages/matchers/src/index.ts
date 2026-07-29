export type TlsProbeFacts = {
  ok: boolean;
  protocol: string | null;
  errorCode: string | null;
  stalled: boolean;
};

export type TlsFacts = {
  tls12: TlsProbeFacts;
  tls13: TlsProbeFacts;
};

export type Verdict = {
  ok: boolean;
  code: string;
  summary: string;
  action: string;
};

export type DiagnosticVerdictExpectation =
  | "healthy"
  | "tls12-only"
  | "broken-chain"
  | "intercept"
  | "deny"
  | "redirect-chain"
  | "slow"
  | "blip"
  | "tls-version-handshake"
  | "missing-intermediate"
  | "untrusted-chain"
  | "tls-interception"
  | "blocked-host"
  | "proxy"
  | "redirect"
  | "slow-link"
  | "transient-401";

export function expectationMatches(text: string, expectation: DiagnosticVerdictExpectation): boolean {
  const value = text.toLowerCase();
  switch (expectation) {
    case "tls12-only":
    case "tls-version-handshake":
      return value.includes("tls 1.3") && (value.includes("tls 1.2") || value.includes("handshake"));
    case "broken-chain":
    case "missing-intermediate":
    case "untrusted-chain":
      return value.includes("missing intermediate") || value.includes("leaf-only") || value.includes("untrusted root") || value.includes("untrusted chain");
    case "intercept":
    case "tls-interception":
      return value.includes("tls interception") || value.includes("re-signed") || value.includes("proxy");
    case "deny":
    case "blocked-host":
    case "proxy":
      return value.includes("blocked host") || value.includes("proxy deny") || value.includes("selective-deny") || value.includes("http 451") || value.includes("allowlist deny");
    case "redirect-chain":
    case "redirect":
      return value.includes("redirect chain") || value.includes("http redirect");
    case "slow":
    case "slow-link":
      return value.includes("slow link");
    case "blip":
    case "transient-401":
      return value.includes("transient") && value.includes("401");
    case "healthy":
      return value.includes("no egress/tls fault") || value.includes("handshake verified") || value.includes("cloud_catalog_exact_match");
  }
}

export function matchVerdictExpectations(text: string, expect: DiagnosticVerdictExpectation | DiagnosticVerdictExpectation[]): { ok: boolean; missing: string[] } {
  const expectations = Array.isArray(expect) ? expect : [expect];
  const missing = expectations.filter((entry) => !expectationMatches(text, entry));
  return { ok: missing.length === 0, missing };
}

export function diagnoseTls(facts: TlsFacts): Verdict {
  if (facts.tls12.ok && facts.tls13.stalled) {
    return {
      ok: false,
      code: "tls_handshake_stall_tls13_only",
      summary: "TLS 1.2 succeeds while the TLS 1.3 ClientHello stalls.",
      action: "Check the egress proxy or firewall for ClientHello inspection that blocks TLS 1.3, or bypass inspection for this host.",
    };
  }
  if (facts.tls12.ok || facts.tls13.ok) {
    return {
      ok: true,
      code: "tls_ok",
      summary: "The endpoint completed a verified TLS handshake.",
      action: "No TLS transport action is required.",
    };
  }
  return {
    ok: false,
    code: "tls_unreachable",
    summary: `The endpoint did not complete TLS 1.2 or TLS 1.3 (${facts.tls12.errorCode ?? "unknown"}; ${facts.tls13.errorCode ?? "unknown"}).`,
    action: "Check DNS, outbound routing, proxy policy, and the endpoint certificate chain.",
  };
}
