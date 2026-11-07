import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("Mac privacy shortcut follows physical S even when Option changes its text to ß", async () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  vi.resetModules();
  const { privacyPressed, primaryPressed, privacyShortcutLabel } =
    await import("../src/platform.ts");
  const event = {
    metaKey: true,
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    key: "ß",
    code: "KeyS",
  };
  expect(privacyPressed(event)).toBe(true);
  expect(privacyPressed({ ...event, altKey: false })).toBe(false);
  expect(privacyPressed({ ...event, shiftKey: true })).toBe(false);
  expect(primaryPressed({ metaKey: false, ctrlKey: true })).toBe(false);
  expect(privacyShortcutLabel).toBe("⌘ + ⌥ + S");
});
it("Windows uses three-key Ctrl+Alt+S, not the previous four-key combination", async () => {
  vi.stubGlobal("navigator", { platform: "Win32" });
  vi.resetModules();
  const { privacyPressed, privacyShortcutLabel } =
    await import("../src/platform.ts");
  const event = {
    metaKey: false,
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    key: "s",
    code: "KeyS",
  };
  expect(privacyPressed(event)).toBe(true);
  expect(privacyPressed({ ...event, shiftKey: true })).toBe(false);
  expect(privacyPressed({ ...event, ctrlKey: false })).toBe(false);
  expect(privacyShortcutLabel).toBe("Ctrl + Alt + S");
});
