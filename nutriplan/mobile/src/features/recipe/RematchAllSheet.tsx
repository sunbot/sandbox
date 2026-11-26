import { useEffect, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useRecipeMutations } from '@/api/hooks';
import type { RematchAllResult } from '@/api/types';
import { AppText, BottomSheet, PrimaryButton, SecondaryButton } from '@/components/ds';
import { friendlyFoodName } from '@/lib/foodName';
import { useTheme } from '@/theme/ThemeProvider';
import { kcalChange, lineChange } from './rematchAll';

/**
 * Re-match every recipe with the current matcher, in two steps: a preview of what would change (nothing saved), then Apply.
 * Lines you confirmed or left out yourself are kept; diary and plan entries already logged keep their own numbers.
 */
export function RematchAllSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const { rematchAll } = useRecipeMutations();
  const [result, setResult] = useState<RematchAllResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The preview is requested once per opening, from an effect (never from render, which React may repeat).
  const { mutate } = rematchAll;
  useEffect(() => {
    if (!visible) return;
    mutate(false, {
      onSuccess: (r) => { setError(null); setResult(r); },
      onError: (e) => { setResult(null); setError(e instanceof Error ? e.message : String(e)); },
    });
    return () => { setResult(null); setError(null); };
  }, [visible, mutate]);
  const apply = () => rematchAll.mutate(true, { onSuccess: setResult, onError: (e) => setError(e instanceof Error ? e.message : String(e)) });
  const changed = result?.changed ?? [];
  const busy = rematchAll.isPending;

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Update ingredient matches"
      steadyKey={`rematch:${result ? (result.applied ? 'done' : 'preview') : 'loading'}`}
      footer={<>
        {result && !result.applied && changed.length > 0
          ? <PrimaryButton label={`Apply to ${changed.length} ${changed.length === 1 ? 'recipe' : 'recipes'}`} onPress={apply} loading={busy} disabled={busy} fullWidth />
          : null}
        <SecondaryButton label={result?.applied ? 'Done' : 'Cancel'} onPress={onClose} fullWidth />
      </>}>
      <View style={{ gap: t.space.md }} accessibilityLiveRegion="polite">
        {error ? <AppText variant="secondary" tone="error">{error}</AppText> : null}
        {!result && !error ? <AppText variant="secondary" tone="secondary">Checking your recipes with the latest matching… nothing is changed yet.</AppText> : null}
        {result ? (
          <AppText variant="secondary" tone="secondary">
            {result.applied
              ? `Updated ${changed.length} ${changed.length === 1 ? 'recipe' : 'recipes'}. Recipes that use them were updated too. Foods you already logged or planned keep their numbers.`
              : changed.length === 0
                ? `Checked ${result.recipesChecked} recipes: nothing would change.`
                : `Checked ${result.recipesChecked} recipes: ${changed.length} would change. Lines you chose or left out yourself stay as they are. Nothing is saved until you apply.`}
          </AppText>
        ) : null}
        {changed.length ? (
          <ScrollView style={{ maxHeight: height * 0.5 }} contentContainerStyle={{ gap: t.space.md }}>
            {changed.map((r) => (
              <View key={r.id} style={{ gap: 2 }} accessible accessibilityLabel={`${r.name}: ${kcalChange(r)}`}>
                <AppText variant="bodyStrong">{r.name}</AppText>
                <AppText variant="secondary" numeric>{kcalChange(r)}</AppText>
                {r.lines.map((l, i) => (
                  <View key={i} style={{ paddingLeft: t.space.sm }}>
                    <AppText variant="caption" tone="secondary">{l.rawText}</AppText>
                    <AppText variant="caption" tone={l.foodAfter ? 'muted' : 'warning'}>
                      {lineChange({ ...l, foodBefore: l.foodBefore && friendlyFoodName(l.foodBefore), foodAfter: l.foodAfter && friendlyFoodName(l.foodAfter) })}
                    </AppText>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </BottomSheet>
  );
}
