import { describe, expect, test } from "bun:test";

import { resolveCloudProviderCredentials } from "../src/react-app/domains/connections/provider-auth/cloud-provider-config";

const AWS_ENV = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_BEARER_TOKEN_BEDROCK",
];

describe("resolveCloudProviderCredentials", () => {
  test("legacy single-credential payloads keep auth-only behaviour", () => {
    expect(
      resolveCloudProviderCredentials({
        apiKey: " sk-test ",
        apiKeys: null,
        providerConfig: { env: ["OPENROUTER_API_KEY"] },
      }),
    ).toEqual({ envEntries: [], primaryApiKey: "sk-test" });
  });

  test("multi-env payloads prefer the secret access key over positional env[0]", () => {
    const { envEntries, primaryApiKey } = resolveCloudProviderCredentials({
      apiKey: null,
      apiKeys: {
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "AKIA",
        AWS_SECRET_ACCESS_KEY: "shhh",
      },
      providerConfig: { env: AWS_ENV },
    });

    expect(envEntries).toEqual([
      { key: "AWS_ACCESS_KEY_ID", value: "AKIA" },
      { key: "AWS_SECRET_ACCESS_KEY", value: "shhh" },
      { key: "AWS_REGION", value: "us-east-1" },
    ]);
    expect(primaryApiKey).toBe("shhh");
  });

  test("Azure resource-first payloads use AZURE_API_KEY for engine auth", () => {
    const { envEntries, primaryApiKey } = resolveCloudProviderCredentials({
      apiKey: null,
      apiKeys: {
        AZURE_RESOURCE_NAME: "resource-name",
        AZURE_API_KEY: "azure-secret",
      },
      providerConfig: { env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"] },
    });

    expect(envEntries).toEqual([
      { key: "AZURE_RESOURCE_NAME", value: "resource-name" },
      { key: "AZURE_API_KEY", value: "azure-secret" },
    ]);
    expect(primaryApiKey).toBe("azure-secret");
  });

  test("the first env name with a value wins when env[0] has none", () => {
    const { primaryApiKey } = resolveCloudProviderCredentials({
      apiKey: null,
      apiKeys: { AWS_BEARER_TOKEN_BEDROCK: "bearer-token" },
      providerConfig: { env: AWS_ENV },
    });
    expect(primaryApiKey).toBe("bearer-token");
  });

  test("map keys outside the config env list are still applied, after env-ordered ones", () => {
    const { envEntries } = resolveCloudProviderCredentials({
      apiKey: null,
      apiKeys: { EXTRA_VAR: "x", AWS_REGION: "us-east-1" },
      providerConfig: { env: AWS_ENV },
    });
    expect(envEntries).toEqual([
      { key: "AWS_REGION", value: "us-east-1" },
      { key: "EXTRA_VAR", value: "x" },
    ]);
  });

  test("no credential at all yields empty results", () => {
    expect(
      resolveCloudProviderCredentials({
        apiKey: null,
        apiKeys: null,
        providerConfig: { env: AWS_ENV },
      }),
    ).toEqual({ envEntries: [], primaryApiKey: "" });
  });

  test("whitespace credentials remain missing for automatic import status", () => {
    expect(
      resolveCloudProviderCredentials({
        apiKey: "  ",
        apiKeys: { AWS_ACCESS_KEY_ID: " " },
        providerConfig: { env: AWS_ENV },
      }),
    ).toEqual({ envEntries: [], primaryApiKey: "" });
  });
});
