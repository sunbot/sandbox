import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native';
import { Search, X, type LucideIcon } from '@/components/ds/icons';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { tabular, type Theme, type TypeVariant } from '@/theme/tokens';

/* ───────────────────────── Typography ───────────────────────── */

type Tone = 'default' | 'secondary' | 'muted' | 'primary' | 'success' | 'warning' | 'error' | 'onPrimary';

export type AppTextProps = TextProps & { variant?: TypeVariant; tone?: Tone; numeric?: boolean; align?: 'left' | 'center' | 'right' };

/** All text goes through here so type sizes, colors and tabular numbers stay consistent. */
export function AppText({ variant = 'body', tone = 'default', numeric, align, style, ...rest }: AppTextProps) {
  const t = useTheme();
  const color = {
    default: t.colors.text,
    secondary: t.colors.textSecondary,
    muted: t.colors.textMuted,
    primary: t.colors.primary,
    success: t.colors.successText,
    warning: t.colors.warningText,
    error: t.colors.errorText,
    onPrimary: t.colors.textOnPrimary,
  }[tone];
  return <Text {...rest} style={[t.type[variant], { color }, numeric && tabular, align && { textAlign: align }, style]} />;
}

/* ───────────────────────── Card ───────────────────────── */

export function AppCard({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const s = useStyles(cardStyles);
  return <View style={[s.card, padded && s.padded, style]}>{children}</View>;
}

const cardStyles = (t: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: t.colors.surface, borderRadius: t.radii.card, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border },
    padded: { padding: t.space.lg },
  });

/* ───────────────────────── Section header ───────────────────────── */

export function SectionHeader({ title, action, actionLabel, onAction }: { title: string; action?: ReactNode; actionLabel?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: t.sizes.touch }}>
      <AppText variant="sectionTitle" accessibilityRole="header">{title}</AppText>
      {action ?? (actionLabel && onAction ? <TextButton label={actionLabel} onPress={onAction} /> : null)}
    </View>
  );
}

/* ───────────────────────── Buttons ───────────────────────── */

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  icon?: LucideIcon;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({ label, icon: Icon, loading, disabled, fullWidth, style, ...rest }: ButtonProps) {
  const t = useTheme();
  const s = useStyles(buttonStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [s.base, s.primary, pressed && { backgroundColor: t.colors.primaryPressed }, (disabled || loading) && s.disabled, fullWidth && s.full, style]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={t.colors.textOnPrimary} /> : (
        <>
          {Icon ? <Icon size={t.sizes.iconSmall} color={t.colors.textOnPrimary} strokeWidth={2.2} /> : null}
          <AppText variant="bodyStrong" tone="onPrimary" numberOfLines={1}>{label}</AppText>
        </>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ label, icon: Icon, loading, disabled, fullWidth, style, tone = 'default', ...rest }: ButtonProps & { tone?: 'default' | 'danger' }) {
  const t = useTheme();
  const s = useStyles(buttonStyles);
  const fg = tone === 'danger' ? t.colors.errorText : t.colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [s.base, s.secondary, pressed && { backgroundColor: t.colors.surfaceMuted }, (disabled || loading) && s.disabled, fullWidth && s.full, style]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {Icon ? <Icon size={t.sizes.iconSmall} color={fg} strokeWidth={2.2} /> : null}
          <AppText variant="bodyStrong" style={{ color: fg }} numberOfLines={1}>{label}</AppText>
        </>
      )}
    </Pressable>
  );
}

/** Low-emphasis text action (e.g. "See all"). Still a 48dp target. */
export function TextButton({ label, onPress, icon: Icon, tone = 'primary' }: { label: string; onPress: () => void; icon?: LucideIcon; tone?: 'primary' | 'secondary' }) {
  const t = useTheme();
  const color = tone === 'primary' ? t.colors.primary : t.colors.textSecondary;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [{ minHeight: t.sizes.touch, minWidth: t.sizes.touch, paddingHorizontal: t.space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.space.xs, borderRadius: t.radii.button }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
      {Icon ? <Icon size={t.sizes.iconSmall} color={color} strokeWidth={2.2} /> : null}
      <AppText variant="label" style={{ color, fontSize: t.type.secondary.fontSize }}>{label}</AppText>
    </Pressable>
  );
}

export function IconButton({ icon: Icon, label, onPress, variant = 'ghost', size = 'md', disabled }: {
  icon: LucideIcon;
  label: string; // accessibility label, required: icon-only buttons must be named
  onPress: () => void;
  variant?: 'ghost' | 'tonal' | 'outline';
  size?: 'md' | 'lg';
  disabled?: boolean;
}) {
  const t = useTheme();
  const dim = size === 'lg' ? 56 : t.sizes.touch;
  const bg = variant === 'tonal' ? t.colors.primaryLight : variant === 'outline' ? t.colors.surface : 'transparent';
  const border = variant === 'outline' ? t.colors.border : 'transparent';
  const fg = variant === 'ghost' ? t.colors.text : t.colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{
        width: dim, height: dim, borderRadius: t.radii.button, alignItems: 'center', justifyContent: 'center',
        backgroundColor: bg, borderWidth: 1, borderColor: border, opacity: disabled ? 0.45 : 1,
      }, pressed && { backgroundColor: variant === 'tonal' ? t.colors.primaryLight : t.colors.surfaceMuted, transform: [{ scale: 0.97 }] }]}
    >
      <Icon size={size === 'lg' ? t.sizes.iconLarge : t.sizes.icon} color={fg} strokeWidth={2} />
    </Pressable>
  );
}

const buttonStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      minHeight: t.sizes.touch, paddingHorizontal: t.space.lg, borderRadius: t.radii.button,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.space.sm, borderWidth: 1,
    },
    primary: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
    secondary: { backgroundColor: t.colors.surface, borderColor: t.colors.border },
    disabled: { opacity: 0.5 },
    full: { alignSelf: 'stretch' },
  });

/* ───────────────────────── Search field ───────────────────────── */

export function SearchField({ value, onClear, trailing, style, ...rest }: TextInputProps & { onClear?: () => void; trailing?: ReactNode }) {
    const t = useTheme();
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: t.sizes.touch, borderRadius: t.radii.button, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, paddingLeft: t.space.md }}>
        <Search size={t.sizes.iconSmall} color={t.colors.textSecondary} />
        <TextInput
          value={value}
          placeholderTextColor={t.colors.textMuted}
          returnKeyType="search"
          style={[t.type.body, { flex: 1, color: t.colors.text, paddingHorizontal: t.space.sm, minHeight: t.sizes.touch }, style]}
          {...rest}
        />
        {value && onClear ? <IconButton icon={X} label="Clear search" onPress={onClear} /> : null}
        {trailing}
      </View>
    );
}

/* ───────────────────────── Filter chip ───────────────────────── */

export function FilterChip({ label, selected, onPress, icon: Icon, accessibilityLabel, trailing }: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  accessibilityLabel?: string;
  trailing?: string; // e.g. calories, shown in tabular numbers
}) {
  const t = useTheme();
  const fg = selected ? t.colors.primary : t.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [{
        minHeight: t.sizes.touch - 8, marginVertical: 4, paddingHorizontal: t.space.md, borderRadius: t.radii.pill, maxWidth: 260,
        flexDirection: 'row', alignItems: 'center', gap: t.space.xs, borderWidth: 1,
        backgroundColor: selected ? t.colors.primaryLight : t.colors.surface,
        borderColor: selected ? t.colors.primary : t.colors.border,
      }, pressed && { backgroundColor: t.colors.surfaceMuted }]}
      hitSlop={{ top: 4, bottom: 4 }}
    >
      {Icon ? <Icon size={16} color={fg} strokeWidth={2.2} /> : null}
      <AppText variant="label" style={{ color: fg, flexShrink: 1 }} numberOfLines={1}>{label}</AppText>
      {trailing ? <AppText variant="label" tone="secondary" numeric>{trailing}</AppText> : null}
    </Pressable>
  );
}

/* ───────────────────────── Badge ───────────────────────── */

export function Badge({ label, tone = 'neutral', icon: Icon }: { label: string; tone?: 'neutral' | 'primary' | 'warning' | 'error' | 'success'; icon?: LucideIcon }) {
  const t = useTheme();
  const map = {
    neutral: [t.colors.surfaceMuted, t.colors.textSecondary],
    primary: [t.colors.primaryLight, t.colors.primary],
    warning: [t.colors.warningLight, t.colors.warningText],
    error: [t.colors.errorLight, t.colors.errorText],
    success: [t.colors.successLight, t.colors.successText],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: bg, borderRadius: t.radii.pill, paddingHorizontal: t.space.sm, paddingVertical: 2 }}>
      {Icon ? <Icon size={12} color={fg} strokeWidth={2.4} /> : null}
      <AppText variant="caption" style={{ color: fg, fontWeight: '600' }}>{label}</AppText>
    </View>
  );
}
