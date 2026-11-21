import { Pressable, View } from 'react-native';
import { AppText } from '@/components/ds';
import { useTheme } from '@/theme/ThemeProvider';
import { modeLabel, type NutritionMode } from './nutritionView';

/**
 * Chooses how the nutrition numbers are *displayed*: per serving, whole recipe, or per 100 g. It changes nothing
 * about how many servings the recipe makes or how much you are about to log.
 */
export function ServingModeSelector({ modes, value, onChange }: { modes: NutritionMode[]; value: NutritionMode; onChange: (m: NutritionMode) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel="Show nutrition"
      style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceMuted, borderRadius: t.radii.button, padding: 3, gap: 3 }}>
      {modes.map((m) => {
        const selected = m === value;
        return (
          <Pressable key={m} onPress={() => onChange(m)} accessibilityRole="tab" accessibilityLabel={modeLabel[m]} accessibilityState={{ selected }}
            style={({ pressed }) => ({
              flex: 1, minHeight: t.sizes.touch - 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.space.sm, borderRadius: t.radii.button - 3,
              backgroundColor: selected ? t.colors.surfaceRaised : 'transparent', borderWidth: 1, borderColor: selected ? t.colors.borderStrong : 'transparent',
              opacity: pressed ? 0.85 : 1,
            })}>
            <AppText variant="secondary" align="center" tone={selected ? 'default' : 'secondary'} style={{ fontWeight: selected ? '700' : '500' }}>{modeLabel[m]}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
