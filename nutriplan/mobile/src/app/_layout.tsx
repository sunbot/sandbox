import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { SnackbarProvider } from '@/components/ds';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AuthProvider } from '@/auth/AuthProvider';
import { AuthGate } from '@/auth/AuthGate';

/** Navigation chrome in the same warm charcoal, so screen changes never flash white. */
const navigationTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, primary: colors.primary, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, notification: colors.accent },
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout() {
  return (
    // Swipe gestures (diary rows) need the gesture handler at the root of the app.
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
        <ThemeProvider>
          <NavigationThemeProvider value={navigationTheme}>
          <SnackbarProvider>
            <StatusBar style="light" />
            <AuthGate>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.background },
                headerShadowVisible: false,
                headerTitleStyle: { fontWeight: '600', color: colors.text },
                headerTintColor: colors.primary,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="food/search" options={{ title: 'Add food', presentation: 'modal' }} />
              <Stack.Screen name="food/[id]" options={{ title: 'Amount' }} />
              <Stack.Screen name="scan" options={{ title: 'Scan barcode', presentation: 'fullScreenModal' }} />
              <Stack.Screen name="quick-add" options={{ title: 'Quick calories', presentation: 'modal' }} />
              <Stack.Screen name="custom-food" options={{ title: 'New food from label' }} />
              <Stack.Screen name="recipe/[id]" options={{ title: 'Recipe' }} />
              <Stack.Screen name="recipe/edit" options={{ title: 'Edit recipe' }} />
              <Stack.Screen name="recipe/amount" options={{ title: 'Add recipe' }} />
              <Stack.Screen name="gaps" options={{ title: 'Fill the gaps' }} />
              <Stack.Screen name="grocery" options={{ title: 'Grocery list' }} />
              <Stack.Screen name="pantry" options={{ title: 'Pantry' }} />
              <Stack.Screen name="insights" options={{ title: 'Nutrients' }} />
              <Stack.Screen name="targets" options={{ title: 'Targets' }} />
              <Stack.Screen name="settings" options={{ title: 'Settings' }} />
            </Stack>
            </AuthGate>
          </SnackbarProvider>
          </NavigationThemeProvider>
        </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
