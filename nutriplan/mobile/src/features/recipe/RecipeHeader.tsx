import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import type { RecipeDetail } from '@/api/types';
import { AppText, IconButton } from '@/components/ds';
import { Clock, Pencil, Star, Utensils } from '@/components/ds/icons';
import { loadSettings } from '@/lib/settings';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Name, photo (or a plain placeholder), description, time and the favorite/edit actions. Only data the recipe really
 * has is shown: no photo, time or description is ever made up.
 */
export function RecipeHeader({ recipe, onFavorite, onEdit }: { recipe: RecipeDetail; onFavorite: () => void; onEdit: () => void }) {
  const t = useTheme();
  const s = recipe.summary;
  const [server, setServer] = useState({ apiUrl: '', apiKey: '' });
  useEffect(() => { loadSettings().then(setServer); }, []);
  const [failed, setFailed] = useState(false);
  const hasImage = (s.hasPhoto || !!s.imageUrl) && !failed;
  const size = 84;
  const time = s.totalTime || [recipe.prepTime && `Prep ${recipe.prepTime}`, recipe.cookTime && `Cook ${recipe.cookTime}`].filter(Boolean).join(' · ');

  return (
    <View style={{ flexDirection: 'row', gap: t.space.lg, alignItems: 'flex-start' }}>
      {hasImage ? (
        <Image accessibilityIgnoresInvertColors accessibilityLabel="" onError={() => setFailed(true)}
          source={s.hasPhoto ? { uri: `${server.apiUrl}/api/recipes/${s.id}/photo`, headers: server.apiKey ? { 'X-Api-Key': server.apiKey } : undefined } : { uri: s.imageUrl! }}
          style={{ width: size, height: size, borderRadius: t.radii.card, backgroundColor: t.colors.surfaceMuted }} />
      ) : (
        <View importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: t.radii.card, backgroundColor: t.colors.surfaceMuted, borderWidth: 1, borderColor: t.colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Utensils size={30} strokeWidth={1.5} color={t.colors.textMuted} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: t.space.xs }}>
        <AppText variant="sectionTitle" accessibilityRole="header">{s.name}</AppText>
        {time ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Clock size={14} strokeWidth={2} color={t.colors.textMuted} />
            <AppText variant="secondary" tone="secondary">{time}</AppText>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', marginLeft: -t.space.sm }}>
          <IconButton icon={Star} label={s.isFavorite ? 'Favorite. Tap to remove from favorites' : 'Add to favorites'} variant={s.isFavorite ? 'tonal' : 'ghost'} onPress={onFavorite} />
          <IconButton icon={Pencil} label="Edit recipe" onPress={onEdit} />
        </View>
      </View>
    </View>
  );
}
