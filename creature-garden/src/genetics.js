// Genome creation, breeding and mutation. Pure functions; `rng` is injectable for tests.

export const TEMPERAMENTS = ['sweet', 'grumpy', 'playful', 'shy', 'bold', 'mischievous'];
export const SEXES = ['a', 'b'];
// Who a creature is attracted to. 'none' is asexual; 'both' is bisexual/pansexual.
export const ATTRACTIONS = ['a', 'b', 'both', 'none'];
export const SHAPES = ['round', 'tall', 'fluffy'];
export const EAR_STYLES = ['none', 'round', 'pointy', 'leaf'];
export const TRAIT_KEYS = ['curiosity', 'charm', 'sturdiness', 'appetite'];

export const defaultRng = Math.random;

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const gauss = (rng) => (rng() + rng() + rng() - 1.5) / 1.5; // roughly -1..1

export function randomGenome(rng = defaultRng) {
  const traits = {};
  for (const key of TRAIT_KEYS) traits[key] = Math.round(rng() * 100) / 100;
  return {
    hue: Math.floor(rng() * 360),
    shape: pick(SHAPES, rng),
    ears: pick(EAR_STYLES, rng),
    sex: pick(SEXES, rng),
    attracts: pick(ATTRACTIONS, rng),
    temperament: pick(TEMPERAMENTS, rng),
    traits,
  };
}

// Circular mean so hues 350° and 10° average to 0°, not 180°.
function hueMean(h1, h2) {
  const x = Math.cos((h1 * Math.PI) / 180) + Math.cos((h2 * Math.PI) / 180);
  const y = Math.sin((h1 * Math.PI) / 180) + Math.sin((h2 * Math.PI) / 180);
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export function breed(parentA, parentB, rng = defaultRng) {
  const mutate = (chance, fn, fallback) => (rng() < chance ? fn() : fallback);
  const traits = {};
  for (const key of TRAIT_KEYS) {
    const avg = (parentA.traits[key] + parentB.traits[key]) / 2;
    traits[key] = clamp(
      Math.round((avg + gauss(rng) * 0.1) * 100) / 100,
      0,
      1,
    );
  }
  // Each parent passes on its own attraction/temperament half the time, so
  // a child is not a simple average and can surprise both parents.
  return {
    hue: (hueMean(parentA.hue, parentB.hue) + Math.floor(gauss(rng) * 12) + 360) % 360,
    shape: rng() < 0.5 ? parentA.shape : parentB.shape,
    ears: rng() < 0.5 ? parentA.ears : parentB.ears,
    sex: rng() < 0.5 ? parentA.sex : parentB.sex,
    attracts: mutate(0.12, () => pick(ATTRACTIONS, rng), rng() < 0.5 ? parentA.attracts : parentB.attracts),
    temperament: mutate(0.15, () => pick(TEMPERAMENTS, rng), rng() < 0.5 ? parentA.temperament : parentB.temperament),
    traits,
  };
}

// Can these two creatures be attracted to each other at all?
export function attractionMatch(a, b) {
  const wants = (x, y) => x === 'both' || x === y.sex;
  return wants(a.attracts, b) && wants(b.attracts, a);
}
