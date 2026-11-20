import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useHeatmap } from '@/api/hooks';
import { HeatCell } from '@/components/charts';
import { Button, Card, ErrorView, Loading } from '@/components/ui';
import { shortDay, today } from '@/lib/format';
import { colors, font, levelColor, spacing } from '@/lib/theme';

/**
 * Weekly nutrient heatmap: rows are nutrients, columns are days, each cell shows % of target.
 * Goals: low < 50 % · fair 50–90 % · good ≥ 90 %. Limits: good ≤ 100 % · high above.
 */
export default function InsightsScreen() {
  const { date = today() } = useLocalSearchParams<{ date?: string }>();
  const heat = useHeatmap(date);
  if (heat.isLoading) return <Loading />;
  if (heat.error) return <ErrorView error={heat.error} onRetry={() => heat.refetch()} />;
  const h = heat.data!;
  const days = h.rows[0]?.days ?? [];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {h.highlights.map((t) => <Card key={t}><Text style={font.body}>{t}</Text></Card>)}

      <Card>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={styles.row}>
              <Text style={[styles.label, font.tiny]}>% of target</Text>
              {days.map((d) => <Text key={d.date} style={[styles.dayHead, font.tiny]}>{shortDay(d.date).slice(0, 2)}</Text>)}
              <Text style={[styles.dayHead, font.tiny]}>avg</Text>
            </View>
            {h.rows.map((r) => (
              <View key={r.nutrientId} style={styles.row}>
                <Text style={[styles.label, font.small]} numberOfLines={1}>{r.name}{r.kind === 'Limit' ? ' ≤' : ''}</Text>
                {r.days.map((c) => <HeatCell key={c.date} level={c.level} percent={c.percent} />)}
                <Text style={[styles.avg, font.number]}>{Math.round(r.weeklyAveragePercent)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </Card>

      <View style={styles.legend}>
        {[['low', 'Low (<50%)'], ['fair', 'Fair'], ['good', 'Good'], ['high', 'Over (≤ = limit)'], ['none', 'Not logged']].map(([k, label]) => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: levelColor[k] }]} />
            <Text style={font.tiny}>{label}</Text>
          </View>
        ))}
      </View>

      <Button title="Fill today's gaps" onPress={() => router.push({ pathname: '/gaps', params: { date: today() } })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { width: 100, paddingRight: spacing.xs },
  dayHead: { width: 34, textAlign: 'center' },
  avg: { width: 34, textAlign: 'center', fontSize: 12, color: colors.textSecondary },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});
