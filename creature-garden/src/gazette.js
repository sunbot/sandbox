// The Garden Gazette: turns the garden's event log into a front page.
// Pure function of the events, so a page reads the same on every refresh.

const DAY_MS = 24 * 60 * 60 * 1000;

// Lower number = bigger story.
const PRIORITY = {
  baby: 1,
  came_home: 2,
  wandered_off: 2,
  scandal: 3,
  date: 4,
  bonks: 4,
  nickname: 5,
  grew_up: 6,
  date_no: 6,
  not_type: 7,
  snacks: 8,
};

function listNames(names) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? 'someone';
  return `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`;
}

// Group events of one type by creature, e.g. every bonk Pipni got today.
function groupByCreature(events) {
  const groups = new Map();
  for (const e of events) {
    if (!groups.has(e.creature)) groups.set(e.creature, []);
    groups.get(e.creature).push(e);
  }
  return [...groups.entries()];
}

// Who a creature dated before this date, other than the current partner.
function exOf(allEvents, date) {
  const pair = new Set([date.creature, date.other]);
  for (let i = allEvents.length - 1; i >= 0; i--) {
    const e = allEvents[i];
    if (e.type !== 'date' || e.at >= date.at) continue;
    const involved = [e.creature, e.other];
    if (!involved.some((id) => pair.has(id))) continue;
    const third = involved.find((id) => !pair.has(id));
    if (third) return third;
  }
  return null;
}

export function gazette(allEvents, creaturesById, { now, windowMs = 2 * DAY_MS, lastSeen = 0, limit = 8 } = {}) {
  const name = (id) => creaturesById[id]?.name ?? 'a mystery creature';
  const inWindow = allEvents.filter((e) => e.at > now - windowMs && e.at <= now);
  // Old news gets superseded: only the latest nickname a creature gave a person,
  // and no "missing" notice once that creature is already home again.
  const latestNickname = new Map();
  for (const e of inWindow) {
    if (e.type !== 'nickname') continue;
    const key = `${e.creature}|${e.subject ?? e.user}`;
    if (!latestNickname.has(key) || e.at >= latestNickname.get(key).at) latestNickname.set(key, e);
  }
  const recent = inWindow.filter((e) => {
    if (e.type === 'nickname') return latestNickname.get(`${e.creature}|${e.subject ?? e.user}`) === e;
    if (e.type === 'wandered_off') return !inWindow.some((h) => h.type === 'came_home' && h.creature === e.creature && h.at > e.at);
    return true;
  });
  const stories = [];
  const add = (kind, at, text) => stories.push({ kind, at, text, isNew: at > lastSeen });

  for (const e of recent) {
    switch (e.type) {
      case 'baby': {
        const [a, b] = e.parents;
        add('baby', e.at, `BIG NEWS: ${name(a)} and ${name(b)} welcomed baby ${name(e.creature)}!`);
        break;
      }
      case 'came_home':
        add('came_home', e.at, `HOMECOMING: ${name(e.creature)} is back, thanks to ${listNames(e.users)}.`);
        break;
      case 'wandered_off':
        add('wandered_off', e.at, e.detail === 'hungry'
          ? `MISSING: ${name(e.creature)} wandered off to find food. Leave a favourite snack at the garden's edge.`
          : `RUNAWAY: ${name(e.creature)} fled after one bonk too many. Only a favourite snack will coax them back.`);
        break;
      case 'date': {
        const ex = exOf(allEvents, e);
        if (ex) add('scandal', e.at, `SCANDAL: ${name(e.creature)} was seen on a date with ${name(e.other)}. Does ${name(ex)} know?`);
        else add('date', e.at, `LOVE IS IN THE AIR: ${name(e.creature)} and ${name(e.other)} went on a date, set up by ${e.user}.`);
        break;
      }
      case 'date_no':
        add('date_no', e.at, `OUCH: ${e.user} tried to set up ${name(e.creature)} and ${name(e.other)}. It did not go well.`);
        break;
      case 'not_type':
        add('not_type', e.at, `JUST FRIENDS: ${name(e.creature)} and ${name(e.other)} are not each other's type.`);
        break;
      case 'nickname':
        add('nickname', e.at, e.negative
          ? `WHISPERS: ${name(e.creature)} has a new name for someone: "${e.detail}". Yikes.`
          : `${name(e.creature)} has started calling ${e.user} "${e.detail}".`);
        break;
      case 'grew_up':
        add('grew_up', e.at, `ALL GROWN UP: ${name(e.creature)} is now ${e.detail === 'adult' ? 'an adult' : 'a youngster'}.`);
        break;
      default:
        break; // bonks and snacks are summarised below
    }
  }

  // Bonks are anonymous: the Gazette never says who did it.
  for (const [id, bonks] of groupByCreature(recent.filter((e) => e.type === 'bonk'))) {
    const at = bonks.at(-1).at;
    add('bonks', at, bonks.length >= 3
      ? `WHODUNNIT: Someone keeps bonking ${name(id)} (${bonks.length} times). ${name(id)} wants answers.`
      : `${name(id)} was bonked. Nobody is saying who.`);
  }
  for (const [id, snacks] of groupByCreature(recent.filter((e) => e.type === 'fed_favourite'))) {
    const at = snacks.at(-1).at;
    const count = snacks.length;
    add('snacks', at, `SNACK WATCH: ${name(id)} enjoyed ${count} favourite treat${count === 1 ? '' : 's'}, from ${listNames(snacks.map((s) => s.user))}.`);
  }

  stories.sort((x, y) => PRIORITY[x.kind] - PRIORITY[y.kind] || y.at - x.at);
  const headlines = stories.slice(0, limit);
  if (!headlines.length) headlines.push({ kind: 'quiet', at: now, text: 'A quiet day in the garden. Suspiciously quiet.', isNew: false });
  return headlines;
}
