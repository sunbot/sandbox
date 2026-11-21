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
        tabBarInactiveTintColor: t.colors.textSecondary,
        tabBarStyle: { backgroundColor: t.colors.surface, borderTopColor: t.colors.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
        headerStyle: { backgroundColor: t.colors.surface },
        headerTitleStyle: { fontWeight: '700' },
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
