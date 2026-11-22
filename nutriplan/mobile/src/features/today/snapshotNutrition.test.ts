import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NutrientDefinition, Nutrition } from '../../api/types.ts';
import { snapshotNutrition } from './snapshotNutrition.ts';

const catalog: NutrientDefinition[] = [
  { id: 1008, name: 'Energy', unit: 'kcal', group: 'Energy', displayOrder: 0 },
  { id: 1003, name: 'Protein', unit: 'g', group: 'Macronutrient', displayOrder: 10 },
  { id: 1103, name: 'Selenium', unit: 'µg', group: 'Mineral', displayOrder: 68 },
  { id: 1162, name: 'Vitamin C', unit: 'mg', group: 'Vitamin', displayOrder: 71 },
  { id: 1114, name: 'Vitamin D', unit: 'µg', group: 'Vitamin', displayOrder: 72 },
];
const nutrition: Nutrition = { calories: 100, protein: 0, carbs: 0, fat: 0, fiber: 0, nutrients: { 1008: 100, 1103: 0, 1162: 1.234, 9999: 5 } };

test('snapshot uses catalog names, groups and units; missing is not zero', () => {
  const sections = snapshotNutrition(nutrition, catalog);
  assert.deepEqual(sections, [
    { title: 'Calories and macros', rows: [
      { id: '1008', name: 'Energy', value: '100 kcal' },
      { id: '1003', name: 'Protein', value: 'Not reported' },
    ] },
    { title: 'Vitamins', rows: [
      { id: '1162', name: 'Vitamin C', value: '1.234 mg' },
      { id: '1114', name: 'Vitamin D', value: 'Not reported' },
    ] },
    { title: 'Minerals', rows: [{ id: '1103', name: 'Selenium', value: '0 µg' }] },
    { title: 'Other reported nutrients', rows: [{ id: '9999', name: 'Nutrient 9999', value: '5 (unit unavailable)' }] },
  ]);
});

test('quick entries do not turn unreported macros into zero', () => {
  const quick = { ...nutrition, nutrients: { 1008: 100, 1003: 0 } };
  const rows = snapshotNutrition(quick, catalog)[0].rows;
  assert.equal(rows[1].value, '0 g');
  assert.equal(snapshotNutrition({ ...quick, nutrients: { 1008: 100 } }, catalog)[0].rows[1].value, 'Not reported');
});
