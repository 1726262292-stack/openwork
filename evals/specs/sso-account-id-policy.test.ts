import { expect } from "vitest";
import { test } from "@openwork/testkit";
import { isDenTypeId } from "../../ee/packages/utils/src/typeid.js";
import { ensureDenAccountId } from "../../ee/apps/den-api/src/account-id-policy.js";

test(
  "SSO account linking keeps the IdP subject separate from Den's local account TypeID",
  async ({ evidence }) => {
    const idpSubject = "owner@openworklabs.com";
    const betterAuthDefaultId = "5Y5SfV3e1PaIhwtbz5RD7uN8bMX9U";
    const account = ensureDenAccountId({
      id: betterAuthDefaultId,
      accountId: idpSubject,
      providerId: "openwork-sso-org_example",
    });

    expect(isDenTypeId("account", account.id)).toBe(true);
    expect(account.id).not.toBe(betterAuthDefaultId);
    expect(account.accountId).toBe(idpSubject);
    evidence.recordAssertionEvidence(
      "SSO account rows use a Den TypeID without rewriting the IdP subject",
      `The foreign local ID was replaced with ${account.id}, while accountId remained ${account.accountId}.`,
      isDenTypeId("account", account.id)
        && account.id !== betterAuthDefaultId
        && account.accountId === idpSubject,
    );
  },
);
