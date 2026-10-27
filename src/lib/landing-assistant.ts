/**
 * The landing assistant (`LandingChatWidget`) opens on this window event, so a
 * section can offer "ask the assistant" without importing the widget itself
 * (it is loaded lazily, client-only).
 */
export const OPEN_LANDING_ASSISTANT = "mdmak:open-assistant"

export function openLandingAssistant(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(OPEN_LANDING_ASSISTANT))
}
