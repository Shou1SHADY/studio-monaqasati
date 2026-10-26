import { isRow } from './materials-read';
import type { ImportRow } from './materials-read';
import { label, pickOf, unitsOf } from '@/lib/materials/tree';
import type { MaterialIndex } from '@/lib/materials/tree';
import { newKey, pickFromMatch } from '@/lib/procurement/rfq-editor';
import type { EditorLine } from '@/lib/procurement/rfq-editor';

export interface AddContext {
  index: MaterialIndex;
  locale: string;
  file: string;
  /** Several sheets were read: the sheet is named in the row's source. */
  multiSheet: boolean;
}

/** An imported row is exactly the row the editor already makes: the material, its spec cells, the quantity, the unit from the material. */
function lineOf(r: ImportRow, ctx: AddContext): EditorLine {
  const node = r.nodeId ? ctx.index.byId.get(r.nodeId) ?? null : null;
  const material = node
    ? pickFromMatch(ctx.index, { nodeId: node.id, specs: r.specs, free: r.free, brand: r.brand })
    : r.outside && r.sub
      ? pickOf(ctx.index, r.sub, [], null, true)
      : null;
  const units = node ? unitsOf(ctx.index, node.id) : [];
  const unit = node && units.length ? label(units[r.u] ?? units[0], ctx.locale) : r.unitRaw;
  const hint = r.conv
    ? { quantity: r.conv.q, unit: r.conv.u, converted: true }
    : node && r.why.includes('unit')
      ? { quantity: r.qFile || null, unit: r.unitRaw, converted: false }
      : null;
  return {
    key: newKey(),
    name: node && material ? label(material.path[material.path.length - 1], ctx.locale) : r.name,
    material,
    quantity: r.qty,
    unit,
    unitFromSource: !node && Boolean(r.unitRaw),
    imported: { file: ctx.file, sheet: ctx.multiSheet ? r.sheet : null, row: r.row, text: r.text, hint },
  };
}

/** «أضِف»: the rows the review holds become editor rows, in the file's order. A row still needing a choice is finished in the editor. */
export const linesFromImport = (rows: readonly ImportRow[], ctx: AddContext): EditorLine[] => rows.filter(isRow).map(r => lineOf(r, ctx));
