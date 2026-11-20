import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { colors, font, radius, spacing } from '@/lib/theme';

/** Small, dependency-free UI kit. Every screen builds from these so the look stays consistent. */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={font.heading}>{children}</Text>
      {right}
    </View>
  );
}

type ButtonProps = { title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; loading?: boolean; icon?: string; compact?: boolean };

export function Button({ title, onPress, variant = 'primary', disabled, loading, icon, compact }: ButtonProps) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, compact && styles.buttonCompact, { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <Text style={[styles.buttonText, { color: v.fg }]}>{icon ? `${icon}  ` : ''}{title}</Text>}
    </Pressable>
  );
}

const buttonVariants = {
  primary: { bg: colors.primary, fg: colors.primaryText, border: colors.primary },
  secondary: { bg: colors.surface, fg: colors.primary, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  danger: { bg: colors.surface, fg: colors.danger, border: colors.border },
};

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]} accessibilityState={{ selected }}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={font.small}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.textMuted} style={[styles.input, style]} {...rest} />
    </View>
  );
}

export function Loading() {
  return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as { status?: number } | null)?.status;
  const needsSetup = status === 401 || status === 0;
  return (
    <View style={styles.center}>
      <Text style={[font.body, { textAlign: 'center', marginBottom: spacing.md }]}>
        {status === 401 ? 'This server needs your API key. Enter it in Settings.' : error instanceof Error ? error.message : 'Something went wrong.'}
      </Text>
      <View style={{ gap: spacing.sm }}>
        {needsSetup ? <Button title="Open Settings" onPress={() => router.push('/settings')} /> : null}
        {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
      </View>
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={[font.body, { color: colors.textSecondary }]}>{title}</Text>
      {hint ? <Text style={[font.small, { textAlign: 'center', marginTop: 4 }]}>{hint}</Text> : null}
    </View>
  );
}

/** Data-quality badge: makes it obvious where numbers came from. */
export function QualityBadge({ quality, source }: { quality: string; source: string }) {
  const label = quality === 'Verified' ? '✓ USDA' : quality === 'Flagged' ? '⚠ Check label' : quality === 'Unverified' ? 'Unverified' : source === 'User' ? 'Yours' : 'Label';
  const color = quality === 'Verified' ? colors.good : quality === 'Flagged' ? colors.high : colors.textMuted;
  return <Text style={[styles.badge, { color, borderColor: color }]}>{label}</Text>;
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm }} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  sectionTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  button: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  buttonCompact: { minHeight: 36, paddingHorizontal: spacing.md },
  buttonText: { fontSize: 15, fontWeight: '600' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border, maxWidth: 220 },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text },
  chipTextSelected: { color: colors.primaryText, fontWeight: '600' },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surface, fontSize: 16, color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  badge: { fontSize: 11, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
});
