/**
 * True when a key event comes from a field the player is typing into. Game keys
 * listen on window, so without this a bug report walks and casts as it is written.
 * A slider is not a text field: it keeps focus after a drag and must not eat play.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement
    && !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(target.type);
}
