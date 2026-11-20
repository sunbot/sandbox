/**
 * Design tokens. Change colors/spacing here and the whole app follows.
 * Macro colors are the first three slots of a CVD-validated categorical palette
 * (blue / orange / aqua); every macro mark is also text-labelled so color is never the only cue.
 */
export const colors = {
  background: '#f4f4f2',
  surface: '#fcfcfb',
  surfaceMuted: '#f0efec',
  border: '#e4e3df',
  text: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#8a8984',
  primary: '#1c5cab',
  primaryText: '#ffffff',
  danger: '#d03b3b',

  calories: '#1c5cab',
  protein: '#2a78d6',
  carbs: '#eb6834',
  fat: '#1baf7a',

  // Status levels (fixed meaning; always shown with a label or number too).
  good: '#0ca30c',
  fair: '#fab219',
  low: '#ec835a',
  high: '#d03b3b',
  none: '#e4e3df',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

export const font = {
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 17, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  small: { fontSize: 13, color: colors.textSecondary },
  tiny: { fontSize: 11, color: colors.textMuted },
  number: { fontVariant: ['tabular-nums' as const] },
};

export const levelColor: Record<string, string> = {
  good: colors.good,
  fair: colors.fair,
  low: colors.low,
  high: colors.high,
  veryHigh: colors.high,
  none: colors.none,
};
