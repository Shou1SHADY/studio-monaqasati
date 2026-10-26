import { synKey } from './materials-text';
import type { MaterialMemory, MaterialMemoryEntry } from './materials-match';

/** One document per company, written by the server only (`/api/procurement/material-memory`). */
export const MATERIAL_MEMORY = 'materialMemory';
export const MAX_MEMORY = 500;

export interface StoredMemoryEntry extends MaterialMemoryEntry {
  key: string;
  at: string;
  by: string;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** The stored list as the screens read it: only well-formed entries, the newest last. */
export function storedMemory(value: unknown): StoredMemoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): StoredMemoryEntry[] => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const text = str(e.text, 300);
    const nodeId = str(e.nodeId, 128);
    if (!text || !nodeId) return [];
    const specs = Array.isArray(e.specs)
      ? e.specs.flatMap((s): Array<{ spec: string; option: string }> => {
          const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
          return typeof o.spec === 'string' && typeof o.option === 'string' ? [{ spec: o.spec.slice(0, 200), option: o.option.slice(0, 200) }] : [];
        })
      : [];
    return [{ key: synKey(text), text, nodeId, specs, brand: typeof e.brand === 'string' ? e.brand.slice(0, 200) : null, at: str(e.at, 40), by: str(e.by, 128) }];
  });
}

/** What the user picked for a text is remembered: a second pick for the same text replaces the first; the oldest go when the list is full. */
export function rememberPick(list: StoredMemoryEntry[], entry: MaterialMemoryEntry, at: string, by: string): StoredMemoryEntry[] {
  const key = synKey(entry.text);
  const next = [...list.filter(e => e.key !== key), { ...entry, key, at, by }];
  return next.slice(-MAX_MEMORY);
}

export const memoryMap = (list: readonly StoredMemoryEntry[]): MaterialMemory => new Map(list.map(e => [e.key, e]));
