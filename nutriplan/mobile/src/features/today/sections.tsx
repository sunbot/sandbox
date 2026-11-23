import { Pressable, ScrollView, View } from 'react-native';
import { CalendarClock, Check, ChevronDown, ChevronUp, Ellipsis, Mic, Square, SquareCheck, Trash2, Plus, ScanBarcode, Search, Sparkles } from '@/components/ds/icons';
import type { Day, DiaryEntry, NutrientProgress as NP, PlanEntry, QuickLogItem, Targets } from '@/api/types';
import {
  AppCard, AppText, Badge, BottomSheet, CalorieRing, FilterChip, FoodRow, IconButton, MacroProgress, NutrientProgress,
  PrimaryButton, SecondaryButton, Skeleton, TextButton, nutrientStatus, nutrientStatusInProgress, type NutrientStatus,
} from '@/components/ds';
import { meals, type Meal } from '@/lib/format';
import { friendlyFoodName } from '@/lib/foodName';
import { useLargeText, useTheme } from '@/theme/ThemeProvider';
import { SwipeableDiaryRow } from '@/features/diary/SwipeableDiaryRow';
import { countText, moveTargets, selectedText } from '@/features/today/mealSelection';
import { amountText } from '@/features/quantity/quantity';

const mealLabel = (m: Meal) => (m === 'Snack' ? 'Snacks' : m);
const MACRO_IDS = new Set([1008, 1003, 1004, 1005]);

/** List name for a logged item: friendly for USDA foods; recipes and quick entries keep the name you gave them. */
export const displayName = (item: { kind: string; name: string }) => (item.kind === 'Food' ? friendlyFoodName(item.name) : item.name);

/* ───────────────────────── Calorie + macro summary ───────────────────────── */

export function SummaryCard({ day, targets }: { day: Day; targets: Targets }) {
  const t = useTheme();
  const large = useLargeText();
  const eaten = day.totals.calories;
  const goal = targets.calories;
  const left = Math.round(goal - eaten);
  const over = left < 0;
  const pct = goal > 0 ? Math.round((eaten / goal) * 100) : 0;
  const macros = [
    { label: 'Protein', value: day.totals.protein, target: targets.proteinGrams, color: t.colors.protein },
    { label: 'Carbs', value: day.totals.carbs, target: targets.carbGrams, color: t.colors.carbs },
    { label: 'Fat', value: day.totals.fat, target: targets.fatGrams, color: t.colors.fat },
  ];
  return (
    <AppCard sheen style={{ gap: t.space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.lg }}
        accessible accessibilityLabel={`${over ? `${-left} calories over` : `${left} calories left`}. ${Math.round(eaten)} eaten of ${Math.round(goal)} goal, ${pct} percent of your daily goal.`}>
        <CalorieRing eaten={eaten} target={goal} size={large ? 120 : 96} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <AppText variant="display" numeric style={over ? { color: t.colors.accentText } : undefined}>{Math.abs(left).toLocaleString()}</AppText>
            <AppText variant="secondary" tone={over ? 'accent' : 'secondary'}>{over ? 'kcal over' : 'kcal left'}</AppText>
          </View>
          <AppText variant="secondary" tone="secondary" numeric>
            {Math.round(eaten).toLocaleString()} eaten · {Math.round(goal).toLocaleString()} goal
          </AppText>
        </View>
      </View>
      {large ? (
        // Large text: one macro per row so numbers never truncate.
        <View style={{ gap: t.space.md }}>{macros.map((m) => <MacroProgress key={m.label} {...m} />)}</View>
      ) : (
        <View style={{ flexDirection: 'row', gap: t.space.lg }}>{macros.map((m) => <MacroProgress key={m.label} {...m} layout="column" />)}</View>
      )}
    </AppCard>
  );
}

/* ───────────────────────── Primary actions + recent ───────────────────────── */

export function QuickActions({ onSearch, onScan, onVoice }: { onSearch: () => void; onScan: () => void; onVoice: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'center' }}>
      <PrimaryButton label="Log food" icon={Search} onPress={onSearch} style={{ flex: 1 }} />
      <IconButton icon={ScanBarcode} label="Scan a barcode" variant="outline" onPress={onScan} />
      <IconButton icon={Mic} label="Log by voice" variant="tonal" onPress={onVoice} />
    </View>
  );
}

/**
 * Recent foods, one tap to add. The destination meal is shown and changeable right above the chips
 * (it starts at the meal for the time of day). The chips are the foods you usually have at that meal.
 */
export function RecentFoods({ items, meal, onChangeMeal, onPick }: { items: QuickLogItem[]; meal: Meal; onChangeMeal: () => void; onPick: (q: QuickLogItem) => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.xxs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space.sm, flexWrap: 'wrap' }}>
        <AppText variant="label" tone="secondary">Recent</AppText>
        <MealPickerButton meal={meal} onPress={onChangeMeal} />
      </View>
      {items.length === 0 ? (
        <AppText variant="secondary" tone="secondary" style={{ paddingVertical: t.space.xs }}>
          Foods you log at {mealLabel(meal).toLowerCase()} will show up here.
        </AppText>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space.sm, paddingRight: t.screenPadding }}
          style={{ marginRight: -t.screenPadding }}>
          {items.map((q, i) => (
            <FilterChip key={`${q.item.foodId ?? q.item.recipeId}-${i}`} icon={Plus} label={displayName(q.item)} trailing={`${Math.round(q.item.nutrition.calories)}`}
              accessibilityLabel={`Add ${displayName(q.item)}, ${Math.round(q.item.nutrition.calories)} calories, to ${mealLabel(meal)}`} onPress={() => onPick(q)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** "Add to Lunch ▾": names the destination and opens the meal choice. */
function MealPickerButton({ meal, onPress }: { meal: Meal; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Recent foods add to ${mealLabel(meal)}. Change meal`}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: t.space.md, borderRadius: t.radii.pill,
        backgroundColor: t.colors.primaryLight }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
      <AppText variant="label" tone="secondary">Add to</AppText>
      <AppText variant="label" style={{ color: t.colors.primary, fontWeight: '600' }}>{mealLabel(meal)}</AppText>
      <ChevronDown size={16} color={t.colors.primary} strokeWidth={2.4} />
    </Pressable>
  );
}

/** Choose where Recent foods go. One tap picks and closes. */
export function MealPickerSheet({ visible, meal, onPick, onClose }: { visible: boolean; meal: Meal; onPick: (m: Meal) => void; onClose: () => void }) {
  const t = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add recent foods to">
      <View style={{ paddingBottom: t.space.md }}>
        {meals.map((m) => {
          const selected = m === meal;
          return (
            <Pressable key={m} onPress={() => onPick(m)} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={mealLabel(m)}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: t.space.md, borderRadius: t.radii.button, gap: t.space.md },
                selected && { backgroundColor: t.colors.primaryLight }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
              <AppText variant="body" style={[{ flex: 1 }, selected && { color: t.colors.primary, fontWeight: '600' }]}>{mealLabel(m)}</AppText>
              {selected ? <Check size={20} color={t.colors.primary} strokeWidth={2.4} /> : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

/* ───────────────────────── Meal section ───────────────────────── */

export function MealSection({ meal, totals, entries, planned, expanded, onToggle, onAdd, onEntry, onDeleteEntry, onMenu, selection, onToggleSelect, onLogPlanned, loggingId }: {
  meal: Meal;
  totals: number;
  entries: DiaryEntry[];
  planned: PlanEntry[];
  expanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onEntry: (e: DiaryEntry) => void;
  onDeleteEntry: (e: DiaryEntry) => void;
  /** Opens the meal's overflow menu (Select entries / Clear meal). */
  onMenu: () => void;
  /** Set while this meal is in "Select entries" mode: the ticked entry ids. */
  selection?: string[];
  onToggleSelect: (e: DiaryEntry) => void;
  onLogPlanned: (p: PlanEntry) => void;
  loggingId?: string | null;
}) {
  const t = useTheme();
  const count = entries.length + planned.length;

  if (count === 0) {
    // Empty meal: one lightweight row.
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingLeft: t.space.lg, paddingRight: t.space.xs,
        borderRadius: t.radii.card, borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.border }}>
        <AppText variant="bodyStrong" tone="secondary">{mealLabel(meal)}</AppText>
        <TextButton label="Add" icon={Plus} onPress={onAdd} />
      </View>
    );
  }

  const plannedKcal = planned.reduce((s, p) => s + p.item.nutrition.calories, 0);
  return (
    <AppCard padded={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: t.space.xs }}>
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }}
          accessibilityLabel={`${mealLabel(meal)}, ${Math.round(totals)} calories${planned.length ? `, ${planned.length} planned` : ''}`}
          accessibilityHint={expanded ? 'Collapses the meal' : 'Shows the foods in this meal'}
          style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: t.space.lg, gap: t.space.sm, borderRadius: t.radii.card }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
          <View style={{ flex: 1, paddingVertical: t.space.sm }}>
            <AppText variant="cardTitle">{mealLabel(meal)}</AppText>
            <AppText variant="secondary" tone="secondary" numeric>
              <AppText variant="secondary" numeric style={{ fontWeight: '600' }}>{Math.round(totals)} kcal</AppText>
              {planned.length ? ` · +${Math.round(plannedKcal)} planned` : ''}
            </AppText>
          </View>
          <View style={{ width: t.sizes.touch, height: t.sizes.touch, alignItems: 'center', justifyContent: 'center' }}>
            {expanded ? <ChevronUp size={20} color={t.colors.textSecondary} /> : <ChevronDown size={20} color={t.colors.textSecondary} />}
          </View>
        </Pressable>
        {entries.length && !selection ? <IconButton icon={Ellipsis} label={`${mealLabel(meal)} actions`} onPress={onMenu} /> : null}
      </View>

      {expanded ? (
        <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.xs }}>
          {entries.map((e) => selection ? (
            <SelectableEntryRow key={e.id} entry={e} checked={selection.includes(e.id)} onToggle={() => onToggleSelect(e)} />
          ) : (
            <SwipeableDiaryRow key={e.id} name={displayName(e.item)} detail={detailFor(e.item)} calories={e.item.nutrition.calories}
              onPress={() => onEntry(e)} onDelete={() => onDeleteEntry(e)} accessibilityHint="Edit amount or meal. Swipe left to delete" />
          ))}
          {planned.map((p) => (
            <FoodRow key={p.id} name={displayName(p.item)} detail={detailFor(p.item)} calories={p.item.nutrition.calories}
              badge={<Badge label="Planned" tone="primary" icon={CalendarClock} />}
              trailing={<SecondaryButton label="Log" onPress={() => onLogPlanned(p)} loading={loggingId === p.id} style={{ paddingHorizontal: t.space.md }}
                accessibilityHint={`Marks ${displayName(p.item)} as eaten`} />} />
          ))}
          {selection ? null : (
            <View style={{ flexDirection: 'row' }}>
              <TextButton label={`Add to ${mealLabel(meal).toLowerCase()}`} icon={Plus} onPress={onAdd} />
            </View>
          )}
        </View>
      ) : null}
    </AppCard>
  );
}

/** A diary entry in "Select entries" mode: one checkbox row; tapping anywhere on it ticks it. */
function SelectableEntryRow({ entry, checked, onToggle }: { entry: DiaryEntry; checked: boolean; onToggle: () => void }) {
  const t = useTheme();
  const name = displayName(entry.item);
  const Box = checked ? SquareCheck : Square;
  return (
    <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }}
      accessibilityLabel={`${name}, ${detailFor(entry.item)}, ${Math.round(entry.item.nutrition.calories)} calories`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: t.sizes.touch }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
      <View style={{ width: t.sizes.touch, height: t.sizes.touch, alignItems: 'center', justifyContent: 'center' }}>
        <Box size={22} color={checked ? t.colors.primary : t.colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none">
        <FoodRow name={name} detail={detailFor(entry.item)} calories={entry.item.nutrition.calories} />
      </View>
    </Pressable>
  );
}

/** The meal's overflow menu: Select entries, and (last, destructive) Clear meal. */
export function MealMenuSheet({ meal, count, onSelect, onClear, onClose }: { meal: Meal | null; count: number; onSelect: () => void; onClear: () => void; onClose: () => void }) {
  const t = useTheme();
  const label = meal ? mealLabel(meal) : 'Meal';
  const item = (text: string, Icon: typeof Check, onPress: () => void, danger?: boolean) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={text} disabled={count === 0} accessibilityState={{ disabled: count === 0 }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: t.space.md, borderRadius: t.radii.button, gap: t.space.md, opacity: count === 0 ? 0.5 : 1 },
        pressed && { backgroundColor: t.colors.surfaceMuted }]}>
      <Icon size={20} color={danger ? t.colors.errorText : t.colors.textSecondary} />
      <AppText variant="body" style={danger ? { color: t.colors.errorText } : undefined}>{text}</AppText>
    </Pressable>
  );
  return (
    <BottomSheet visible={meal !== null} onClose={onClose} title={label}>
      <View style={{ paddingBottom: t.space.md }}>
        {item('Select entries', SquareCheck, onSelect)}
        {item(`Clear ${label.toLowerCase()}`, Trash2, onClear, true)}
      </View>
    </BottomSheet>
  );
}

/** Bottom bar while selecting: count, Select all, Move, Delete selected, Done. Actions are disabled until something is ticked. */
export function SelectionBar({ count, allChecked, busy, bottomInset, onToggleAll, onMove, onDelete, onCancel }: {
  count: number; allChecked: boolean; busy?: boolean; bottomInset: number;
  onToggleAll: () => void; onMove: () => void; onDelete: () => void; onCancel: () => void;
}) {
  const t = useTheme();
  const none = count === 0;
  return (
    <View accessibilityViewIsModal={false}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, gap: t.space.sm, padding: t.space.md, paddingBottom: t.space.md + bottomInset,
        backgroundColor: t.colors.surface, borderTopWidth: 1, borderTopColor: t.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="bodyStrong" accessibilityLiveRegion="polite">{selectedText(count)}</AppText>
        <View style={{ flexDirection: 'row' }}>
          <TextButton label={allChecked ? 'Clear selection' : 'Select all'} onPress={onToggleAll} />
          <TextButton label="Cancel" onPress={onCancel} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: t.space.sm }}>
        <SecondaryButton label="Move" onPress={onMove} disabled={none || busy} style={{ flex: 1 }} accessibilityHint={none ? 'Select entries first' : undefined} />
        <SecondaryButton label="Delete selected" tone="danger" onPress={onDelete} disabled={none || busy} loading={busy} style={{ flex: 1 }} accessibilityHint={none ? 'Select entries first' : undefined} />
      </View>
    </View>
  );
}

/** Choose the meal the ticked entries move to (same day). */
export function MoveSheet({ visible, from, count, onPick, onClose }: { visible: boolean; from: Meal; count: number; onPick: (m: Meal) => void; onClose: () => void }) {
  const t = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Move ${countText(count)} to`}>
      <View style={{ paddingBottom: t.space.md }}>
        {moveTargets(meals, from).map((m) => (
          <Pressable key={m} onPress={() => onPick(m)} accessibilityRole="button" accessibilityLabel={`Move to ${mealLabel(m)}`}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: t.space.md, borderRadius: t.radii.button }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
            <AppText variant="body">{mealLabel(m)}</AppText>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

export function detailFor(item: DiaryEntry['item']) {
  if (item.kind === 'QuickCalories') return 'Quick entry';
  const qty = amountText(item.quantity, item.unit);
  return item.grams && item.unit !== 'g' ? `${qty} · ${Math.round(item.grams)} g` : qty;
}

/* ───────────────────────── Nutrients ───────────────────────── */

/**
 * How Today judges nutrients. A day that's still under way (today or later) isn't judged like a finished one:
 * unfinished goals are "in progress", and only goals clearly behind the calories you've eaten are "behind pace".
 * Past days use the regular low / getting there / met. Limits are always "over" once exceeded.
 */
export type NutrientMode = { inProgress: boolean; dayProgress: number };

type Scored = NP & { status: NutrientStatus; pct: number };

const ORDER: Record<NutrientStatus, number> = { over: 0, behind: 1, low: 2, fair: 3, progress: 4, met: 5 };

export function scoreNutrients(progress: NP[], mode: NutrientMode): Scored[] {
  return progress
    .filter((p) => p.target && !MACRO_IDS.has(p.nutrientId))
    .map((p) => {
      const status = mode.inProgress ? nutrientStatusInProgress(p.amount, p.target!, p.kind, mode.dayProgress) : nutrientStatus(p.amount, p.target!, p.kind);
      return { ...p, status, pct: p.amount / p.target! };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'over' ? b.pct - a.pct : a.pct - b.pct));
}

const list = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names[0]}, ${names[1]} and ${names.length - 2} more`);

/** One calm sentence: what's met, and only the things worth acting on. `alert` (over a limit) is the only part shown in the error color. */
export function nutrientSummary(scored: Scored[], mode: NutrientMode, anythingLogged: boolean): { alert?: string; text: string } {
  if (!anythingLogged) return { text: mode.inProgress ? 'Log food to see your vitamins and minerals.' : 'Nothing was logged this day.' };
  const goals = scored.filter((s) => s.kind === 'Goal');
  const met = goals.filter((s) => s.status === 'met').length;
  const over = scored.filter((s) => s.status === 'over').map((s) => s.name);
  const behind = scored.filter((s) => s.status === 'behind').map((s) => s.name);
  const low = scored.filter((s) => s.status === 'low').map((s) => s.name);
  const metText = `${met} of ${goals.length} goals met${mode.inProgress ? ' so far' : ''}`;
  const alert = over.length ? `${list(over)} over limit` : undefined;
  if (alert) return { alert, text: metText };
  if (mode.inProgress) return { text: behind.length ? `${metText} · ${list(behind)} behind pace` : `${metText} · on pace` };
  return { text: low.length ? `${metText} · ${list(low)} low` : metText };
}

export function NutrientsCard({ progress, mode, anythingLogged, onSeeAll, onFillGaps }: {
  progress: NP[]; mode: NutrientMode; anythingLogged: boolean; onSeeAll: () => void; onFillGaps: () => void;
}) {
  const t = useTheme();
  const scored = scoreNutrients(progress, mode);
  const summary = nutrientSummary(scored, mode, anythingLogged);
  const top = scored.slice(0, 4);
  return (
    <AppCard style={{ gap: t.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="cardTitle" accessibilityRole="header">Nutrients</AppText>
          <AppText variant="secondary" tone="secondary">
            {summary.alert ? <AppText variant="secondary" tone="error">{summary.alert} · </AppText> : null}
            {summary.text}
          </AppText>
        </View>
        <TextButton label="See all" onPress={onSeeAll} />
      </View>
      {anythingLogged && top.some((p) => (p.missingFrom ?? 0) > 0) ? <MinimumNote /> : null}
      {anythingLogged ? top.map((p) => <NutrientProgress key={p.nutrientId} name={p.name} amount={p.amount} target={p.target!} unit={p.unit} kind={p.kind} status={p.status} missingFrom={p.missingFrom} />) : null}
      <SecondaryButton label="Fill gaps" icon={Sparkles} onPress={onFillGaps} fullWidth style={{ marginTop: t.space.xs }}
        accessibilityHint="Suggests foods and recipes that close today's nutrient gaps" />
    </AppCard>
  );
}

/** Unknown isn't zero: some entries (quick calories, sparse labels) don't report every nutrient. */
function MinimumNote() {
  return <AppText variant="caption" tone="muted">≥ marks a minimum: some of the day’s entries don’t report that nutrient.</AppText>;
}

const GROUPS: { title: string; statuses: NutrientStatus[] }[] = [
  { title: 'Over limit', statuses: ['over'] },
  { title: 'Behind pace', statuses: ['behind'] },
  { title: 'Below target', statuses: ['low', 'fair'] },
  { title: 'In progress', statuses: ['progress'] },
  { title: 'Met or within limit', statuses: ['met'] },
];

export function NutrientsSheet({ visible, onClose, progress, mode }: { visible: boolean; onClose: () => void; progress: NP[]; mode: NutrientMode }) {
  const t = useTheme();
  const scored = scoreNutrients(progress, mode);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={mode.inProgress ? 'Nutrients so far' : 'Nutrients this day'}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: t.space.lg, gap: t.space.xs }}>
        {scored.some((p) => (p.missingFrom ?? 0) > 0) ? <MinimumNote /> : null}
        {mode.inProgress ? (
          <AppText variant="secondary" tone="secondary">
            Goals fill up as you eat. “Behind pace” means a nutrient is well behind the share of your calories you’ve already eaten.
          </AppText>
        ) : null}
        {GROUPS.map((g) => {
          const rows = scored.filter((s) => g.statuses.includes(s.status));
          if (!rows.length) return null;
          return (
            <View key={g.title} style={{ gap: t.space.xs, marginTop: t.space.sm }}>
              <AppText variant="label" tone="secondary" accessibilityRole="header">{g.title}</AppText>
              {rows.map((p) => <NutrientProgress key={p.nutrientId} name={p.name} amount={p.amount} target={p.target!} unit={p.unit} kind={p.kind} status={p.status} missingFrom={p.missingFrom} />)}
            </View>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

/* ───────────────────────── Loading & error ───────────────────────── */

export function TodaySkeleton() {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.lg }} accessibilityLabel="Loading today" accessible>
      <AppCard style={{ gap: t.space.lg }}>
        <View style={{ flexDirection: 'row', gap: t.space.lg, alignItems: 'center' }}>
          <Skeleton width={96} height={96} radius={48} />
          <View style={{ flex: 1, gap: t.space.sm }}><Skeleton width="60%" height={34} /><Skeleton width="80%" height={14} /></View>
        </View>
        <View style={{ flexDirection: 'row', gap: t.space.lg }}>
          {[0, 1, 2].map((i) => <View key={i} style={{ flex: 1, gap: 6 }}><Skeleton width="100%" height={14} /><Skeleton width="100%" height={6} /></View>)}
        </View>
      </AppCard>
      <Skeleton width="100%" height={48} radius={12} />
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} width="100%" height={56} radius={16} />)}
    </View>
  );
}
