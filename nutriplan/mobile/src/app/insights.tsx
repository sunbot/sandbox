import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDay, useHeatmap } from '@/api/hooks';
import type { Day, Heatmap } from '@/api/types';
import { AppCard, AppText, EmptyState, FilterChip, PrimaryButton, SecondaryButton, SegmentedControl, Skeleton } from '@/components/ds';
import { Grid3x3, Sparkles } from '@/components/ds/icons';
import { HeatmapLegend, HeatmapView } from '@/features/insights/HeatmapView';
import { NutrientBar } from '@/features/insights/NutrientBar';
import { NutrientSummary } from '@/features/insights/NutrientSummary';
import { amountText, dayViews, groupViews, percentText, sourcesFor, summarize, weekViews, type NutrientView } from '@/features/insights/insights';
import { fromIsoDate, today as todayIso } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

type View_ = 'overview' | 'heatmap';
type Period = 'week' | string; // an ISO date, or the weekly average

const longDay = (iso: string) => fromIsoDate(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
const chipDay = (iso: string) => fromIsoDate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

/**
 * Nutrients: an Overview of exact amounts against goals and limits for one day (today by default) or the week's
 * average per finished day, plus the day-by-day Heatmap. Numbers come straight from the diary and the heatmap API.
 */
export default function InsightsScreen() {
  const t = useTheme();
  const today = todayIso();
  const { date = today } = useLocalSearchParams<{ date?: string }>();
  const heat = useHeatmap(date);
  const [view, setView] = useState<View_>('overview');
  const [chosen, setChosen] = useState<Period | null>(null);

  const weekDays = heat.data?.rows[0]?.days.map((d) => d.date) ?? [];
  const inWeek = weekDays.includes(today);
  const period: Period = chosen ?? (inWeek ? today : 'week');
  const day = useDay(period === 'week' ? today : period, period !== 'week');

  if (heat.isLoading) return <View style={{ padding: t.screenPadding, gap: t.space.md }}><Skeleton width="100%" height={48} radius={12} /><Skeleton width="100%" height={140} radius={20} /><Skeleton width="100%" height={320} radius={20} /></View>;
  if (heat.error || !heat.data) {
    return <EmptyState title="Couldn’t load nutrients" body={heat.error instanceof Error ? heat.error.message : 'Check your connection and try again.'} action={<SecondaryButton label="Try again" onPress={() => heat.refetch()} />} />;
  }
  const h = heat.data;

  return (
    <ScrollView contentContainerStyle={{ padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge }}>
      <SegmentedControl accessibilityLabel="Nutrients view" value={view} onChange={setView}
        options={[{ value: 'overview', label: 'Overview' }, { value: 'heatmap', label: 'Heatmap' }]} />
      {view === 'overview'
        ? <Overview heat={h} period={period} setPeriod={setChosen} today={today} weekDays={weekDays} day={day.data} dayLoading={period !== 'week' && day.isLoading} />
        : <HeatmapTab heat={h} today={today} selected={period === 'week' ? null : period} onSelectDay={(d) => { setChosen(d); setView('overview'); }} />}
      <SecondaryButton label="Fill today’s gaps" icon={Sparkles} onPress={() => router.push({ pathname: '/gaps', params: { date: today } })} fullWidth />
    </ScrollView>
  );
}

function Overview({ heat, period, setPeriod, today, weekDays, day, dayLoading }: {
  heat: Heatmap; period: Period; setPeriod: (p: Period) => void; today: string; weekDays: string[]; day?: Day; dayLoading: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState<number | null>(null);
  const isWeek = period === 'week';
  const isToday = period === today;
  const finishedDays = heat.rows[0]?.completedDays ?? 0;
  const views = useMemo(() => (isWeek ? weekViews(heat) : day ? dayViews(day, isToday) : []), [isWeek, heat, day, isToday]);
  const groups = groupViews(views);
  const summary = summarize(views);

  const caption = isWeek
    ? finishedDays > 0 ? `Average per day over ${finishedDays} finished ${finishedDays === 1 ? 'day' : 'days'} (today not included).` : 'No finished days logged this week yet. Pick today to see progress so far.'
    : isToday ? 'Today so far. Goals still filling up are in progress, not shortfalls.'
    : period > today ? 'This day hasn’t happened yet.' : `${longDay(period)}: the full day’s totals.`;

  return (
    <View style={{ gap: t.space.lg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space.sm, paddingRight: t.space.sm }}>
        <FilterChip label="Week average" selected={isWeek} onPress={() => setPeriod('week')} />
        {weekDays.filter((d) => d <= today).map((d) => (
          <FilterChip key={d} label={d === today ? 'Today' : chipDay(d)} selected={period === d} onPress={() => setPeriod(d)}
            accessibilityLabel={d === today ? 'Today' : longDay(d)} />
        ))}
      </ScrollView>

      <AppCard style={{ gap: t.space.md }}>
        <AppText variant="cardTitle" accessibilityRole="header">{isWeek ? 'This week' : isToday ? 'Today' : longDay(period)}</AppText>
        <AppText variant="secondary" tone="secondary">{caption}</AppText>
        {dayLoading ? <Skeleton width="100%" height={76} /> : summary.noData
          ? <AppText variant="body" tone="secondary">Nothing logged {isWeek ? 'on a finished day yet' : 'for this day'}.</AppText>
          : <NutrientSummary summary={summary} openWord={isToday ? 'In progress' : 'Not met yet'} />}
        {isWeek && heat.highlights.length ? heat.highlights.map((n) => <AppText key={n} variant="secondary">{n}</AppText>) : null}
      </AppCard>

      {!dayLoading && !summary.noData ? (
        <>
          <Group title="Calories & macros" views={groups.macros} open={open} setOpen={setOpen} details={(v) => <Details v={v} heat={heat} day={isWeek ? undefined : day} />} />
          <Group title="Vitamins, minerals & more" views={groups.others} open={open} setOpen={setOpen} details={(v) => <Details v={v} heat={heat} day={isWeek ? undefined : day} />} />
        </>
      ) : null}
    </View>
  );
}

function Group({ title, views, open, setOpen, details }: { title: string; views: NutrientView[]; open: number | null; setOpen: (n: number | null) => void; details: (v: NutrientView) => React.ReactNode }) {
  const t = useTheme();
  if (!views.length) return null;
  return (
    <AppCard style={{ paddingVertical: t.space.sm }}>
      <AppText variant="label" tone="secondary" accessibilityRole="header" style={{ paddingVertical: t.space.sm }}>{title}</AppText>
      {views.map((v) => (
        <NutrientBar key={v.nutrientId} view={v} expanded={open === v.nutrientId} onToggle={() => setOpen(open === v.nutrientId ? null : v.nutrientId)}>
          {details(v)}
        </NutrientBar>
      ))}
    </AppCard>
  );
}

/** Exact numbers, the days behind a weekly average, and (for one day) which logged foods supplied it. */
function Details({ v, heat, day }: { v: NutrientView; heat: Heatmap; day?: Day }) {
  const t = useTheme();
  const row = heat.rows.find((r) => r.nutrientId === v.nutrientId);
  const line = (label: string, value: string) => (
    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.sm }} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="secondary" tone="secondary">{label}</AppText>
      <AppText variant="secondary" numeric style={{ fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</AppText>
    </View>
  );
  const unit = v.unit;
  return (
    <View style={{ gap: 6 }}>
      {line(day ? 'Consumed' : 'Average per day', v.amount == null ? '–' : `${v.missing > 0 ? 'at least ' : ''}${amountText(v.amount)} ${unit}`)}
      {line(v.kind === 'Limit' ? 'Limit' : 'Goal', `${amountText(v.target)} ${unit}`)}
      {line('Share', percentText(v))}
      {v.missing > 0 ? <AppText variant="caption" tone="secondary">{day ? `${v.missing} ${v.missing === 1 ? 'entry doesn’t' : 'entries don’t'} report ${v.name.toLowerCase()}, so the real amount may be higher.` : `${v.missing} of the finished days had entries without this value, so the average may be higher.`}</AppText> : null}

      {day ? <Sources day={day} v={v} /> : row ? (
        <View style={{ gap: 2, marginTop: t.space.xs }}>
          <AppText variant="label" tone="secondary">By day</AppText>
          {row.days.filter((c) => c.percent != null).map((c) => line(fromIsoDate(c.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
            `${(c.missingFrom ?? 0) > 0 ? '≥ ' : ''}${amountText(c.amount)} ${unit} · ${Math.round(c.percent!)}%`))}
          <AppText variant="caption" tone="muted">Pick a day above to see which foods supplied it.</AppText>
        </View>
      ) : null}
    </View>
  );
}

function Sources({ day, v }: { day: Day; v: NutrientView }) {
  const t = useTheme();
  const s = sourcesFor(day, v.nutrientId);
  if (!s.sources.length && !s.unknown) return null;
  return (
    <View style={{ gap: 2, marginTop: t.space.xs }}>
      <AppText variant="label" tone="secondary">From</AppText>
      {s.sources.map((x, i) => (
        <View key={`${x.name}${i}`} style={{ flexDirection: 'row', gap: t.space.sm }} accessible accessibilityLabel={`${x.name}, ${amountText(x.amount)} ${v.unit}, ${Math.round(x.share * 100)} percent`}>
          <AppText variant="secondary" style={{ flex: 1 }} numberOfLines={2}>{x.name}</AppText>
          <AppText variant="secondary" numeric>{amountText(x.amount)} {v.unit}</AppText>
          <AppText variant="caption" tone="muted" numeric style={{ minWidth: 36, textAlign: 'right' }}>{Math.round(x.share * 100)}%</AppText>
        </View>
      ))}
      {s.unknown ? <AppText variant="caption" tone="muted">{s.unknown} {s.unknown === 1 ? 'entry has' : 'entries have'} no value for this.</AppText> : null}
    </View>
  );
}

function HeatmapTab({ heat, today, selected, onSelectDay }: { heat: Heatmap; today: string; selected: string | null; onSelectDay: (d: string) => void }) {
  const t = useTheme();
  const logged = (heat.rows[0]?.days ?? []).some((d) => d.percent != null);
  if (!logged) return <EmptyState icon={Grid3x3} title="Nothing logged this week yet" body="Each day you log fills in a column here." action={<PrimaryButton label="Go to Today" onPress={() => router.navigate('/')} />} />;
  return (
    <View style={{ gap: t.space.lg }}>
      {heat.highlights.length ? <AppCard style={{ gap: t.space.xs }}>{heat.highlights.map((n) => <AppText key={n} variant="secondary">{n}</AppText>)}</AppCard> : null}
      <AppCard style={{ gap: t.space.md }}>
        <AppText variant="caption" tone="muted">Tap a day to see its details. Scroll sideways for the whole week.</AppText>
        <HeatmapView heat={heat} today={today} selected={selected} onSelectDay={onSelectDay} />
      </AppCard>
      <HeatmapLegend />
    </View>
  );
}
