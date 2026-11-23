import type { GroceryItem, GroceryList } from './types';

const list = <V,>(v: unknown): V[] => (Array.isArray(v) ? (v as V[]) : []);

function item(raw: unknown): GroceryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<GroceryItem>;
  const name = typeof r.name === 'string' ? r.name : '';
  return {
    ...r,
    name,
    display: typeof r.display === 'string' ? r.display : '',
    inPantry: !!r.inPantry,
    usedIn: list<string>(r.usedIn),
    unconvertedAmounts: list<string>(r.unconvertedAmounts),
    key: typeof r.key === 'string' ? r.key : name.toLowerCase(),
  };
}

const items = (v: unknown) => list<unknown>(v).map(item).filter((i): i is GroceryItem => i !== null);

/** The wire shape isn't validated at runtime; an older API (no `hiddenItems`) or a partial payload must not crash the screen. */
export function normalizeGrocery(raw: unknown): GroceryList {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GroceryList>;
  const aisles = list<{ aisle?: unknown; items?: unknown }>(r.aisles)
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({ aisle: typeof a.aisle === 'string' ? a.aisle : 'Other', items: items(a.items) }));
  return {
    from: typeof r.from === 'string' ? r.from : '',
    to: typeof r.to === 'string' ? r.to : '',
    itemCount: typeof r.itemCount === 'number' ? r.itemCount : 0,
    aisles,
    hiddenItems: items(r.hiddenItems),
  };
}
