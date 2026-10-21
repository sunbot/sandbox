// What a creature calls each person, earned from their shared history.
// Memories are capped, so nicknames drift as behaviour changes.

const BASE = {
  scary: 'Scary One',
  bonker: 'The Bonker',
  hero: 'My Hero',
  favourite: 'My Favourite',
  cupid: 'Cupid',
  snack: 'Snack Friend',
  pepper: 'Pepper Pal',
  cuddle: 'Cuddle Buddy',
  playmate: 'Playmate',
  newFriend: 'New Friend',
};

// Some temperaments put their own spin on a nickname.
const FLAVOUR = {
  grumpy: { favourite: 'The Tolerable One', snack: 'Food Servant' },
  shy: { favourite: 'Safe Person', scary: 'Big Scary' },
  mischievous: { bonker: 'Bonk Buddy' },
  sweet: { bonker: 'Rough-Hands' },
  bold: { bonker: 'Sparring Partner' },
  playful: { playmate: 'Best Playmate' },
};

const NEGATIVE = new Set(['scary', 'bonker']);

function nicknameKey(person) {
  if (!person?.memories.length) return null;
  const count = (type) => person.memories.filter((m) => m.type === type).length;
  if (person.fear > 60) return 'scary';
  if (count('hit') >= 3 && person.fondness < 0) return 'bonker';
  if (count('rescued') >= 1 && person.fondness > 0) return 'hero';
  if (person.fondness >= 75) return 'favourite';
  if (count('date') >= 2) return 'cupid';
  const fed = person.memories.filter((m) => m.type === 'fed');
  if (fed.length >= 4) return fed.filter((m) => m.food === 'pepper').length > fed.length / 2 ? 'pepper' : 'snack';
  if (count('pet') >= 4) return 'cuddle';
  if (count('play') >= 4) return 'playmate';
  if (person.fondness > 10) return 'newFriend';
  return null;
}

export function nicknameFor(creature, person) {
  const key = nicknameKey(person);
  if (!key) return null;
  const name = FLAVOUR[creature.genome.temperament]?.[key] ?? BASE[key];
  return { key, name, negative: NEGATIVE.has(key) };
}
