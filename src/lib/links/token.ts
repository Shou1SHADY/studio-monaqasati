import { randomBytes } from "crypto"

export const LINK_TOKEN_LEN = 22

const NEW_TOKEN = new RegExp(`^[A-Za-z0-9_-]{${LINK_TOKEN_LEN}}$`)
const LEGACY_TOKEN = /^[a-f0-9]{64}$/

export function mintToken(): string {
  return randomBytes(16).toString("base64url")
}

export const isLinkToken = (s: unknown): s is string => typeof s === "string" && NEW_TOKEN.test(s)

export const isLegacyLinkToken = (s: unknown): s is string => typeof s === "string" && LEGACY_TOKEN.test(s)

export function tokenFormat(s: unknown): "new" | "legacy" | null {
  if (isLinkToken(s)) return "new"
  if (isLegacyLinkToken(s)) return "legacy"
  return null
}
