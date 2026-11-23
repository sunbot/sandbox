/** A recipe's finished volume is stored in ml; it can be typed in cups (US, 236.588 ml) or ml. Pure, so it's tested. */
export type VolumeUnit = 'cups' | 'ml';

export const ML_PER_CUP = 236.5882365;

/** The ml for what was typed: null when empty (no volume), undefined when it isn't a positive number. */
export function volumeFromText(text: string, unit: VolumeUnit): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round((unit === 'cups' ? n * ML_PER_CUP : n) * 10) / 10;
}

/** A stored volume shown in a unit ("8" cups, "1892.7" ml); empty when there is none. */
export function volumeText(ml: number | null | undefined, unit: VolumeUnit): string {
  if (!ml || ml <= 0) return '';
  const v = unit === 'cups' ? ml / ML_PER_CUP : ml;
  return String(Math.round(v * 100) / 100);
}
