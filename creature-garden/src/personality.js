// Temperaments shape how a creature reacts. Every number here is a multiplier
// or a delta the simulation applies, so tuning a personality never touches code.

export const PERSONALITIES = {
  sweet: {
    label: 'Sweet',
    likes: ['berry'],
    dislikes: ['pepper'],
    forgiveness: 2.0,   // how fast a grudge fades (higher = forgives faster)
    hurtScale: 0.8,     // how much a bonk hurts
    warmth: 1.3,        // how quickly affection builds
    boredom: 0.7,       // how fast repeated play gets stale
  },
  grumpy: {
    label: 'Grumpy',
    likes: ['fish'],
    dislikes: ['berry'],
    forgiveness: 0.5,
    hurtScale: 1.4,
    warmth: 0.6,
    boredom: 1.2,
  },
  playful: {
    label: 'Playful',
    likes: ['pepper'],
    dislikes: ['fish'],
    forgiveness: 1.2,
    hurtScale: 0.9,
    warmth: 1.0,
    boredom: 1.8,       // gets bored of anything quickly
  },
  shy: {
    label: 'Shy',
    likes: ['berry', 'fish'],
    dislikes: [],
    forgiveness: 0.7,
    hurtScale: 1.3,
    warmth: 0.5,
    boredom: 0.6,
  },
  bold: {
    label: 'Bold',
    likes: ['fish', 'pepper'],
    dislikes: ['berry'],
    forgiveness: 1.0,
    hurtScale: 0.7,
    warmth: 0.9,
    boredom: 1.0,
  },
  mischievous: {
    label: 'Mischievous',
    likes: ['pepper'],
    dislikes: [],
    forgiveness: 1.0,
    hurtScale: 1.0,
    warmth: 1.0,
    boredom: 1.4,
    retaliates: 0.3,    // chance to bonk back when hit
  },
};

export const personalityOf = (creature) => PERSONALITIES[creature.genome.temperament];
