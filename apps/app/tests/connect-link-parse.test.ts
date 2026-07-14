import { describe, expect, test } from "bun:test";
import { parseConnectDeepLink } from "../src/app/lib/openwork-links";

const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJmYWtlIjoxfQ.c2ln";

describe("parseConnectDeepLink", () => {
  test("parses production and dev desktop connect links", () => {
    const rawUrl = `openwork://connect?token=${TOKEN}`;
    expect(parseConnectDeepLink(rawUrl)).toEqual({ rawUrl, token: TOKEN });
    expect(parseConnectDeepLink(`openwork-dev://connect?token=${TOKEN}`)?.token).toBe(TOKEN);
    expect(parseConnectDeepLink(`openwork:///connect?token=${TOKEN}`)?.token).toBe(TOKEN);
  });

  test("does not activate from web URLs or unrelated desktop routes", () => {
    expect(parseConnectDeepLink(`https://openwork.example.com/connect?token=${TOKEN}`)).toBeNull();
    expect(parseConnectDeepLink(`openwork://den-auth?grant=${TOKEN}`)).toBeNull();
    expect(parseConnectDeepLink("openwork://connect")).toBeNull();
    expect(parseConnectDeepLink("not a url")).toBeNull();
  });
});
