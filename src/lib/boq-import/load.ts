import { MAX_MB } from './pm-layer';
import { read } from './xfile';
import type { BinaryInput, Grid, Workbook } from './xfile';

export type LoadError = 'size' | 'type' | 'xls' | 'protected' | 'broken' | 'empty';

export interface LoadedBook {
  book: Workbook;
  grids: Grid[];
}

export class BoqLoadError extends Error {
  readonly code: LoadError;

  constructor(code: LoadError) {
    super(code);
    this.code = code;
  }
}

export async function loadBook(name: string, buf: BinaryInput): Promise<LoadedBook> {
  if (buf.byteLength > MAX_MB * 1048576) throw new BoqLoadError('size');
  let book: Workbook;
  let grids: Grid[];
  try {
    book = await read(name, buf);
    grids = await Promise.all(book.sheets.map(s => (s.hidden ? Promise.resolve([] as Grid) : book.load(s))));
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    throw new BoqLoadError(message === 'protected' || message === 'xls' || message === 'type' ? message : 'broken');
  }
  if (!grids.some(g => g.some(r => r.some(c => String(c || '').trim())))) throw new BoqLoadError('empty');
  return { book, grids };
}
