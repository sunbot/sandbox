import { type ReactNode, useEffect, useState } from 'react';
import { Animated, Image, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { CircleAlert, CircleCheck, Clock, Flame, TriangleAlert, type LucideIcon } from '@/components/ds/icons';
import { useLargeText, useReducedMotion, useStyles, useTheme } from '@/theme/ThemeProvider';
import type { Theme } from '@/theme/tokens';
import { AppText, Badge } from './primitives';

const round = (n: number) => Math.round(n).toLocaleString();
/** Whole numbers for anything ≥ 10, one decimal below (e.g. 2.4 µg). Never "0.0". */
export const fmtAmount = (n: number) => (n === 0 ? '0' : n >= 10 ? round(n) : n.toFixed(1).replace(/\.0$/, ''));

/* ───────────────────────── Progress track ───────────────────────── */

function Track({ ratio, color, height = 8 }: { ratio: number; color: string; height?: number }) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: height, backgroundColor: t.colors.track, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: '100%', borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

/** One macro: name, "eaten / target g", thin bar in the macro's own color. Always labelled (color is never the only cue). */
export function MacroProgress({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const t = useTheme();
  const over = target > 0 && value > target * 1.05;
  return (
    <View accessible accessibilityLabel={`${label}: ${round(value)} of ${round(target)} grams${over ? ', over target' : ''}`} style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: t.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
          <AppText variant="label" tone="secondary" numberOfLines={1}>{label}</AppText>
        </View>
        <AppText variant="label" numeric numberOfLines={1}>
          <AppText variant="label" numeric style={{ fontWeight: '600' }}>{round(value)}</AppText>
          <AppText variant="label" tone="secondary" numeric> / {round(target)} g</AppText>
        </AppText>
      </View>
      <Track ratio={target > 0 ? value / target : 0} color={color} />
    </View>
  );
}

export type NutrientStatus = 'low' | 'fair' | 'met' | 'over';

/**
 * A micronutrient row. Status is shown with icon + word + number (never color alone).
 * Goals: low < 50 %, fair < 90 %, met ≥ 90 %. Limits: over > 100 %.
 */
export function NutrientProgress({ name, amount, target, unit, kind }: { name: string; amount: number; target: number; unit: string; kind: 'Goal' | 'Limit' }) {
  const t = useTheme();
  const status = nutrientStatus(amount, target, kind);
  const meta: Record<NutrientStatus, { icon: LucideIcon; word: string; color: string; text: 'warning' | 'error' | 'success' | 'secondary' }> = {
    low: { icon: TriangleAlert, word: 'Low', color: t.colors.warning, text: 'warning' },
    fair: { icon: CircleAlert, word: 'Getting there', color: t.colors.warning, text: 'secondary' },
    met: { icon: CircleCheck, word: kind === 'Limit' ? 'Within limit' : 'Met', color: t.colors.success, text: 'success' },
    over: { icon: TriangleAlert, word: 'Over limit', color: t.colors.error, text: 'error' },
  };
  const m = meta[status];
  const Icon = m.icon;
  const large = useLargeText();
  const value = (
    <AppText variant="secondary" numeric numberOfLines={1}>
      <AppText variant="secondary" numeric style={{ fontWeight: '600' }}>{fmtAmount(amount)}</AppText>
      <AppText variant="secondary" tone="secondary" numeric> / {fmtAmount(target)} {unit}</AppText>
    </AppText>
  );
  if (large) {
    // Large text: name on its own line, then amount + status, then the bar.
    return (
      <View accessible accessibilityLabel={`${name}: ${fmtAmount(amount)} of ${fmtAmount(target)} ${unit}, ${m.word}`} style={{ gap: 4, paddingVertical: t.space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <Icon size={18} color={m.color} strokeWidth={2.2} />
          <AppText variant="body" style={{ flex: 1 }}>{name}{kind === 'Limit' ? ' · limit' : ''}</AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: t.space.sm }}>
          {value}
          <AppText variant="caption" tone={m.text}>{m.word}</AppText>
        </View>
        <Track ratio={target > 0 ? amount / target : 0} color={m.color} height={6} />
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={`${name}: ${fmtAmount(amount)} of ${fmtAmount(target)} ${unit}, ${m.word}`} style={{ gap: 6, paddingVertical: t.space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <Icon size={18} color={m.color} strokeWidth={2.2} />
        <AppText variant="body" style={{ flex: 1 }} numberOfLines={2}>{name}{kind === 'Limit' ? <AppText variant="secondary" tone="secondary"> · limit</AppText> : null}</AppText>
        {value}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingLeft: 26 }}>
        <View style={{ flex: 1 }}><Track ratio={target > 0 ? amount / target : 0} color={m.color} height={6} /></View>
        <AppText variant="caption" tone={m.text} style={{ minWidth: 72, textAlign: 'right' }} numberOfLines={1}>{m.word}</AppText>
      </View>
    </View>
  );
}

export function nutrientStatus(amount: number, target: number, kind: 'Goal' | 'Limit'): NutrientStatus {
  const pct = target > 0 ? amount / target : 0;
  if (kind === 'Limit') return pct > 1 ? 'over' : 'met';
  return pct < 0.5 ? 'low' : pct < 0.9 ? 'fair' : 'met';
}

/* ───────────────────────── Calorie ring ───────────────────────── */

/** Compact ring for the day's calories. The number beside it is the read-out; the ring is a glanceable echo. */
export function CalorieRing({ eaten, target, size = 104 }: { eaten: number; target: number; size?: number }) {
  const t = useTheme();
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = target > 0 ? eaten / target : 0;
  const over = ratio > 1.0001;
  const filled = Math.min(Math.max(ratio, 0), 1);
  return (
    <View style={{ width: size, height: size }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.track} strokeWidth={stroke} fill="none" />
        {filled > 0 ? (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={over ? t.colors.error : t.colors.primary} strokeWidth={stroke} fill="none"
            strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - filled)} />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Flame size={22} color={over ? t.colors.error : t.colors.primary} strokeWidth={2} />
        <AppText variant="caption" tone="secondary" numeric>{Math.round(ratio * 100)}%</AppText>
      </View>
    </View>
  );
}

/* ───────────────────────── Food row ───────────────────────── */

export function FoodRow({ name, detail, calories, badge, onPress, trailing, accessibilityHint }: {
  name: string;
  detail?: string;
  calories: number;
  badge?: ReactNode;
  onPress?: () => void;
  trailing?: ReactNode;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const s = useStyles(rowStyles);
  const large = useLargeText();
  if (large) {
    // Large text: name gets the full width; calories, badge and actions go underneath.
    return (
      <Row onPress={onPress} label={`${name}, ${detail ? detail + ', ' : ''}${Math.round(calories)} calories`} hint={accessibilityHint}
        style={[s.row, { flexDirection: 'column', alignItems: 'stretch', gap: 4 }]} pressedStyle={{ backgroundColor: t.colors.surfaceMuted }}>
        <AppText variant="body" numberOfLines={4}>{name}</AppText>
        <AppText variant="secondary" tone="secondary" numeric>
          <AppText variant="secondary" numeric style={{ fontWeight: '600' }}>{Math.round(calories)} kcal</AppText>{detail ? ` · ${detail}` : ''}
        </AppText>
        {badge || trailing ? <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: t.space.sm }}>{badge}{trailing}</View> : null}
      </Row>
    );
  }
  return (
    <Row onPress={onPress} label={`${name}, ${detail ? detail + ', ' : ''}${Math.round(calories)} calories`} hint={accessibilityHint}
      style={s.row} pressedStyle={{ backgroundColor: t.colors.surfaceMuted }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" numberOfLines={2}>{name}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
          {badge}
          {detail ? <AppText variant="secondary" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>{detail}</AppText> : null}
        </View>
      </View>
      <AppText variant="bodyStrong" numeric style={{ minWidth: 40, textAlign: 'right' }}>{Math.round(calories)}</AppText>
      {trailing}
    </Row>
  );
}

/**
 * A row is only a button when it has an action. A row without one (e.g. a planned food whose action is its own
 * Log button) is a plain View, so it doesn't mark its children as disabled for screen readers.
 */
function Row({ onPress, label, hint, style, pressedStyle, children }: {
  onPress?: () => void; label: string; hint?: string; style: StyleProp<ViewStyle>; pressedStyle: ViewStyle; children: ReactNode;
}) {
  if (!onPress) return <View style={style} accessibilityLabel={label}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      style={({ pressed }) => [style, pressed && pressedStyle]}>
      {children}
    </Pressable>
  );
}

const rowStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 56, paddingVertical: t.space.sm, paddingHorizontal: t.space.sm, marginHorizontal: -t.space.sm, borderRadius: t.radii.sm },
  });

/* ───────────────────────── Recipe card ───────────────────────── */

/** Image-led recipe card (built for the Recipes redesign; not used on Today). */
export function RecipeCard({ title, imageUri, imageHeaders, calories, protein, time, onPress }: {
  title: string; imageUri?: string | null; imageHeaders?: Record<string, string>; calories: number; protein: number; time?: string | null; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}, ${Math.round(calories)} calories, ${Math.round(protein)} grams protein per serving`}
      style={({ pressed }) => [{ backgroundColor: t.colors.surface, borderRadius: t.radii.card, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, overflow: 'hidden' }, pressed && { opacity: 0.9 }]}>
      <View style={{ aspectRatio: 16 / 10, backgroundColor: t.colors.surfaceMuted }}>
        {imageUri ? <Image source={{ uri: imageUri, headers: imageHeaders }} style={{ width: '100%', height: '100%' }} /> : null}
      </View>
      <View style={{ padding: t.space.md, gap: 4 }}>
        <AppText variant="cardTitle" numberOfLines={2}>{title}</AppText>
        <View style={{ flexDirection: 'row', gap: t.space.md, flexWrap: 'wrap' }}>
          <AppText variant="secondary" tone="secondary" numeric>{Math.round(calories)} kcal</AppText>
          <AppText variant="secondary" tone="secondary" numeric>{Math.round(protein)} g protein</AppText>
          {time ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Clock size={14} color={t.colors.textSecondary} /><AppText variant="secondary" tone="secondary">{time}</AppText></View> : null}
        </View>
      </View>
    </Pressable>
  );
}

/* ───────────────────────── Empty state & skeleton ───────────────────────── */

export function EmptyState({ icon: Icon, title, body, action }: { icon?: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: t.space.xxl, paddingHorizontal: t.space.lg, gap: t.space.sm }}>
      {Icon ? <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: t.space.xs }}><Icon size={26} color={t.colors.primary} /></View> : null}
      <AppText variant="cardTitle" align="center">{title}</AppText>
      {body ? <AppText variant="secondary" tone="secondary" align="center">{body}</AppText> : null}
      {action ? <View style={{ marginTop: t.space.sm }}>{action}</View> : null}
    </View>
  );
}

/** Pulsing placeholder block for loading states (static when reduced motion is on). */
export function Skeleton({ width, height, radius }: { width: number | `${number}%`; height: number; radius?: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const pulse = useState(() => new Animated.Value(0.6))[0];
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.6, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return <Animated.View style={{ width, height, borderRadius: radius ?? t.radii.sm, backgroundColor: t.colors.track, opacity: pulse }} />;
}

export { Badge };
