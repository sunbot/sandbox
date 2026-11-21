import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from 'react-native';
import { FORCED_COLOR_SCHEME, makeTheme, previewScale, type Theme } from './tokens';

const ThemeContext = createContext<Theme>(makeTheme('light'));

/** Provides the current theme. The scheme is forced to light until every screen supports dark (see tokens.ts). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const scheme = FORCED_COLOR_SCHEME ?? (system === 'dark' ? 'dark' : 'light');
  const theme = useMemo(() => makeTheme(scheme), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Theme-aware StyleSheet: `const styles = useStyles(makeStyles)` with `makeStyles = (t: Theme) => StyleSheet.create({...})`. */
export function useStyles<T>(factory: (t: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}

/** True when the user asked the OS to reduce motion. Animations should then be instant. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduced(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** True when the user's font size setting is large (≥ 130 %). Rows switch to stacked layouts so nothing is squeezed. */
export function useLargeText(): boolean {
  const { fontScale } = useWindowDimensions();
  return fontScale * previewScale >= 1.3;
}
