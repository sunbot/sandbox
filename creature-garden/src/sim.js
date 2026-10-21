// The simulation. Needs decay lazily from the last time a creature was touched,
// so the garden keeps "running" between visits without a background timer.
//
// Functions that change the garden return `events`: structured records of what
// happened, which the server keeps and the Gazette turns into headlines.

import { randomGenome, breed, attractionMatch, defaultRng } from './genetics.js';
import { personalityOf } from './personality.js';
import { speak } from './dialogue.js';
import { nicknameFor } from './nicknames.js';

export const FOODS = ['berry', 'fish', 'pepper'];
export const HOUR_MS = 60 * 60 * 1000;
export const STAGE_HOURS = { baby: 12, youth: 72 }; // real hours; shorten for quick testing
// Creatures leave after this long starving, or straight away when this scared.
// They come back after enough favourite snacks from people they trust.
export const WANDER = { hungryHours: 8, fearToRunAway: 90, luresNeeded: { hungry: 2, scared: 3 }, blamedFearLimit: 30 };
const HUNGRY_AT = 5;
const MAX_MEMORIES = 40;
const MAX_DIARY = 100;
const MAX_DECAY_HOURS = 24 * 10;
const SYLLABLES = ['bo', 'mi', 'ku', 'fe', 'lo', 'ni', 'pip', 'zu', 'ba', 'so', 'tee', 'rae'];

// randomUUID exists in Node and on https pages; getRandomValues covers the rest.
const uuid = () =>
  globalThis.crypto.randomUUID?.() ??
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const hoursBetween = (a, b) => (b - a) / HOUR_MS;

export function makeName(rng = defaultRng) {
  const count = 2 + Math.floor(rng() * 2);
  const raw = Array.from({ length: count }, () => SYLLABLES[Math.floor(rng() * SYLLABLES.length)]).join('');
  return raw[0].toUpperCase() + raw.slice(1);
}

export function newCreature({ name, genome, parents = null, generation = 0, now, rng = defaultRng }) {
  return {
    id: `c_${uuid()}`,
    name: name ?? makeName(rng),
    genome: genome ?? randomGenome(rng),
    parents,
    generation,
    bornAt: now,
    lastTick: now,
    fullness: 70,
    energy: 80,
    affection: 40,
    people: {},   // userId -> { fondness, fear, memories: [], nickname }
    friends: {},  // otherCreatureId -> { affinity, memories: [] }
    diary: [],
    away: null,   // { since, reason, blame, lures, helpers: [{ id, name }], note } while wandering
    unhappySince: null,
  };
}

export function stageOf(c, now) {
  const hours = hoursBetween(c.bornAt, now);
  if (hours < STAGE_HOURS.baby) return 'baby';
  if (hours < STAGE_HOURS.youth) return 'youth';
  return 'adult';
}

function personOf(c, userId) {
  c.people[userId] ??= { fondness: 0, fear: 0, memories: [] };
  return c.people[userId];
}

function friendOf(c, otherId) {
  c.friends[otherId] ??= { affinity: 0, memories: [] };
  return c.friends[otherId];
}

function remember(list, entry) {
  list.push(entry);
  if (list.length > MAX_MEMORIES) list.splice(0, list.length - MAX_MEMORIES);
}

// Repeats of the same entry are counted rather than listed again.
function note(c, text, now) {
  const last = c.diary.at(-1);
  if (last?.text === text) {
    last.count = (last.count ?? 1) + 1;
    last.at = now;
    return;
  }
  c.diary.push({ at: now, text });
  if (c.diary.length > MAX_DIARY) c.diary.splice(0, c.diary.length - MAX_DIARY);
}

function requireHome(c) {
  if (c.away) throw new Error(`${c.name} is not in the garden right now.`);
}

// Recompute what this creature calls a person. Returns the announcement line
// when the nickname changed, and records a Gazette event for it.
function updateNickname(c, userId, person, actorName, now, events, rng) {
  const nick = nicknameFor(c, person);
  const before = person.nickname ?? null;
  person.nickname = nick?.name ?? null;
  if (!nick || nick.name === before) return null;
  // Unkind nicknames stay anonymous in the Gazette, like bonks do. `subject` is
  // only used to group a person's nicknames and is never shown.
  events.push({ at: now, type: 'nickname', creature: c.id, subject: userId, user: nick.negative ? null : actorName, detail: nick.name, negative: nick.negative });
  return speak(c, 'nickname_new', { vars: { nick: nick.name }, rng });
}

// Bring a creature's needs up to date for the time that has passed.
export function advance(c, now) {
  const hours = clamp(hoursBetween(c.lastTick, now), 0, MAX_DECAY_HOURS);
  if (hours <= 0) return c;
  // A wandering creature forages for itself, so it does not get hungrier.
  if (!c.away) {
    const rate = 2 + c.genome.traits.appetite * 1.5;
    const hoursToHungry = Math.max(0, (c.fullness - HUNGRY_AT) / rate);
    c.fullness = clamp(c.fullness - hours * rate, 0, 100);
    if (c.fullness <= HUNGRY_AT) c.unhappySince ??= c.lastTick + hoursToHungry * HOUR_MS;
    else c.unhappySince = null;
  }
  c.energy = clamp(c.energy + hours * 5, 0, 100);
  c.affection += (40 - c.affection) * Math.min(1, hours * 0.05);
  const forgiveness = personalityOf(c).forgiveness;
  for (const person of Object.values(c.people)) {
    person.fear = clamp(person.fear - hours * 2 * forgiveness, 0, 100);
    const drift = Math.min(Math.abs(person.fondness), hours * 0.3);
    person.fondness -= Math.sign(person.fondness) * drift;
  }
  c.lastTick = now;
  return c;
}

function wanderOff(c, reason, blame, at) {
  c.away = {
    since: at,
    reason,
    blame,
    lures: 0,
    helpers: [],
    note: speak(c, reason === 'hungry' ? 'note_hungry' : 'note_scared'),
  };
  c.unhappySince = null;
  note(c, reason === 'hungry' ? 'Nobody fed me, so I left to find food.' : 'I ran away. I did not feel safe.', at);
  return { at, type: 'wandered_off', creature: c.id, detail: reason };
}

// Advance time and apply anything that happened on its own: growing up,
// or wandering off after going hungry for too long.
export function tick(c, now) {
  const events = [];
  advance(c, now);
  const stage = stageOf(c, now);
  c.lastStage ??= stage; // saves from before stages were tracked
  if (stage !== c.lastStage) {
    c.lastStage = stage;
    const at = c.bornAt + (stage === 'youth' ? STAGE_HOURS.baby : STAGE_HOURS.youth) * HOUR_MS;
    note(c, `I grew up! I am a ${stage} now.`, at);
    events.push({ at, type: 'grew_up', creature: c.id, detail: stage });
  }
  if (!c.away && c.unhappySince != null && now - c.unhappySince >= WANDER.hungryHours * HOUR_MS) {
    events.push(wanderOff(c, 'hungry', null, c.unhappySince + WANDER.hungryHours * HOUR_MS));
  }
  return events;
}

export function moodOf(c, userId, now) {
  const person = c.people[userId];
  if (person && person.fear > 60) return 'scared';
  if (c.fullness < 25) return 'hungry';
  if (c.energy < 20) return 'tired';
  if (person && person.fondness > 40) return 'happy';
  if (c.affection > 70) return 'happy';
  return 'content';
}

// What the current user is allowed to see about a creature. Other people's
// memories stay private; each user only sees their own history with a creature.
export function viewFor(c, userId, now, creaturesById = {}) {
  const person = c.people[userId] ?? { fondness: 0, fear: 0, memories: [] };
  return {
    id: c.id,
    name: c.name,
    genome: c.genome,
    stage: stageOf(c, now),
    generation: c.generation,
    parents: c.parents?.map((id) => creaturesById[id]?.name ?? '?') ?? null,
    fullness: Math.round(c.fullness),
    energy: Math.round(c.energy),
    affection: Math.round(c.affection),
    mood: moodOf(c, userId, now),
    temperament: personalityOf(c).label,
    you: { fondness: Math.round(person.fondness), fear: Math.round(person.fear), nickname: person.nickname ?? null },
    friends: Object.entries(c.friends).map(([id, f]) => ({
      id,
      name: creaturesById[id]?.name ?? '?',
      affinity: Math.round(f.affinity),
    })),
    away: c.away && {
      since: c.away.since,
      reason: c.away.reason,
      note: c.away.note,
      lures: c.away.lures,
      needed: WANDER.luresNeeded[c.away.reason],
    },
    diary: c.diary.slice(-8),
  };
}

// Actions a user can take on a creature. Each returns { creature, line, situation, events }.
export function act(c, userId, action, { food, now, rng = defaultRng, actorName = 'Someone' }) {
  requireHome(c);
  advance(c, now);
  const p = personalityOf(c);
  const person = personOf(c, userId);
  const memories = person.memories;
  const recentTypes = memories.slice(-3).map((m) => m.type);
  const events = [];
  let situation;

  switch (action) {
    case 'feed': {
      if (!FOODS.includes(food)) throw new Error(`Unknown food: ${food}`);
      if (c.fullness >= 95) {
        situation = 'not_hungry';
        break;
      }
      c.fullness = clamp(c.fullness + 25, 0, 100);
      const liked = p.likes.includes(food);
      const disliked = p.dislikes.includes(food);
      if (food === 'pepper') c.energy = clamp(c.energy + 12, 0, 100);
      if (liked) {
        person.fondness = clamp(person.fondness + 10 * p.warmth, -100, 100);
        c.affection = clamp(c.affection + 5, 0, 100);
        situation = 'fed_liked';
        events.push({ at: now, type: 'fed_favourite', creature: c.id, user: actorName, detail: food });
      } else if (disliked) {
        person.fondness = clamp(person.fondness + 2, -100, 100);
        situation = 'fed_disliked';
      } else {
        person.fondness = clamp(person.fondness + 5 * p.warmth, -100, 100);
        situation = 'fed_neutral';
      }
      remember(memories, { type: 'fed', food, at: now });
      note(c, `${actorName} fed me ${food}${liked ? ' (a favourite!)' : disliked ? ' (not a favourite)' : ''}.`, now);
      break;
    }
    case 'pet': {
      if (person.fear > 60) {
        situation = 'greet_scared';
        break;
      }
      person.fondness = clamp(person.fondness + 6 * p.warmth, -100, 100);
      c.affection = clamp(c.affection + 6 * p.warmth, 0, 100);
      remember(memories, { type: 'pet', at: now });
      situation = 'pet';
      break;
    }
    case 'play': {
      if (c.energy < 20) {
        situation = 'too_tired';
        break;
      }
      c.energy = clamp(c.energy - 20, 0, 100);
      const repeats = recentTypes.filter((t) => t === 'play').length;
      const boredom = repeats >= 2 ? p.boredom : 1;
      person.fondness = clamp(person.fondness + (6 * p.warmth) / boredom, -100, 100);
      remember(memories, { type: 'play', at: now });
      situation = 'play';
      break;
    }
    case 'hit': {
      const sturdy = 1 - c.genome.traits.sturdiness * 0.3;
      person.fondness = clamp(person.fondness - 15 * p.hurtScale, -100, 100);
      person.fear = clamp(person.fear + 25 * p.hurtScale * sturdy, 0, 100);
      c.affection = clamp(c.affection - 8, 0, 100);
      const hitsBefore = memories.filter((m) => m.type === 'hit').length;
      remember(memories, { type: 'hit', at: now });
      situation = hitsBefore >= 2 ? 'hit_repeat' : 'hit';
      if (p.retaliates && rng() < p.retaliates) {
        situation = 'retaliate';
        person.fondness = clamp(person.fondness - 5, -100, 100);
      }
      // The creature knows who did it; the diary and Gazette do not say.
      note(c, 'Someone bonked me. I know who it was.', now);
      events.push({ at: now, type: 'bonk', creature: c.id });
      if (person.fear >= WANDER.fearToRunAway) {
        situation = 'ran_away';
        events.push(wanderOff(c, 'scared', userId, now));
      }
      break;
    }
    case 'let_be': {
      c.affection = clamp(c.affection - 1, 0, 100);
      situation = 'let_be';
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }

  if (c.fullness > HUNGRY_AT) c.unhappySince = null;
  let line = speak(c, situation, { memories, vars: { food }, rng });
  const announcement = updateNickname(c, userId, person, actorName, now, events, rng);
  if (announcement) line += ` ${announcement}`;
  return { creature: c, line, situation, events };
}

// Leave food at the garden's edge for a creature that wandered off. Only a
// favourite works, and whoever scared it away has to wait until it calms down.
export function lure(c, userId, food, { now, rng = defaultRng, actorName = 'Someone' }) {
  if (!c.away) throw new Error(`${c.name} is already home.`);
  if (!FOODS.includes(food)) throw new Error(`Unknown food: ${food}`);
  advance(c, now);
  const events = [];
  const p = personalityOf(c);
  if (c.away.blame === userId && personOf(c, userId).fear >= WANDER.blamedFearLimit) {
    return { line: speak(c, 'lure_blamed', { rng }), events, cameHome: false };
  }
  if (!p.likes.includes(food)) {
    return { line: speak(c, 'lure_meh', { vars: { food }, rng }), events, cameHome: false };
  }
  c.away.lures += 1;
  if (!c.away.helpers.some((h) => h.id === userId)) c.away.helpers.push({ id: userId, name: actorName });
  if (c.away.lures < WANDER.luresNeeded[c.away.reason]) {
    return { line: speak(c, 'lure_sniff', { vars: { food }, rng }), events, cameHome: false };
  }

  const { reason, blame, helpers } = c.away;
  c.away = null;
  c.unhappySince = null;
  c.fullness = Math.max(c.fullness, 60);
  for (const helper of helpers) {
    const person = personOf(c, helper.id);
    person.fondness = clamp(person.fondness + 20, -100, 100);
    remember(person.memories, { type: 'rescued', at: now });
  }
  // It comes home wary of whoever drove it away.
  if (blame && !helpers.some((h) => h.id === blame)) {
    const blamed = personOf(c, blame);
    blamed.fear = Math.max(blamed.fear, 50);
    blamed.fondness = clamp(blamed.fondness - 20, -100, 100);
  }
  const names = helpers.map((h) => h.name);
  note(c, `I came home! ${names.join(' and ')} coaxed me back with ${food}.`, now);
  events.push({ at: now, type: 'came_home', creature: c.id, users: names, detail: reason });
  let line = speak(c, 'came_home', { rng });
  const announcement = updateNickname(c, userId, personOf(c, userId), actorName, now, events, rng);
  if (announcement) line += ` ${announcement}`;
  return { line, events, cameHome: true };
}

// Look at a creature without touching it, e.g. when a user opens the garden.
export function greet(c, userId, now, rng = defaultRng) {
  advance(c, now);
  if (c.away) return c.away.note;
  const person = personOf(c, userId);
  const situation = person.fear > 60 ? 'greet_scared' : person.fondness > 30 ? 'greet_happy' : 'greet_neutral';
  const line = speak(c, situation, { memories: person.memories, rng });
  return person.nickname && situation !== 'greet_scared' ? `${person.nickname}! ${line}` : line;
}

// Try to get two creatures to date. The user is the matchmaker: how the
// creatures feel about *them* helps, and orientation is a hard limit.
export function introduce(a, b, userId, now, rng = defaultRng, actorName = 'Someone') {
  if (a.id === b.id) throw new Error('Pick two different creatures.');
  requireHome(a);
  requireHome(b);
  advance(a, now);
  advance(b, now);
  const personA = personOf(a, userId);
  const personB = personOf(b, userId);
  const pair = { creature: a.id, other: b.id, user: actorName };

  if (!attractionMatch(a.genome, b.genome)) {
    return {
      outcome: 'not_type',
      lines: [`${a.name}: ${speak(a, 'not_type', { rng })}`, `${b.name}: ${speak(b, 'not_type', { rng })}`],
      events: [{ at: now, type: 'not_type', ...pair }],
    };
  }
  if (a.energy < 30 || b.energy < 30) {
    return { outcome: 'tired', lines: ['They are too tired to go on a date right now.'], events: [] };
  }

  const tempBonus = { sweet: 0.1, shy: -0.1, grumpy: -0.15, bold: 0.05 };
  const chance = clamp(
    0.35 +
      (personA.fondness + personB.fondness) / 400 +
      friendOf(a, b.id).affinity / 200 +
      (tempBonus[a.genome.temperament] ?? 0) +
      (tempBonus[b.genome.temperament] ?? 0) -
      (personA.fear > 50 || personB.fear > 50 ? 0.2 : 0),
    0.05,
    0.95,
  );

  if (rng() >= chance) {
    friendOf(a, b.id).affinity -= 3;
    friendOf(b, a.id).affinity -= 3;
    note(a, `Turned down a date with ${b.name}.`, now);
    note(b, `Turned down a date with ${a.name}.`, now);
    return {
      outcome: 'date_no',
      chance,
      lines: [
        `${a.name}: ${speak(a, 'date_no', { memories: personA.memories, rng })}`,
        `${b.name}: ${speak(b, 'date_no', { memories: personB.memories, rng })}`,
      ],
      events: [{ at: now, type: 'date_no', ...pair }],
    };
  }

  const events = [{ at: now, type: 'date', ...pair }];
  friendOf(a, b.id).affinity = clamp(friendOf(a, b.id).affinity + 25, -100, 100);
  friendOf(b, a.id).affinity = clamp(friendOf(b, a.id).affinity + 25, -100, 100);
  remember(personA.memories, { type: 'date', at: now });
  remember(personB.memories, { type: 'date', at: now });
  note(a, `Went on a date with ${b.name}.`, now);
  note(b, `Went on a date with ${a.name}.`, now);
  const lines = [
    `${a.name}: ${speak(a, 'date_yes', { memories: personA.memories, rng })}`,
    `${b.name}: ${speak(b, 'date_yes', { memories: personB.memories, rng })}`,
  ];
  for (const [c, person] of [[a, personA], [b, personB]]) {
    const announcement = updateNickname(c, userId, person, actorName, now, events, rng);
    if (announcement) lines.push(`${c.name}: ${announcement}`);
  }
  const baby = mate(a, b, now, rng);
  if (baby) {
    lines.push(`${a.name} and ${b.name} had a baby: ${baby.name}!`);
    events.push({ at: now, type: 'baby', creature: baby.id, parents: [a.id, b.id] });
  }
  return { outcome: 'date_yes', chance, lines, baby, events };
}

export function canMate(a, b, now) {
  return (
    !a.away &&
    !b.away &&
    stageOf(a, now) === 'adult' &&
    stageOf(b, now) === 'adult' &&
    a.genome.attracts !== 'none' &&
    b.genome.attracts !== 'none' &&
    attractionMatch(a.genome, b.genome) &&
    a.energy >= 40 &&
    b.energy >= 40 &&
    friendOf(a, b.id).affinity >= 50
  );
}

// Two adults who bonded can have a baby. The baby inherits from both parents
// and is a new creature in the garden, which then grows up and evolves.
export function mate(a, b, now, rng = defaultRng) {
  if (!canMate(a, b, now)) return null;
  a.energy -= 30;
  b.energy -= 30;
  const genome = breed(a.genome, b.genome, rng);
  const child = newCreature({
    genome,
    parents: [a.id, b.id],
    generation: Math.max(a.generation, b.generation) + 1,
    now,
    rng,
  });
  child.lastStage = 'baby';
  note(a, `Had a baby with ${b.name}: ${child.name}.`, now);
  note(b, `Had a baby with ${a.name}: ${child.name}.`, now);
  return child;
}
