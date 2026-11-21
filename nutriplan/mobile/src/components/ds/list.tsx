import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight, type LucideIcon } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';
import { AppText } from './primitives';

/**
 * Settings-style list: one quiet surface per group with hairline dividers between rows, instead of a card per row.
 * Icons are muted by default; pass `emphasis` on a row only when it really deserves the accent.
 */
export function ListGroup({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  const t = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ gap: t.space.sm }}>
      {title ? (
        <AppText variant="overline" tone="muted" accessibilityRole="header" style={{ paddingHorizontal: t.space.xs }}>
          {title.toUpperCase()}
        </AppText>
      ) : null}
      <View style={{ backgroundColor: t.colors.surface, borderRadius: t.radii.card, borderWidth: 1, borderColor: t.colors.cardBorder, overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <Fragment key={row.key ?? i}>
            {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.border, marginLeft: t.space.lg + 22 + t.space.md }} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? <View style={{ paddingHorizontal: t.space.xs }}>{footer}</View> : null}
    </View>
  );
}

/** One row: optional leading icon (21 dp, muted), title, optional one-line hint, chevron when it navigates. */
export function ListRow({ icon: Icon, title, hint, onPress, emphasis, trailing }: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  onPress?: () => void;
  /** Use the primary accent for the icon (sparingly). */
  emphasis?: boolean;
  trailing?: ReactNode;
}) {
  const t = useTheme();
  const content = (
    <>
      {Icon ? (
        <View style={{ width: 22, alignItems: 'center' }}>
          <Icon size={21} strokeWidth={1.8} color={emphasis ? t.colors.primary : t.colors.textSecondary} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2, paddingVertical: t.space.md }}>
        <AppText variant="body" numberOfLines={2}>{title}</AppText>
        {hint ? <AppText variant="secondary" tone="muted" numberOfLines={2}>{hint}</AppText> : null}
      </View>
      {trailing ?? (onPress ? <ChevronRight size={18} strokeWidth={1.8} color={t.colors.textMuted} /> : null)}
    </>
  );
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md, minHeight: 60, paddingHorizontal: t.space.lg };
  if (!onPress) return <View style={row}>{content}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={hint ? `${title}. ${hint}` : title}
      style={({ pressed }) => [row, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
      {content}
    </Pressable>
  );
}
