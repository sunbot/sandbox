import { SegmentedControl } from '@/components/ds';
import { modeLabel, type NutritionMode } from './nutritionView';

/**
 * Chooses how the nutrition numbers are *displayed*: per serving, whole recipe, or per 100 g. It changes nothing
 * about how many servings the recipe makes or how much you are about to log.
 */
export function ServingModeSelector({ modes, value, onChange }: { modes: NutritionMode[]; value: NutritionMode; onChange: (m: NutritionMode) => void }) {
  return <SegmentedControl accessibilityLabel="Show nutrition" options={modes.map((m) => ({ value: m, label: modeLabel[m] }))} value={value} onChange={onChange} />;
}
