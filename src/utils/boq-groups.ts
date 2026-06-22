import type { BoqItem } from "@/lib/boq-parser"

export interface BoqGroup {
  id: string
  titleAr: string
  categoryAr: string
  items: BoqItem[]
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Group a flat list of items by sheet name — each Excel sheet becomes one BoqGroup. */
export function buildGroups(items: BoqItem[]): BoqGroup[] {
  const map = new Map<string, BoqItem[]>()
  for (const item of items) {
    const sheet = item.sheet || item.suggestedCategory
    if (!map.has(sheet)) map.set(sheet, [])
    map.get(sheet)!.push(item)
  }
  return Array.from(map.entries()).map(([sheet, sheetItems]) => {
    const cat = sheetItems[0]?.suggestedCategory || sheet
    return {
      id: uid(),
      categoryAr: cat,
      titleAr: sheet,
      items: sheetItems,
    }
  })
}

/**
 * Move an item from one group (or unassigned) to another group (or unassigned).
 * Returns updated groups and unassigned arrays — does not mutate the originals.
 */
export function moveItemBetweenGroups(
  groups: BoqGroup[],
  unassigned: BoqItem[],
  item: BoqItem,
  fromGroupId: string | "unassigned",
  toGroupId: string | "unassigned"
): { groups: BoqGroup[]; unassigned: BoqItem[] } {
  if (fromGroupId === toGroupId) return { groups, unassigned }

  let newGroups = groups
  let newUnassigned = unassigned

  // Remove from source
  if (fromGroupId === "unassigned") {
    newUnassigned = newUnassigned.filter(i => i.id !== item.id)
  } else {
    newGroups = newGroups.map(g =>
      g.id === fromGroupId ? { ...g, items: g.items.filter(i => i.id !== item.id) } : g
    )
  }

  // Add to target
  if (toGroupId === "unassigned") {
    newUnassigned = [...newUnassigned, item]
  } else {
    newGroups = newGroups.map(g =>
      g.id === toGroupId ? { ...g, items: [...g.items, item] } : g
    )
  }

  return { groups: newGroups, unassigned: newUnassigned }
}

/**
 * Remove an item from a group and put it in the unassigned area.
 * Returns updated groups and the item appended to the caller's unassigned list.
 */
export function removeItemToUnassigned(
  groups: BoqGroup[],
  item: BoqItem,
  fromGroupId: string
): { groups: BoqGroup[]; removed: BoqItem } {
  const newGroups = groups.map(g =>
    g.id === fromGroupId ? { ...g, items: g.items.filter(i => i.id !== item.id) } : g
  )
  return { groups: newGroups, removed: item }
}

/**
 * Split an item out of its current group into a new standalone group.
 * New group title defaults to the item's Arabic description (truncated) or the category.
 * Returns the updated groups array with the new group appended.
 */
export function splitItemToNewGroup(
  groups: BoqGroup[],
  item: BoqItem,
  fromGroupId: string
): BoqGroup[] {
  const withoutItem = groups.map(g =>
    g.id === fromGroupId ? { ...g, items: g.items.filter(i => i.id !== item.id) } : g
  )
  const newGroup: BoqGroup = {
    id: uid(),
    categoryAr: item.suggestedCategory,
    titleAr: item.descriptionAr
      ? item.descriptionAr.substring(0, 60)
      : `توريد ${item.suggestedCategory}`,
    items: [item],
  }
  return [...withoutItem, newGroup]
}

/** Returns only groups that have at least one item — these are the ones that will become RFQs. */
export function getGroupsToCreate(groups: BoqGroup[]): BoqGroup[] {
  return groups.filter(g => g.items.length > 0)
}

/** Total count of items across all groups. */
export function totalGroupItems(groups: BoqGroup[]): number {
  return groups.reduce((sum, g) => sum + g.items.length, 0)
}
