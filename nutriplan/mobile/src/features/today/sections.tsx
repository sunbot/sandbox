import { Pressable, ScrollView, View } from 'react-native';
import { CalendarClock, ChevronDown, ChevronUp, Mic, Plus, ScanBarcode, Search, Sparkles } from '@/components/ds/icons';
import type { Day, DiaryEntry, NutrientProgress as NP, PlanEntry, QuickLogItem, Targets } from '@/api/types';
import {
  AppCard, AppText, Badge, BottomSheet, CalorieRing, FilterChip, FoodRow, IconButton, MacroProgress, NutrientProgress,
  PrimaryButton, SecondaryButton, Skeleton, TextButton, nutrientStatus,
} from '@/components/ds';
import { amount as fmtQty, type Meal } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

const mealLabel = (m: Meal) => (m === 'Snack' ? 'Snacks' : m);
const MACRO_IDS = new Set([1008, 1003, 1004, 1005]);

/* ───────────────────────── Calorie + macro summary ───────────────────────── */

export function SummaryCard({ day, targets }: { day: Day; targets: Targets }) {
  const t = useTheme();
  const eaten = day.totals.calories;
  const goal = targets.calories;
  const left = Math.round(goal - eaten);
  const over = left < 0;
  return (
    <AppCard style={{ gap: t.space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.lg }}
        accessible accessibilityLabel={`${over ? `${-left} calories over` : `${left} calories left`}. ${Math.round(eaten)} eaten of ${Math.round(goal)} goal.`}>
        <CalorieRing eaten={eaten} target={goal} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <AppText variant="display" numeric style={over ? { color: t.colors.errorText } : undefined}>{Math.abs(left).toLocaleString()}</AppText>
            <AppText variant="secondary" tone={over ? 'error' : 'secondary'}>{over ? 'kcal over' : 'kcal left'}</AppText>
          </View>
          <AppText variant="secondary" tone="secondary" numeric>
            {Math.round(eaten).toLocaleString()} eaten · {Math.round(goal).toLocaleString()} goal
          </AppText>
        </View>
      </View>
      <View style={{ gap: t.space.md }}>
        <MacroProgress label="Protein" value={day.totals.protein} target={targets.proteinGrams} color={t.colors.protein} />
        <MacroProgress label="Carbs" value={day.totals.carbs} target={targets.carbGrams} color={t.colors.carbs} />
        <MacroProgress label="Fat" value={day.totals.fat} target={targets.fatGrams} color={t.colors.fat} />
      </View>
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

export function RecentFoods({ items, meal, onPick }: { items: QuickLogItem[]; meal: Meal; onPick: (q: QuickLogItem) => void }) {
  const t = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: t.space.xs }}>
      <AppText variant="label" tone="secondary">Recent · tap to add to {mealLabel(meal).toLowerCase()}</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space.sm, paddingRight: t.screenPadding }}
        style={{ marginRight: -t.screenPadding }}>
        {items.map((q, i) => (
          <FilterChip key={`${q.item.foodId ?? q.item.recipeId}-${i}`} icon={Plus} label={shortName(q.item.name)} trailing={`${Math.round(q.item.nutrition.calories)}`}
            accessibilityLabel={`Add ${q.item.name}, ${Math.round(q.item.nutrition.calories)} calories, to ${mealLabel(meal)}`} onPress={() => onPick(q)} />
        ))}
      </ScrollView>
    </View>
  );
}

/** "Chicken, broilers or fryers, breast…" → "Chicken" isn't helpful; keep the first two USDA segments. */
function shortName(name: string) {
  const parts = name.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ');
}

/* ───────────────────────── Meal section ───────────────────────── */

export function MealSection({ meal, totals, entries, planned, expanded, onToggle, onAdd, onEntry, onLogPlanned, loggingId }: {
  meal: Meal;
  totals: number;
  entries: DiaryEntry[];
  planned: PlanEntry[];
  expanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onEntry: (e: DiaryEntry) => void;
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
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={`${mealLabel(meal)}, ${Math.round(totals)} calories${planned.length ? `, ${planned.length} planned` : ''}`}
        accessibilityHint={expanded ? 'Collapses the meal' : 'Shows the foods in this meal'}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: t.space.lg, paddingRight: t.space.sm, gap: t.space.sm, borderRadius: t.radii.card }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
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

      {expanded ? (
        <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.xs }}>
          {entries.map((e) => (
            <FoodRow key={e.id} name={e.item.name} detail={detailFor(e.item)} calories={e.item.nutrition.calories}
              onPress={() => onEntry(e)} accessibilityHint="Edit amount, change meal, or delete" />
          ))}
          {planned.map((p) => (
            <FoodRow key={p.id} name={p.item.name} detail={detailFor(p.item)} calories={p.item.nutrition.calories}
              badge={<Badge label="Planned" tone="primary" icon={CalendarClock} />}
              trailing={<SecondaryButton label="Log" onPress={() => onLogPlanned(p)} loading={loggingId === p.id} style={{ paddingHorizontal: t.space.md }}
                accessibilityHint={`Marks ${p.item.name} as eaten`} />} />
          ))}
          <View style={{ flexDirection: 'row' }}>
            <TextButton label={`Add to ${mealLabel(meal).toLowerCase()}`} icon={Plus} onPress={onAdd} />
          </View>
        </View>
      ) : null}
    </AppCard>
  );
}

function detailFor(item: DiaryEntry['item']) {
  if (item.kind === 'QuickCalories') return 'Quick entry';
  const qty = fmtQty(item.quantity, item.unit);
  return item.grams && item.unit !== 'g' ? `${qty} · ${Math.round(item.grams)} g` : qty;
}

/* ───────────────────────── Nutrients ───────────────────────── */

/** Most important first: anything over a limit, then goals furthest from target. Macros are shown above, so excluded. */
export function rankNutrients(progress: NP[]) {
  const rank = (p: NP) => {
    const s = nutrientStatus(p.amount, p.target ?? 0, p.kind);
    const pct = p.target ? p.amount / p.target : 1;
    return s === 'over' ? -10 + -pct : s === 'met' ? 10 + pct : pct;
  };
  return progress.filter((p) => p.target && !MACRO_IDS.has(p.nutrientId)).sort((a, b) => rank(a) - rank(b));
}

export function NutrientsCard({ progress, onSeeAll, onFillGaps }: { progress: NP[]; onSeeAll: () => void; onFillGaps: () => void }) {
  const t = useTheme();
  const ranked = rankNutrients(progress);
  const attention = ranked.filter((p) => nutrientStatus(p.amount, p.target!, p.kind) !== 'met');
  const top = (attention.length ? attention : ranked).slice(0, 4);
  return (
    <AppCard style={{ gap: t.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="cardTitle" accessibilityRole="header">Nutrients</AppText>
          <AppText variant="secondary" tone="secondary">
            {attention.length ? `${attention.length} need attention` : 'All tracked nutrients on target'}
          </AppText>
        </View>
        <TextButton label="See all" onPress={onSeeAll} />
      </View>
      {top.map((p) => <NutrientProgress key={p.nutrientId} name={p.name} amount={p.amount} target={p.target!} unit={p.unit} kind={p.kind} />)}
      <SecondaryButton label="Fill gaps" icon={Sparkles} onPress={onFillGaps} fullWidth style={{ marginTop: t.space.xs }}
        accessibilityHint="Suggests foods and recipes that close today's nutrient gaps" />
    </AppCard>
  );
}

export function NutrientsSheet({ visible, onClose, progress }: { visible: boolean; onClose: () => void; progress: NP[] }) {
  const t = useTheme();
  const ranked = rankNutrients(progress);
  const attention = ranked.filter((p) => nutrientStatus(p.amount, p.target!, p.kind) !== 'met');
  const fine = ranked.filter((p) => nutrientStatus(p.amount, p.target!, p.kind) === 'met');
  return (
    <BottomSheet visible={visible} onClose={onClose} title="All nutrients today">
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: t.space.lg, gap: t.space.xs }}>
        {attention.length ? <AppText variant="label" tone="secondary" style={{ marginTop: t.space.xs }}>Needs attention</AppText> : null}
        {attention.map((p) => <NutrientProgress key={p.nutrientId} name={p.name} amount={p.amount} target={p.target!} unit={p.unit} kind={p.kind} />)}
        {fine.length ? <AppText variant="label" tone="secondary" style={{ marginTop: t.space.md }}>On track</AppText> : null}
        {fine.map((p) => <NutrientProgress key={p.nutrientId} name={p.name} amount={p.amount} target={p.target!} unit={p.unit} kind={p.kind} />)}
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
          <Skeleton width={104} height={104} radius={52} />
          <View style={{ flex: 1, gap: t.space.sm }}><Skeleton width="60%" height={34} /><Skeleton width="80%" height={14} /></View>
        </View>
        {[0, 1, 2].map((i) => <View key={i} style={{ gap: 6 }}><Skeleton width="100%" height={14} /><Skeleton width="100%" height={8} /></View>)}
      </AppCard>
      <Skeleton width="100%" height={48} radius={12} />
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} width="100%" height={56} radius={16} />)}
    </View>
  );
}
