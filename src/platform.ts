export const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
export const primaryLabel = isMac ? "⌘" : "Ctrl+";
export const privacyShortcutLabel = isMac ? "⌘ + ⌥ + S" : "Ctrl + Alt + S";
export const shellPrompt = isMac ? "work@Mac ~ %" : "PS C:\\Work>";
export const primaryPressed = (
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
) => (isMac ? event.metaKey : event.ctrlKey);
export const privacyPressed = (
  event: Pick<
    KeyboardEvent,
    "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "key" | "code"
  >,
) =>
  primaryPressed(event) &&
  event.altKey &&
  !event.shiftKey &&
  (event.code === "KeyS" || event.key.toLowerCase() === "s");
