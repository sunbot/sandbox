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
};

/** Same roles stepped for a dark surface (equivalent contrast). Not enabled until every screen supports it. */
const dark: Palette = {
  background: '#111614',
  surface: '#1A201D',
  surfaceRaised: '#212825',
  surfaceMuted: '#232B27',
  border: '#2E3833',
  borderStrong: '#425049',
  text: '#E9EEEB',
  textSecondary: '#A9B5AF',
  textMuted: '#8B9790',
  textOnPrimary: '#0E1412',
  primary: '#5DBBA4',
  primaryPressed: '#4AA48E',
  primaryLight: '#1E3631',
  success: '#4FB98B',
  successText: '#6FCDA2',
  successLight: '#1B3229',
  warning: '#E0A35A',
  warningText: '#EDB878',
  warningLight: '#3A2C1A',
  error: '#E07B72',
  errorText: '#EE968E',
  errorLight: '#3D2220',
  protein: '#5A9BEA',
  carbs: '#F0B429',
  fat: '#E27AA0',
  track: '#2A332F',
  scrim: 'rgba(0, 0, 0, 0.6)',
  focus: '#5DBBA4',
  snackbar: '#E9EEEB',
  snackbarText: '#111614',
  snackbarAction: '#1F6153',
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

/**
 * The whole app stays light until every screen is migrated to `useTheme()` (spec decision 3).
 * Set to `null` to follow the device setting, and change app.json `userInterfaceStyle` to "automatic".
 */
export const FORCED_COLOR_SCHEME: ColorScheme | null = 'light';

/** 8-pt spacing with 4-pt half steps. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40 } as const;
export const screenPadding = 20;

export const radii = { sm: 8, button: 12, card: 16, sheet: 24, pill: 999 } as const;

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
  pageTitle: { fontFamily: family, fontSize: fs(28), lineHeight: fs(34), fontWeight: '600' },
  sectionTitle: { fontFamily: family, fontSize: fs(20), lineHeight: fs(26), fontWeight: '600' },
  cardTitle: { fontFamily: family, fontSize: fs(17), lineHeight: fs(22), fontWeight: '600' },
  body: { fontFamily: family, fontSize: fs(16), lineHeight: fs(22), fontWeight: '400' },
  bodyStrong: { fontFamily: family, fontSize: fs(16), lineHeight: fs(22), fontWeight: '600' },
  secondary: { fontFamily: family, fontSize: fs(14), lineHeight: fs(19), fontWeight: '400' },
  label: { fontFamily: family, fontSize: fs(13), lineHeight: fs(17), fontWeight: '500' },
  caption: { fontFamily: family, fontSize: fs(12), lineHeight: fs(16), fontWeight: '400' },
  display: { fontFamily: family, fontSize: fs(34), lineHeight: fs(40), fontWeight: '600' },
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
