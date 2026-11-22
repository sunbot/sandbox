import { type ReactNode, useEffect, useState } from 'react';
import { type AccessibilityActionEvent, type AccessibilityActionInfo, Animated, Image, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { CircleAlert, CircleCheck, CircleDashed, Clock, TriangleAlert, type LucideIcon } from '@/components/ds/icons';
import { useLargeText, useReducedMotion, useStyles, useTheme } from '@/theme/ThemeProvider';
import { barFill, macroOver } from './macroOver';
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
      <View style={{ width: `${barFill(ratio, 1) * 100}%`, height: '100%', borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

/**
 * One macro: name, "eaten / target g", thin bar in the macro's own color. Always labelled (color is never the only cue).
 * `layout="column"` is the compact version used three-across in the summary card.
 * The bar can't grow past full, so going over the target is said in words ("12 g over") and the bar turns the over color,
 * like the calorie ring; the number itself is never capped.
 */
export function MacroProgress({ label, value, target, color, layout = 'row' }: { label: string; value: number; target: number; color: string; layout?: 'row' | 'column' }) {
  const t = useTheme();
  const overBy = macroOver(value, target);
  const over = overBy !== null;
  const a11y = `${label}: ${round(value)} of ${round(target)} grams${over ? `, ${round(overBy)} grams over target` : ''}`;
  const barColor = over ? t.colors.accent : color;
  const overNote = over ? <AppText variant="caption" numeric style={{ color: t.colors.accentText }} numberOfLines={1}>{round(overBy ?? 0)} g over</AppText> : null;
  const name = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <AppText variant="label" tone="secondary" numberOfLines={1}>{label}</AppText>
    </View>
  );
  const amount = (
    <AppText variant="label" numeric numberOfLines={1}>
      <AppText variant="label" numeric style={over ? { fontWeight: '600', color: t.colors.accentText } : { fontWeight: '600' }}>{round(value)}</AppText>
      <AppText variant="label" tone="secondary" numeric> / {round(target)} g</AppText>
    </AppText>
  );
  if (layout === 'column') {
    return (
      <View accessible accessibilityLabel={a11y} style={{ flex: 1, gap: 4, minWidth: 0 }}>
        {name}
        {amount}
        <Track ratio={target > 0 ? value / target : 0} color={barColor} height={6} />
        {overNote}
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={a11y} style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: t.space.sm }}>
        {name}
        {amount}
      </View>
      <Track ratio={target > 0 ? value / target : 0} color={barColor} />
      {overNote}
    </View>
  );
}

/**
 * - `low` / `fair` / `met` / `over`: a finished day (or any day, for limits). Goals: low < 50 %, fair < 90 %, met ≥ 90 %. Limits: over > 100 %.
 * - `progress`: the day isn't over and this goal is still filling up normally. Not a warning.
 * - `behind`: the day isn't over, but this goal is well behind the share of calories already eaten.
 */
export type NutrientStatus = 'low' | 'fair' | 'met' | 'over' | 'progress' | 'behind';

export function nutrientStatus(amount: number, target: number, kind: 'Goal' | 'Limit'): NutrientStatus {
  const pct = target > 0 ? amount / target : 0;
  if (kind === 'Limit') return pct > 1 ? 'over' : 'met';
  return pct < 0.5 ? 'low' : pct < 0.9 ? 'fair' : 'met';
}

/**
 * Status for a day that's still under way. A goal only counts as "behind" when you've eaten at least 30 % of your
 * calories and the nutrient is under half of that pace (e.g. 60 % of calories eaten but only 20 % of fiber).
 * Before that, unfinished goals are simply "in progress". Limits are judged as usual: over is over.
 */
export function nutrientStatusInProgress(amount: number, target: number, kind: 'Goal' | 'Limit', dayProgress: number): NutrientStatus {
  const base = nutrientStatus(amount, target, kind);
  if (kind === 'Limit' || base === 'met') return base;
  const pct = target > 0 ? amount / target : 0;
  return dayProgress >= 0.3 && pct < dayProgress * 0.5 ? 'behind' : 'progress';
}

/**
 * A micronutrient row. Status is shown with icon + word + number (never color alone).
 * Pass `status` to override the finished-day status (Today passes the in-progress one).
 */
export function NutrientProgress({ name, amount, target, unit, kind, status: statusOverride, missingFrom = 0 }: { name: string; amount: number; target: number; unit: string; kind: 'Goal' | 'Limit'; status?: NutrientStatus; missingFrom?: number }) {
  const t = useTheme();
  const status = statusOverride ?? nutrientStatus(amount, target, kind);
  const meta: Record<NutrientStatus, { icon: LucideIcon; word: string; color: string; text: 'warning' | 'error' | 'success' | 'secondary' }> = {
    // Calm by default: only 'Over limit' uses the alert triangle.
    low: { icon: CircleAlert, word: 'Low', color: t.colors.warning, text: 'warning' },
    fair: { icon: CircleDashed, word: 'Getting there', color: t.colors.textMuted, text: 'secondary' },
    met: { icon: CircleCheck, word: kind === 'Limit' ? 'Within limit' : 'Met', color: t.colors.success, text: 'success' },
    over: { icon: TriangleAlert, word: 'Over limit', color: t.colors.error, text: 'error' },
    progress: { icon: CircleDashed, word: 'In progress', color: t.colors.textMuted, text: 'secondary' },
    behind: { icon: Clock, word: 'Behind pace', color: t.colors.warning, text: 'secondary' },
  };
  const m = meta[status];
  const bar = status === 'progress' || status === 'fair' ? t.colors.primary : m.color; // still filling up: the brand color, not a grey that looks disabled
  const Icon = m.icon;
  const large = useLargeText();
  const value = (
    <AppText variant="secondary" numeric numberOfLines={1}>
      <AppText variant="secondary" numeric style={{ fontWeight: '600' }}>{missingFrom > 0 ? '≥ ' : ''}{fmtAmount(amount)}</AppText>
      <AppText variant="secondary" tone="secondary" numeric> / {fmtAmount(target)} {unit}</AppText>
    </AppText>
  );
  if (large) {
    // Large text: name on its own line, then amount + status, then the bar.
    return (
      <View accessible accessibilityLabel={`${name}: ${missingFrom > 0 ? 'at least ' : ''}${fmtAmount(amount)} of ${fmtAmount(target)} ${unit}, ${m.word}${missingFrom > 0 ? `. ${missingFrom} ${missingFrom === 1 ? 'entry has' : 'entries have'} no data for it` : ''}`} style={{ gap: 4, paddingVertical: t.space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <Icon size={18} color={m.color} strokeWidth={2.2} />
          <AppText variant="body" style={{ flex: 1 }}>{name}{kind === 'Limit' ? ' · limit' : ''}</AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: t.space.sm }}>
          {value}
          <AppText variant="caption" tone={m.text}>{m.word}</AppText>
        </View>
        <Track ratio={target > 0 ? amount / target : 0} color={bar} height={6} />
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={`${name}: ${missingFrom > 0 ? 'at least ' : ''}${fmtAmount(amount)} of ${fmtAmount(target)} ${unit}, ${m.word}${missingFrom > 0 ? `. ${missingFrom} ${missingFrom === 1 ? 'entry has' : 'entries have'} no data for it` : ''}`} style={{ gap: 6, paddingVertical: t.space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <Icon size={18} color={m.color} strokeWidth={2.2} />
        <AppText variant="body" style={{ flex: 1 }} numberOfLines={2}>{name}{kind === 'Limit' ? <AppText variant="secondary" tone="secondary"> · limit</AppText> : null}</AppText>
        {value}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingLeft: 26 }}>
        <View style={{ flex: 1 }}><Track ratio={target > 0 ? amount / target : 0} color={bar} height={6} /></View>
        <AppText variant="caption" tone={m.text} style={{ minWidth: 72, textAlign: 'right' }} numberOfLines={1}>{m.word}</AppText>
      </View>
    </View>
  );
}

/* ───────────────────────── Calorie ring ───────────────────────── */

/**
 * Compact ring for the day's calories. The center reads "38% of goal" so the percentage is never ambiguous;
 * the number beside the ring is the main read-out.
 */
export function CalorieRing({ eaten, target, size = 96 }: { eaten: number; target: number; size?: number }) {
  const t = useTheme();
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = target > 0 ? eaten / target : 0;
  const over = ratio > 1.0001;
  const filled = Math.min(Math.max(ratio, 0), 1);
  // Over the goal is shown in warm apricot, not alarm red: it's information, not a failure.
  return (
    <View style={{ width: size, height: size }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <LinearGradient id="ringStroke" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={over ? t.colors.accent : t.colors.ringStart} />
            <Stop offset="1" stopColor={over ? t.colors.accent : t.colors.ringEnd} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.track} strokeWidth={stroke} fill="none" />
        {filled > 0 ? (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke="url(#ringStroke)" strokeWidth={stroke} fill="none"
            strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - filled)} />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <AppText variant="bodyStrong" numeric style={over ? { color: t.colors.accentText } : undefined}>{Math.round(ratio * 100)}%</AppText>
        <AppText variant="caption" tone="muted">of goal</AppText>
      </View>
    </View>
  );
}

/* ───────────────────────── Food row ───────────────────────── */

export function FoodRow({ name, detail, calories, badge, onPress, trailing, accessibilityHint, accessibilityActions, onAccessibilityAction }: {
  name: string;
  detail?: string;
  calories: number;
  badge?: ReactNode;
  onPress?: () => void;
  trailing?: ReactNode;
  accessibilityHint?: string;
  /** Extra screen-reader actions on the row (e.g. Delete for a swipeable diary row). */
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
}) {
  const a11y = { actions: accessibilityActions, onAction: onAccessibilityAction };
  const t = useTheme();
  const s = useStyles(rowStyles);
  const large = useLargeText();
  if (large) {
    // Large text: name gets the full width; calories, badge and actions go underneath.
    return (
      <Row onPress={onPress} label={`${name}, ${detail ? detail + ', ' : ''}${Math.round(calories)} calories`} hint={accessibilityHint} a11y={a11y}
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
    <Row onPress={onPress} label={`${name}, ${detail ? detail + ', ' : ''}${Math.round(calories)} calories`} hint={accessibilityHint} a11y={a11y}
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
function Row({ onPress, label, hint, style, pressedStyle, children, a11y }: {
  onPress?: () => void; label: string; hint?: string; style: StyleProp<ViewStyle>; pressedStyle: ViewStyle; children: ReactNode;
  a11y?: { actions?: AccessibilityActionInfo[]; onAction?: (e: AccessibilityActionEvent) => void };
}) {
  if (!onPress) return <View style={style} accessibilityLabel={label}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      accessibilityActions={a11y?.actions} onAccessibilityAction={a11y?.onAction}
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
