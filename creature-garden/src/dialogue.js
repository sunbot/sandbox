// Dialogue is composed, not looked up: a personality line for the situation,
// optionally prefixed with a callback to something this user did earlier.
// Each creature speaks with its own voice. Lines use {name} for the creature.

import { defaultRng } from './genetics.js';

// Shared lines, used when a temperament has no line of its own.
const GENERIC = {
  fed_liked: ['Mmm! {food}! You remembered.', 'That is my favourite. Thank you!'],
  fed_neutral: ['{food}, nice. Thanks for thinking of me.', 'Okay, {food}. I will take it.'],
  fed_disliked: ['Ugh, {food}? Not my favourite, but thanks for trying.', 'Blegh. Maybe next time.'],
  pet: ['*leans into your hand*', 'That feels nice. Keep going.'],
  play: ['Again! Again!', 'Okay, that was fun. I need a minute.'],
  hit: ['Hey! That hurt.', 'Why would you do that?', 'Ow. Okay. Ow.'],
  hit_repeat: ['Stop it. I mean it.', 'You keep doing that and I will hide from you.'],
  let_be: ['Oh, you are just going to sit there? Fine.', '*hums to self*'],
  not_type: ['Sorry, you are just not my type.', 'We would be better as friends, I think.'],
  date_yes: ['Okay. Maybe. Let us see how it goes.', 'You are actually kind of charming.'],
  date_no: ['Not today. Ask me again later.', 'Nope. Not feeling it.'],
  greet_happy: ['Oh, hi! I was just thinking about you.', 'You are back! Come sit with me.'],
  greet_neutral: ['Hm. Oh, it is you.', 'Hello. What do you want?'],
  greet_scared: ['*peeks out from behind a leaf*', '...hello. Be gentle, okay?'],
  retaliate: ['Okay, that is it! *bonks you back*', 'Two can play at that game!'],
  date_bond: ['{other} and I had a lovely time.', '{other} made me laugh so hard.'],
  baby: ['*wobbles happily*', 'Hi! I am brand new!'],
  not_hungry: ['I am so full I might pop. Maybe later?'],
  too_tired: ['*yawns* Five more minutes...'],
};

const VOICE = {
  sweet: {
    fed_liked: ['Oh, {food}! You are too kind. Thank you, friend.'],
    hit: ['Oh... that hurt my feelings more than my body. But it is okay.'],
    pet: ['*purrs softly* I could stay like this all day.'],
    greet_happy: ['Hello, my favourite! Did you bring treats?'],
  },
  grumpy: {
    fed_disliked: ['{food} again? Honestly. Fine. I will eat it.'],
    hit: ['Hit me? HIT ME? Do not do that. I bite.'],
    pet: ['Hmph. Do not get used to this.'],
    greet_neutral: ['What. I was napping.'],
  },
  playful: {
    fed_liked: ['{food}! My tail is on fire, I love it!'],
    play: ['Catch me! No, you cannot! Ha!', 'Yes! Do it again, do it again!'],
    hit: ['Bonk? That is a game, right? Right? Ow.'],
  },
  shy: {
    greet_scared: ['*hides* ...oh, it is only you. Hi.'],
    pet: ['*goes very still, then smiles a tiny bit*'],
    hit: ['*trembles* Please do not do that again.'],
    fed_liked: ['Oh! Thank you, you did not have to. Thank you.'],
  },
  bold: {
    hit: ['Hit me? Oh, you are going to regret that.'],
    play: ['Race you to the big rock!', 'Faster! I am winning!'],
    greet_happy: ['Look who showed up. Ready for trouble?'],
  },
  mischievous: {
    fed_liked: ['Hehe, {food}. Now I am going to cause trouble.'],
    retaliate: ['Oh, you wanted to play rough? *bonks you back, grinning*'],
    let_be: ['*is quietly plotting something*'],
    hit: ['Ha! Good one. Now I am going to get you back.'],
  },
};

const MEMORY_CALLBACKS = {
  hit: [
    'Last time you hit me, I still have not forgotten that.',
    'You bonked me before, so I am a bit wary.',
  ],
  fed: [
    'Remember when you fed me? I have been thinking about it.',
    'You were so kind to feed me before.',
  ],
  pet: ['You pet me last time. It was nice.'],
  play: ['You played with me before, which was fun.'],
  date: ['Last time you set me up with someone. I think I like them.'],
};

// Callback lines only fire when this user's history contains the matching memory.
// Forgiveness: after a hit, a kind action can get a "thank you for stopping" reply.
const FORGIVE = ['Okay. I am willing to forgive you. Slowly.', 'You made up for it. Mostly.'];

export function pickLine(list, rng = defaultRng) {
  return list[Math.floor(rng() * list.length)];
}

function lineFor(creature, situation, vars, rng) {
  const temperament = creature.genome.temperament;
  const pool = VOICE[temperament]?.[situation] ?? GENERIC[situation] ?? GENERIC.greet_neutral;
  return pickLine(pool, rng).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
}

// The most recent memory of this kind, if it is within the last 20 remembered events.
function recentMemory(memories, types) {
  const recent = memories.slice(-20).reverse();
  return recent.find((m) => types.includes(m.type));
}

export function speak(creature, situation, { memories = [], vars = {}, rng = defaultRng } = {}) {
  const name = creature.name;
  const line = lineFor(creature, situation, { name, ...vars }, rng);
  const callbackOpts = {
    hit: ['hit'],
    hit_repeat: ['hit'],
    pet: ['hit', 'fed'],
    fed_liked: ['hit'],
    fed_disliked: ['fed'],
    play: ['hit'],
    greet_happy: ['hit', 'fed', 'pet', 'play'],
    greet_neutral: ['hit', 'fed', 'pet', 'play'],
    greet_scared: ['hit'],
    date_yes: ['date'],
    date_no: ['hit'],
  }[situation];

  let callback = null;
  if (callbackOpts && rng() < 0.6) {
    const memory = recentMemory(memories, callbackOpts);
    if (memory) {
      if (memory.type === 'hit' && ['pet', 'fed_liked'].includes(situation) && rng() < 0.5) {
        return `${pickLine(FORGIVE, rng)} ${line}`;
      }
      callback = pickLine(MEMORY_CALLBACKS[memory.type], rng);
    }
  }
  return callback ? `${callback} ${line}` : line;
}

