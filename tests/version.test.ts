import { describe, expect, it } from "vitest";
import { isNewer, newerRelease } from "../src/version.ts";

describe("version comparison", () => {
  it("orders by numbers, not text", () => {
    expect(isNewer("v0.1.12", "0.1.11")).toBe(true);
    expect(isNewer("v0.1.9", "0.1.11")).toBe(false);
    expect(isNewer("0.2.0", "0.1.99")).toBe(true);
    expect(isNewer("v0.1.11", "0.1.11")).toBe(false);
  });
  it("lets a release beat its own pre-release, and ignores what it cannot read", () => {
    expect(isNewer("v0.1.11", "0.1.11-rc1")).toBe(true);
    expect(isNewer("v0.1.11-rc1", "0.1.11")).toBe(false);
    expect(isNewer("latest", "0.1.11")).toBe(false);
  });
  it("only reports a published, non-draft, non-pre-release newer tag", async () => {
    const reply = (body: unknown, ok = true) =>
      (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
    const release = { tag_name: "v0.1.12", html_url: "https://example/r" };
    expect(await newerRelease("0.1.11", reply(release))).toEqual({
      tag: "v0.1.12",
      url: "https://example/r",
    });
    expect(await newerRelease("0.1.12", reply(release))).toBeNull();
    expect(
      await newerRelease("0.1.11", reply({ ...release, draft: true })),
    ).toBeNull();
    expect(
      await newerRelease("0.1.11", reply({ ...release, prerelease: true })),
    ).toBeNull();
    expect(await newerRelease("0.1.11", reply({}, false))).toBeNull();
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await newerRelease("0.1.11", failing)).toBeNull();
  });
});
