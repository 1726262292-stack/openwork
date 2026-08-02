import { notImplemented } from "./not-implemented.ts";

export interface MockGoogleDraft {
  to: string;
  body: string;
  threadId?: string;
  /** Which credential created it — the isolation witness. */
  tokenId: string;
  at: string;
}

export interface MockGoogleHandle {
  /** Base URL for DEN_GOOGLE_API_BASE_URL. */
  apiUrl: string;
  /** For DEN_GOOGLE_OAUTH_AUTHORIZE_URL / _TOKEN_URL / _USERINFO_URL. */
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  /** Drive the real chooser page shown when prompt=select_account. Resolves once the callback has been served. */
  chooseAccount(email: string, opts?: { timeoutMs?: number }): Promise<void>;
  /** Drafts attributed to ONE mailbox. Must be able to return [] as a real negative assertion. */
  draftsFor(email: string, opts?: { since?: string; timeoutMs?: number; atLeast?: number }): Promise<MockGoogleDraft[]>;
  authorizeRequestSince(iso: string, opts?: { timeoutMs?: number }): Promise<{ params: URLSearchParams }>;
  stop(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface StartMockGoogleOptions {
  accounts: string[];
  port?: number;
  publicUrl?: string;
  autoApprove?: boolean;
}

export async function startMockGoogle(options: StartMockGoogleOptions): Promise<MockGoogleHandle> {
  notImplemented(
    "startMockGoogle",
    "extend scripts/mock-oauth-mcp-server.mjs into a per-account fixture: serve /userinfo + an id_token carrying email, honour prompt=select_account with a real chooser page, and attribute every draft to the token that created it.",
  );
}
