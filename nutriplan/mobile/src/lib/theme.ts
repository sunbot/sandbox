/**
 * Colors for screens not yet rebuilt on the design system (src/theme + src/components/ds).
 * They mirror the "Hearth" dark palette in src/theme/tokens.ts so the whole app looks like one product.
 * Macro colors match the validated dark macro set; status colors are calm and always shown with a label or number.
 */
export const colors = {
  background: '#121514',
  surface: '#1A1E1C',
  surfaceMuted: '#262B29',
  border: '#2B312E',
  text: '#EEEAE3',
  textSecondary: '#ADA79D',
  textMuted: '#968F85',
  primary: '#86BFAE',
  primaryText: '#10201B',
  danger: '#E08A7A',
  accent: '#E3A178',
  attention: '#2E2619', // warm amber tint for "needs a look" rows

  calories: '#86BFAE',
  protein: '#5A8FD4',
  carbs: '#BA8733',
  fat: '#C0628F',

  // Status levels (fixed meaning; always shown with a label or number too).
  good: '#8CC59E',
  fair: '#D9A35E',
  low: '#C98F5E',
  high: '#E08A7A',
  none: '#2B312E',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 20, pill: 999 };

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
