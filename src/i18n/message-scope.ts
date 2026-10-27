import type { AbstractIntlMessages } from "next-intl"

export type PortalScope = "all" | Readonly<Record<string, true | readonly string[]>>

export const ROOT_PORTAL_SCOPE: PortalScope = { Errors: true }

const isTree = (v: unknown): v is AbstractIntlMessages => typeof v === "object" && v !== null

export function scopeMessages(messages: AbstractIntlMessages, portal: PortalScope): AbstractIntlMessages {
  if (portal === "all") return messages
  const { Portal, ...rest } = messages
  if (!isTree(Portal)) return rest
  const picked: AbstractIntlMessages = {}
  for (const [child, keys] of Object.entries(portal)) {
    const tree = Portal[child]
    if (!isTree(tree)) continue
    picked[child] = keys === true ? tree : Object.fromEntries(keys.filter((k) => k in tree).map((k) => [k, tree[k]]))
  }
  return { ...rest, Portal: picked }
}
