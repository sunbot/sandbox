import { Platform, type TextStyle } from 'react-native';

/**
 * NutriPlan design tokens (UI/UX spec v1).
 *
 * Every redesigned screen reads colors, type, spacing and motion from here via `useTheme()`.
 * Screens not yet redesigned still use `src/lib/theme.ts`; delete that file once they're migrated.
 *
 * Color notes (checked for WCAG contrast and color-vision deficiency):
 *  - `success/warning/error` are fill & icon colors. Warning (3.0:1) and success (3.9:1) are too light for
 *    small text on white, so each has a darker `*Text` variant (≥ 4.5:1) for labels.
 *  - Macro colors (blue / gold / magenta) pass all-pairs CVD checks against each other. Gold sits near
 *    warning and magenta near error, so status is never shown by color alone (always icon + word),
 *    and macro bars are always labelled.
 */

export type ColorScheme = 'light' | 'dark';

export type Palette = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;
  primary: string;
  primaryPressed: string;
  primaryLight: string;
  success: string;
  successText: string;
  successLight: string;
  warning: string;
  warningText: string;
  warningLight: string;
  error: string;
  errorText: string;
  errorLight: string;
  protein: string;
  carbs: string;
  fat: string;
  track: string;
  scrim: string;
  focus: string;
  snackbar: string;
  snackbarText: string;
  snackbarAction: string;
  /** Warm accent (apricot) for small moments of warmth: streaks, highlights, "kcal over" without alarm. */
  accent: string;
  accentText: string;
  accentLight: string;
  /** Hairline on cards so layered surfaces read as layers, not boxes. */
  cardBorder: string;
  /** Restrained gradients: card sheen (top → bottom) and the calorie ring stroke (start → end). */
  cardSheenTop: string;
  ringStart: string;
  ringEnd: string;
  /** Soft background glow behind the top of a screen. */
  glow: string;
};

const light: Palette = {
  background: '#F7F8F6',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#F0F3F1',
  border: '#E4E9E5',
  borderStrong: '#CBD3CE',
  text: '#202925',
  textSecondary: '#66736D',
  textMuted: '#7D8A84',
  textOnPrimary: '#FFFFFF',
  primary: '#287968',
  primaryPressed: '#1F6153',
  primaryLight: '#E5F2ED',
  success: '#31926B',
  successText: '#24704F',
  successLight: '#E3F3EB',
  warning: '#C98739',
  warningText: '#8A5A1F',
  warningLight: '#FBF0E2',
  error: '#C85C53',
  errorText: '#A3433B',
  errorLight: '#FBE9E7',
  protein: '#2A78D6',
  carbs: '#EDA100',
  fat: '#D55181',
  track: '#E9EEEA',
  scrim: 'rgba(16, 22, 19, 0.45)',
  focus: '#287968',
  snackbar: '#202925',
  snackbarText: '#FFFFFF',
  snackbarAction: '#8FD4BF',
  accent: '#D98B5F',
  accentText: '#9A5631',
  accentLight: '#FBEDE4',
  cardBorder: '#E4E9E5',
  cardSheenTop: '#FFFFFF',
  ringStart: '#3D9A84',
  ringEnd: '#287968',
  glow: 'rgba(40, 121, 104, 0.08)',
};

/**
 * "Hearth" — the app's dark look: warm charcoal layers, soft sage-teal, small apricot accents.
 * Text pairs are WCAG-checked (primary text 14:1, secondary 7:1, muted ≥ 4.5:1 on every surface).
 * Macro colors are validated as a categorical set on the card surface (CVD + normal-vision separation),
 * and are always labelled. Status hues are calm: sage for met, amber for "behind", coral only for over a limit.
 */
const dark: Palette = {
  background: '#121514',
  surface: '#1A1E1C',
  surfaceRaised: '#222725',
  surfaceMuted: '#262B29',
  border: '#2B312E',
  borderStrong: '#3B4340',
  text: '#EEEAE3',
  textSecondary: '#ADA79D',
  textMuted: '#968F85',
  textOnPrimary: '#10201B',
  primary: '#86BFAE',
  primaryPressed: '#74AE9C',
  primaryLight: '#1F332D',
  success: '#8CC59E',
  successText: '#93CBA5',
  successLight: '#1E3126',
  warning: '#D9A35E',
  warningText: '#E2B47A',
  warningLight: '#352A1C',
  error: '#E08A7A',
  errorText: '#EE9C8C',
  errorLight: '#3A2522',
  protein: '#5A8FD4',
  carbs: '#BA8733',
  fat: '#C0628F',
  track: '#2A302D',
  scrim: 'rgba(5, 7, 6, 0.62)',
  focus: '#86BFAE',
  snackbar: '#2C322F',
  snackbarText: '#EEEAE3',
  snackbarAction: '#9FD0C0',
  accent: '#E3A178',
  accentText: '#E8AD88',
  accentLight: '#3A2A20',
  cardBorder: 'rgba(255, 255, 255, 0.05)',
  cardSheenTop: '#1E2321',
  ringStart: '#A3D2BF',
  ringEnd: '#5FA591',
  glow: 'rgba(134, 191, 174, 0.10)',
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

/**
 * NutriPlan is dark by design ("Hearth"). Screens not yet on the new components get the same colors through
 * `src/lib/theme.ts`. Set to `null` to follow the device setting (and app.json `userInterfaceStyle` "automatic").
 */
export const FORCED_COLOR_SCHEME: ColorScheme | null = 'dark';

/** 8-pt spacing with 4-pt half steps. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40 } as const;
export const screenPadding = 20;

export const radii = { sm: 8, button: 14, card: 20, sheet: 28, pill: 999 } as const;

export const sizes = { touch: 48, icon: 22, iconSmall: 18, iconLarge: 26 } as const;

export const motion = { fast: 150, base: 200, slow: 250 } as const;

/**
 * Typography. Native Android font (Roboto) for now (spec decision 2): fontFamily stays undefined on Android.
 * Sizes are in sp-like units: React Native scales them with the user's font-size setting.
 */
const family = Platform.select({ web: 'Roboto, "Segoe UI", system-ui, -apple-system, sans-serif', default: undefined });

/** Web-only preview of large accessibility fonts, for testing (`EXPO_PUBLIC_FONT_SCALE_PREVIEW=1.6`). Android scales natively. */
export const previewScale = Platform.OS === 'web' ? Number(process.env.EXPO_PUBLIC_FONT_SCALE_PREVIEW || 1) || 1 : 1;
const fs = (n: number) => Math.round(n * previewScale);

export const type = {
  pageTitle: { fontFamily: family, fontSize: fs(28), lineHeight: fs(34), fontWeight: '600', letterSpacing: -0.3 },
  sectionTitle: { fontFamily: family, fontSize: fs(20), lineHeight: fs(26), fontWeight: '600' },
  cardTitle: { fontFamily: family, fontSize: fs(17), lineHeight: fs(22), fontWeight: '600' },
  body: { fontFamily: family, fontSize: fs(16), lineHeight: fs(22), fontWeight: '400' },
  bodyStrong: { fontFamily: family, fontSize: fs(16), lineHeight: fs(22), fontWeight: '600' },
  secondary: { fontFamily: family, fontSize: fs(14), lineHeight: fs(19), fontWeight: '400' },
  label: { fontFamily: family, fontSize: fs(13), lineHeight: fs(17), fontWeight: '500' },
  caption: { fontFamily: family, fontSize: fs(12), lineHeight: fs(16), fontWeight: '400' },
  display: { fontFamily: family, fontSize: fs(38), lineHeight: fs(44), fontWeight: '500', letterSpacing: -0.8 },
  overline: { fontFamily: family, fontSize: fs(12), lineHeight: fs(16), fontWeight: '600', letterSpacing: 0.8 },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Tabular figures for any number that should line up (calories, grams). */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export type Theme = {
  scheme: ColorScheme;
  colors: Palette;
  space: typeof space;
  radii: typeof radii;
  sizes: typeof sizes;
  type: typeof type;
  motion: typeof motion;
  screenPadding: number;
};

export const makeTheme = (scheme: ColorScheme): Theme => ({
  scheme,
  colors: palettes[scheme],
  space,
  radii,
  sizes,
  type,
  motion,
  screenPadding,
});
