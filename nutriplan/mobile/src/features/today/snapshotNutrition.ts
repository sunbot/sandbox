import type { NutrientDefinition, Nutrition } from '../../api/types';

const groups = [
  { title: 'Calories and macros', types: ['Energy', 'Macronutrient'] },
  { title: 'Carbohydrates', types: ['Carbohydrate'] },
  { title: 'Fats', types: ['Lipid'] },
  { title: 'Vitamins', types: ['Vitamin'] },
  { title: 'Minerals', types: ['Mineral'] },
  { title: 'Other', types: ['Other'] },
] as const;

export function snapshotNutrition(nutrition: Nutrition, catalog: NutrientDefinition[]) {
  const amounts = nutrition.nutrients ?? {};
  const sections: { title: string; rows: { id: string; name: string; value: string }[] }[] = groups.map(({ title, types }) => ({
    title,
    rows: catalog.filter((n) => (types as readonly string[]).includes(n.group))
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((n) => ({
        id: String(n.id), name: n.name,
        value: amounts[n.id] == null ? 'Not reported' : `${amounts[n.id]} ${n.unit}`,
      })),
  })).filter((section) => section.rows.length > 0);
  const knownIds = new Set(catalog.map((n) => String(n.id)));
  const unrecognized = Object.entries(amounts).filter(([id]) => !knownIds.has(id))
    .map(([id, value]) => ({ id, name: `Nutrient ${id}`, value: `${value} (unit unavailable)` }));
  if (unrecognized.length) sections.push({ title: 'Other reported nutrients', rows: unrecognized });
  return sections;
}
