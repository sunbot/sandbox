import { View } from 'react-native';
import type { RecipeDetail } from '@/api/types';
import { AppText, IconButton } from '@/components/ds';
import { Clock, Pencil, Star } from '@/components/ds/icons';
import { RecipeThumb } from './RecipeThumb';
import { useServerAuth } from '@/lib/authImage';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Name, photo (or a plain placeholder), description, time and the favorite/edit actions. Only data the recipe really
 * has is shown: no photo, time or description is ever made up.
 */
export function RecipeHeader({ recipe, onFavorite, onEdit }: { recipe: RecipeDetail; onFavorite: () => void; onEdit: () => void }) {
  const t = useTheme();
  const s = recipe.summary;
  const server = useServerAuth();
  const time = s.totalTime || [recipe.prepTime && `Prep ${recipe.prepTime}`, recipe.cookTime && `Cook ${recipe.cookTime}`].filter(Boolean).join(' · ');

  return (
    <View style={{ flexDirection: 'row', gap: t.space.lg, alignItems: 'flex-start' }}>
      <RecipeThumb recipe={s} server={server} size={84} radius={t.radii.card} iconSize={30} />
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
