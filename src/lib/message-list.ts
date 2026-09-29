// A list in the message files may be a JSON array or, after a key-merging tool
// has walked it, an object keyed "0", "1", … — read both (Sentry STUDIO-MONAQASATI-1).
export function messageList(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>) : []
  return values.filter((v): v is string => typeof v === "string")
}
