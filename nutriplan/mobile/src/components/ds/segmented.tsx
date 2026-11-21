import { Pressable, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { AppText } from './primitives';

/**
 * A compact switch between a few views (2–4). Each option is a 48 dp tab with its own label; the selected one is
 * raised and bold, so the choice never depends on color alone. Labels wrap at large text instead of clipping.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceMuted, borderRadius: t.radii.button, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityLabel={o.label} accessibilityState={{ selected }}
            style={({ pressed }) => ({
              flex: 1, minHeight: t.sizes.touch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.space.sm, borderRadius: t.radii.button - 3,
              backgroundColor: selected ? t.colors.surfaceRaised : 'transparent', borderWidth: 1, borderColor: selected ? t.colors.borderStrong : 'transparent',
              opacity: pressed ? 0.85 : 1,
            })}>
            <AppText variant="secondary" align="center" tone={selected ? 'default' : 'secondary'} style={{ fontWeight: selected ? '700' : '500' }}>{o.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
