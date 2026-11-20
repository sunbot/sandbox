import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useStatus } from '@/api/hooks';
import { Card } from '@/components/ui';
import { today } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';

const links: { title: string; hint: string; href: Href }[] = [
  { title: '🛒  Grocery list', hint: 'From your plan, minus the pantry', href: '/grocery' },
  { title: '🥫  Pantry', hint: 'What you have · what you can make', href: '/pantry' },
  { title: '▦  Nutrient heatmap', hint: 'This week, nutrient by nutrient', href: { pathname: '/insights', params: { date: today() } } },
  { title: '✨  Fill today\'s gaps', hint: 'Foods and recipes to round out the day', href: { pathname: '/gaps', params: { date: today() } } },
  { title: '🎯  Targets', hint: 'Calories, macros, nutrients, weekly budget', href: '/targets' },
  { title: '⚙️  Settings', hint: 'Server connection', href: '/settings' },
];

export default function MoreScreen() {
  const status = useStatus();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {links.map((l) => (
        <Pressable key={l.title} onPress={() => router.push(l.href)}>
          <Card style={styles.link}>
            <View style={{ flex: 1 }}>
              <Text style={font.heading}>{l.title}</Text>
              <Text style={font.small}>{l.hint}</Text>
            </View>
            <Text style={{ fontSize: 22, color: colors.textMuted }}>›</Text>
          </Card>
        </Pressable>
      ))}
      <Text style={[font.tiny, { textAlign: 'center' }]}>
        {status.data ? `${status.data.foods.toLocaleString()} foods · Claude ${status.data.languageModel ? 'on' : 'off'}` : status.error ? 'Not connected — check Settings' : ''}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
});
