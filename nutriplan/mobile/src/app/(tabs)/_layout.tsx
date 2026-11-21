import { Tabs } from 'expo-router';
import { CalendarDays, ChefHat, House, Menu, MessageCircle, type LucideIcon } from '@/components/ds/icons';
import type { ColorValue } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

function tabIcon(Icon: LucideIcon) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon size={24} color={color as string} strokeWidth={focused ? 2.3 : 1.9} />;
  };
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.colors.primary,
        tabBarInactiveTintColor: t.colors.textMuted,
        // A quiet bar that sits on the page: same charcoal family, a hairline instead of a hard edge.
        tabBarStyle: { backgroundColor: t.colors.surface, borderTopColor: t.colors.cardBorder, borderTopWidth: 1, elevation: 0 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },
        headerStyle: { backgroundColor: t.colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600', color: t.colors.text },
        headerTintColor: t.colors.primary,
        sceneStyle: { backgroundColor: t.colors.background },
      }}
    >
      {/* Today draws its own header (date navigation), so the tab header is hidden there. */}
      <Tabs.Screen name="index" options={{ title: 'Today', headerShown: false, tabBarIcon: tabIcon(House) }} />
      <Tabs.Screen name="plan" options={{ title: 'Week', tabBarIcon: tabIcon(CalendarDays) }} />
      <Tabs.Screen name="assistant" options={{ title: 'Ask', tabBarIcon: tabIcon(MessageCircle) }} />
      <Tabs.Screen name="recipes" options={{ title: 'Recipes', tabBarIcon: tabIcon(ChefHat) }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon(Menu) }} />
    </Tabs>
  );
}
