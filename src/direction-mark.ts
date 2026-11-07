import { esc } from "./model.ts";
export function directionMark(
  direction: string,
  mark: string,
  appearance: string,
): string {
  if (
    !["small", "gray"].includes(appearance) ||
    !["up", "down"].includes(direction)
  )
    return esc(mark);
  // Equilateral front face (12 wide, 6√3 high), extruded down/right for thickness.
  const faces =
    direction === "up"
      ? '<path class="piece-right" d="M7 1 13 11.392 13.8 13.792 7.8 3.4Z"/><path class="piece-front" d="M1 11.392H13L13.8 13.792H1.8Z"/><path class="piece-top" d="M7 1 13 11.392H1Z"/>'
      : '<path class="piece-front" d="M1 1 7 11.392 7.8 13.792 1.8 3.4Z"/><path class="piece-right" d="M13 1 7 11.392 7.8 13.792 13.8 3.4Z"/><path class="piece-top" d="M1 1H13L7 11.392Z"/>';
  return `<svg class="direction-piece" viewBox="0 0 16 17" aria-hidden="true"><ellipse class="piece-shadow" cx="8" cy="14.7" rx="7" ry=".8"/>${faces}</svg>`;
}
