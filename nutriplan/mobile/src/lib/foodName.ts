/**
 * Human-friendly food names for lists.
 *
 * USDA descriptions are precise but long ("Chicken, broilers or fryers, meat only, cooked, roasted").
 * `friendlyFoodName` keeps what helps you recognise the food (what it is, the cut or variety, how it was cooked)
 * and drops what USDA needs for lab bookkeeping (grades, trims, enrichment, lab codes). Display only: the stored
 * name, nutrition and matching are untouched, and detail views keep showing the full USDA description.
 */

/** USDA category words that come before the actual food ("Nuts, almonds" → "Almonds"). Beef/pork etc. are the food, so they stay. */
const CATEGORY_PREFIXES = new Set([
  'nuts', 'seeds', 'fish', 'spices', 'beverages', 'cereals', 'cereals ready-to-eat', 'game meat', 'crustaceans', 'mollusks',
  'candies', 'snacks', 'alcoholic beverage', 'alcoholic beverages', 'fast foods', 'restaurant', 'babyfood',
]);

/** Segments that describe how USDA sampled or graded the food rather than what you ate. */
const NOISE: RegExp[] = [
  /^broilers or fryers$/, /^meat only$/, /^separable lean( and fat| only)?$/, /^trimmed to .*fat$/, /^(usda )?(choice|select|prime)$/,
  /^all grades$/, /^grade a+$/, /^regular$/, /^(un)?enriched$/, /^fluid$/, /^commercially prepared$/, /^ready-to-(eat|serve)$/,
  /^nfs$/, /^ns as to .*/, /^not further specified$/, /^all (commercial )?varieties$/, /^all types$/, /^includes .*/, /^with added .*vitamin.*/,
  /^(cooked )?without salt$/, /^no salt added$/, /^shelf stable$/, /^not fortified$/, /^fresh$/, /^boneless$/, /^year round average$/,
  /^composite of .*/, /^mature seeds$/, /^store brand$/, /^natural$/, /^drained$/, /^no added fat$/, /^skin not eaten$/,
];

const COOKING = /^(roasted|fried|pan-fried|deep-fried|grilled|braised|broiled|boiled|stewed|steamed|baked|scrambled|poached|microwaved|toasted|sauteed|sautéed|smoked|dry roasted|oil roasted)\b/;

/** Foods where "raw" changes the numbers a lot (raw vs cooked weight), so "raw" stays even when it's the only detail. */
const KEEP_RAW = /^(chicken|beef|pork|turkey|lamb|veal|bison|duck|goat|venison|fish|salmon|tuna|cod|tilapia|trout|halibut|shrimp|scallops|crab|egg|eggs|rice|oats|pasta|noodles|quinoa|lentils|beans|barley|bulgur|couscous|millet|sorghum|flour|potatoes|sweet potatoes)\b/;

const POULTRY = /^(chicken|turkey|duck|goose|cornish game hens?)\b/;

const MAX_DETAILS = 3;

export function friendlyFoodName(name: string): string {
  if (!name) return name;

  let s = name
    .replace(/\s*\((?:[^()]*)\)/g, '') // "(Includes foods for USDA's Food Distribution Program)", lab codes "(CA1)"
    .replace(/\s+-\s+NFY\w+$/i, '') // Foundation lab sample ids
    .replace(/\s+/g, ' ')
    .trim();

  // ALL-CAPS Foundation names ("APPLES, GALA") read as shouting: sentence case them.
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) s = s.toLowerCase();

  if (!s.includes(',')) return capitalize(s);

  let parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && CATEGORY_PREFIXES.has(parts[0].toLowerCase())) parts = parts.slice(1);

  const head = parts[0];
  const headWord = head.toLowerCase().replace(/s$/, '');
  // Poultry "meat only" / "skin not eaten" means no skin, which changes the fat a lot: say it plainly instead of dropping it.
  if (POULTRY.test(head.toLowerCase())) parts = parts.map((p, i) => (i > 0 && /^(meat only|skin not eaten|skinless)$/i.test(p) ? 'skinless' : p));
  let details = parts.slice(1).filter((p) => !NOISE.some((re) => re.test(p.toLowerCase())));

  // "Eggs, large, egg whole" → "whole"; a detail that only repeats the food adds nothing.
  details = details
    .map((d) => d.replace(new RegExp(`^${escape(headWord)}s?\\s+`, 'i'), ''))
    .filter((d) => d.toLowerCase().replace(/s$/, '') !== headWord);

  // "cooked, roasted" → "roasted": the method already says it's cooked.
  details = details.filter((d, i) => !(d.toLowerCase() === 'cooked' && details.slice(i + 1).some((n) => COOKING.test(n.toLowerCase()))));

  // "Bananas, raw" → "Bananas" (raw is the default for produce); keep it where raw vs cooked changes the numbers.
  if (details.length === 1 && details[0].toLowerCase() === 'raw' && !KEEP_RAW.test(head.toLowerCase())) details = [];

  if (details.length > MAX_DETAILS) {
    // Keep the first details (cut, variety) and always the preparation, which matters most when choosing.
    const prepIndex = details.findIndex((d) => COOKING.test(d.toLowerCase()) || /^(raw|cooked|canned|frozen|dried|dry)$/i.test(d));
    const prep = prepIndex >= MAX_DETAILS - 1 ? details[prepIndex] : null;
    details = prep ? [...details.slice(0, MAX_DETAILS - 1), prep] : details.slice(0, MAX_DETAILS);
  }

  return capitalize([head, ...details].join(', '));
}

/** True when the friendly name hides part of the description, so the full name is worth showing too. */
export const isShortened = (name: string) => friendlyFoodName(name) !== name.trim();

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
