import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { SnackbarProvider } from '@/components/ds';
import { ThemeProvider } from '@/theme/ThemeProvider';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SnackbarProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.surface },
                headerTitleStyle: { fontWeight: '600' },
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
              <Stack.Screen name="gaps" options={{ title: 'Fill the gaps' }} />
              <Stack.Screen name="grocery" options={{ title: 'Grocery list' }} />
              <Stack.Screen name="pantry" options={{ title: 'Pantry' }} />
              <Stack.Screen name="insights" options={{ title: 'Nutrients this week' }} />
              <Stack.Screen name="targets" options={{ title: 'Targets' }} />
              <Stack.Screen name="settings" options={{ title: 'Settings' }} />
            </Stack>
          </SnackbarProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
