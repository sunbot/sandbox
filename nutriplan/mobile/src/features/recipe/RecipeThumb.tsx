import { useState } from 'react';
import { Image, View } from 'react-native';
import type { RecipeSummary } from '@/api/types';
import { Utensils } from '@/components/ds/icons';
import { recipeImage, useAuthedImage } from '@/lib/authImage';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * A recipe's photo (imported from Paprika or a link) or a plain placeholder. Stored photos need the API key, which
 * the web build can't send with a plain image request, so `useAuthedImage` fetches them there.
 */
export function RecipeThumb({ recipe, server, size, radius, iconSize = 22 }: {
  recipe: Pick<RecipeSummary, 'id' | 'hasPhoto' | 'imageUrl'>; server: { apiUrl: string; apiKey: string }; size: number; radius: number; iconSize?: number;
}) {
  const t = useTheme();
  const { uri, headers } = recipeImage(recipe, server);
  // Wait for the settings (apiUrl) before requesting a stored photo, so the first request isn't made without the key.
  const source = useAuthedImage(recipe.hasPhoto && !server.apiUrl ? null : uri, headers);
  const [failed, setFailed] = useState<string | null>(null);
  const box = { width: size, height: size, borderRadius: radius, backgroundColor: t.colors.surfaceMuted };
  if (source && failed !== uri) {
    return <Image source={source} onError={() => setFailed(uri)} accessibilityIgnoresInvertColors style={box} />;
  }
  return (
    <View importantForAccessibility="no-hide-descendants" style={[box, { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.border }]}>
      <Utensils size={iconSize} strokeWidth={1.6} color={t.colors.textMuted} />
    </View>
  );
}
