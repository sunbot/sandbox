-- Intake Grid food data audit. READ-ONLY: everything runs in a READ ONLY transaction that is rolled back, so it can't change
-- data even if pointed at production. Run:  psql "$URL" -v ON_ERROR_STOP=1 -f scripts/audit/food_data_audit.sql
-- Covers shared/catalogue foods only (owner_id IS NULL) unless a section says otherwise; no user diaries are read.
BEGIN TRANSACTION READ ONLY;

\echo '== 1. Foods by source and quality (catalogue foods; user foods counted separately) =='
SELECT source, quality, count(*) AS foods
FROM foods WHERE NOT is_archived AND owner_id IS NULL
GROUP BY 1, 2 ORDER BY 1, 2;
SELECT 'user-created foods (any owner)' AS what, count(*) FROM foods WHERE owner_id IS NOT NULL;

\echo '== 2. Key nutrient completeness: % of foods that REPORT each nutrient (absent = unknown, not zero) =='
WITH f AS (SELECT source, nutrients_per100g n FROM foods WHERE NOT is_archived AND owner_id IS NULL)
SELECT source, count(*) AS foods,
  round(100.0 * avg((n ? '1008')::int), 1) AS energy,
  round(100.0 * avg((n ? '1003')::int), 1) AS protein,
  round(100.0 * avg((n ? '1005')::int), 1) AS carbs,
  round(100.0 * avg((n ? '1004')::int), 1) AS fat,
  round(100.0 * avg((n ? '1079')::int), 1) AS fiber,
  round(100.0 * avg((n ? '2000')::int), 1) AS sugars,
  round(100.0 * avg((n ? '1235')::int), 1) AS added_sugars,
  round(100.0 * avg((n ? '1258')::int), 1) AS sat_fat,
  round(100.0 * avg((n ? '1093')::int), 1) AS sodium,
  round(100.0 * avg((n ? '1092')::int), 1) AS potassium,
  round(100.0 * avg((n ? '1087')::int), 1) AS calcium,
  round(100.0 * avg((n ? '1089')::int), 1) AS iron,
  round(100.0 * avg((n ? '1114')::int), 1) AS vit_d,
  round(100.0 * avg((n ? '1162')::int), 1) AS vit_c,
  round(100.0 * avg((n ? '1178')::int), 1) AS b12,
  round(100.0 * avg((n ? '1190')::int), 1) AS folate
FROM f GROUP BY source ORDER BY source;

\echo '== 3. Nutrients reported per food (distribution) =='
SELECT source, min(c) AS min, percentile_disc(0.5) WITHIN GROUP (ORDER BY c) AS median, max(c) AS max
FROM (SELECT source, (SELECT count(*) FROM jsonb_object_keys(nutrients_per100g)) c FROM foods WHERE NOT is_archived AND owner_id IS NULL) x
GROUP BY source ORDER BY source;

\echo '== 4. Household measures: % of foods with at least one portion (needed for cups/pieces; never invented) =='
SELECT source, count(*) AS foods,
  round(100.0 * avg((jsonb_array_length(portions) > 0)::int), 1) AS with_portions,
  round(100.0 * avg((portions::text ILIKE '%"origin": "%' AND portions::text NOT ILIKE '%"origin": null%')::int), 1) AS borrowed_portions
FROM foods WHERE NOT is_archived AND owner_id IS NULL GROUP BY source ORDER BY source;

\echo '== 5. Energy consistency: stated kcal vs 4/4/9 from macros (beyond 25% and 20 kcal); alcohol/polyols explain some =='
WITH f AS (
  SELECT source, name, (nutrients_per100g->>'1008')::float kcal,
    4 * coalesce((nutrients_per100g->>'1003')::float, 0) + 4 * coalesce((nutrients_per100g->>'1005')::float, 0) + 9 * coalesce((nutrients_per100g->>'1004')::float, 0) atwater
  FROM foods WHERE NOT is_archived AND owner_id IS NULL AND nutrients_per100g ? '1008'
    AND nutrients_per100g ? '1003' AND nutrients_per100g ? '1005' AND nutrients_per100g ? '1004')
SELECT source, count(*) AS checked,
  sum((abs(kcal - atwater) > greatest(20, 0.25 * greatest(kcal, atwater)))::int) AS inconsistent
FROM f GROUP BY source ORDER BY source;

\echo '== 6. Suspicious values =='
SELECT 'kcal reported as 0 but macros > 5 g' AS check, count(*) FROM foods
WHERE NOT is_archived AND owner_id IS NULL AND (nutrients_per100g->>'1008')::float = 0
  AND coalesce((nutrients_per100g->>'1003')::float, 0) + coalesce((nutrients_per100g->>'1005')::float, 0) + coalesce((nutrients_per100g->>'1004')::float, 0) > 5
UNION ALL
SELECT 'macros over 100 g per 100 g', count(*) FROM foods
WHERE NOT is_archived AND owner_id IS NULL
  AND coalesce((nutrients_per100g->>'1003')::float, 0) + coalesce((nutrients_per100g->>'1005')::float, 0) + coalesce((nutrients_per100g->>'1004')::float, 0) > 105
UNION ALL
SELECT 'no energy at all (kcal unknown)', count(*) FROM foods WHERE NOT is_archived AND owner_id IS NULL AND NOT nutrients_per100g ? '1008'
UNION ALL
SELECT 'missing source id (provenance)', count(*) FROM foods WHERE NOT is_archived AND owner_id IS NULL AND source <> 'User' AND source_id IS NULL;

\echo '== 7. Raw vs cooked naming for staples (matching depends on these existing side by side) =='
SELECT staple, count(*) FILTER (WHERE name ILIKE '%raw%' OR name ILIKE '%dry%' OR name ILIKE '%uncooked%') AS raw_or_dry,
       count(*) FILTER (WHERE name ILIKE '%cooked%' OR name ILIKE '%boiled%') AS cooked
FROM (VALUES ('Lentils'), ('Rice, white'), ('Rice, brown'), ('Quinoa'), ('Beans, black'), ('Chickpeas'), ('Pasta'), ('Oats'), ('Sweet potato'), ('Chicken, broiler')) s(staple)
JOIN foods f ON f.name ILIKE s.staple || '%' AND NOT f.is_archived AND f.owner_id IS NULL
GROUP BY staple ORDER BY staple;

\echo '== 8. Coconut milk entries (canned vs beverage differ ~5x in kcal) =='
SELECT source, name, (nutrients_per100g->>'1008')::float AS kcal_per_100g, jsonb_array_length(portions) AS portions
FROM foods WHERE NOT is_archived AND owner_id IS NULL AND name ILIKE '%coconut milk%' ORDER BY kcal_per_100g DESC;

ROLLBACK;
