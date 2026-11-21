import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useStatus } from '@/api/hooks';
import { AppText, ListGroup, ListRow } from '@/components/ds';
import { Grid3x3, Package, Settings, ShoppingBasket, Sparkles, Target } from '@/components/ds/icons';
import { today } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Everything that isn't a daily tab, grouped by purpose: planning and shopping, nutrition, and the app itself.
 * One quiet surface per group with hairline dividers keeps it easy to scan.
 */
export default function MoreScreen() {
  const t = useTheme();
  const status = useStatus();
  const connected = !!status.data;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.screenPadding, paddingBottom: t.space.huge, gap: t.space.xxl }}>
      <ListGroup title="Plan & shop">
        <ListRow icon={ShoppingBasket} title="Grocery list" hint="From your plan, minus the pantry" onPress={() => router.push('/grocery')} />
        <ListRow icon={Package} title="Pantry" hint="What you have and can make" onPress={() => router.push('/pantry')} />
      </ListGroup>

      <ListGroup title="Nutrition">
        <ListRow icon={Sparkles} title="Fill today's gaps" hint="Ideas to round out the day"
          onPress={() => router.push({ pathname: '/gaps', params: { date: today() } })} />
        <ListRow icon={Grid3x3} title="Weekly nutrients" hint="Every nutrient, day by day"
          onPress={() => router.push({ pathname: '/insights', params: { date: today() } })} />
        <ListRow icon={Target} title="Targets" hint="Calories, macros and nutrients" onPress={() => router.push('/targets')} />
      </ListGroup>

      <ListGroup
        title="App"
        footer={status.isLoading ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}
            accessible accessibilityLabel={connected ? `Connected. ${status.data!.foods} foods.` : 'Not connected'}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: connected ? t.colors.success : t.colors.warning }} />
            <AppText variant="caption" tone="muted" numeric>
              {connected
                ? `Connected · ${status.data!.foods.toLocaleString()} foods · AI assistant ${status.data!.languageModel ? 'on' : 'off'}`
                : 'Not connected — open Settings to check the server address'}
            </AppText>
          </View>
        )}
      >
        <ListRow icon={Settings} title="Settings" hint="Server connection" onPress={() => router.push('/settings')} />
      </ListGroup>

      <AppText variant="caption" tone="muted" align="center">Intake Grid</AppText>
    </ScrollView>
  );
}
