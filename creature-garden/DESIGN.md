# Creature Garden: design

## The core loop

1. **Visit.** Creatures have moved on while you were away: they got hungry,
   tired, or lonely, and they remember what everyone did.
2. **Care or cause trouble.** Feed, pet, play, bonk, or let be. Each choice
   changes how that creature feels about *you*, and they remember it.
3. **Matchmake.** Introduce two creatures. They date, bond, and sometimes have a baby.
4. **Watch them grow.** Babies inherit traits from both parents, grow up, and
   become the next generation. Their personalities are the ones you helped shape.

The fun is in the dependencies. You can't make a creature love you without
caring for it. You can't make two creatures pair up if their orientations don't
match, and you can't buy your way past a bad reputation.

## What's in the MVP

| Area | MVP | Notes |
| --- | --- | --- |
| Access | Google sign-in, owner approves who gets in | Re-checked on every request |
| Needs | Fullness, energy, affection, decay over real time | Lazy decay: the garden keeps running without a timer |
| Personality | 6 temperaments, each with likes, dislikes and reaction tuning | Numbers in `personality.js`, so tuning doesn't need code |
| Memory | Per-person history: fed, pet, played, bonked, dates | Dialogue calls back to it, and creatures forgive over time |
| Dialogue | Composed lines: temperament voice + memory callback | Deterministic and free. Easy to swap for an LLM later |
| Orientation | `a`, `b`, `both`, `none` (asexual) | Attraction is mutual and is a hard limit on matchmaking |
| Breeding | Traits averaged with noise, hue averaged in colour space, random mutation | Children are new creatures in the garden |
| Art | Simple SVG blobs built from the genome; mood drives the mouth | Babies are smaller; fond creatures blush |

## Analysis: what makes this work, and what could sink it

**The memory is the product.** Lots of games have pets. What makes this one
feel alive is that a creature that was bonked yesterday is wary today, but
warms up after a few kind actions and says so. The MVP does this with
per-person memory and callback lines. The rule to keep: memory has to change
behaviour, not only add flavour text. Right now it changes fear, fondness,
and the reaction chosen, so a callback always means something.

**Personality has to be legible.** Players should be able to predict a
creature. Grumpy creatures dislike being bonked more and forgive slowly. Playful
creatures get bored of play. Shy creatures flinch when they're scared. If a
personality is only a label, it reads as random.

**Shared garden vs. private pets.** The MVP shares one garden between approved
people. Each person gets their own relationship with each creature, but they
share the creatures, the babies, and the matchmaking. That makes the garden
social: someone else's bonk can make a creature nervous around you, and your
introductions can produce a baby that others get to know. The risk is one
user griefing everyone's creatures. Mitigations are under Owner tools in the roadmap below.

**Orientation as a real constraint.** The attraction system has to be fair.
With `a`/`b`/`both`/`none`, a creature that's attracted to `both` can date
almost anyone, and `none` creatures can't breed but can be friends. The
interesting part is the bonds that don't turn into romance. A non-romantic
best friend can matter as much as a partner.

**Don't let it get grindy.** Needs decay, but nothing is ever lost. Dying,
starving, or permanent loss would make people anxious and drive them away.
Decay pushes people to come back, while the reward is always a reaction, a
new baby, or a new diary line.

## What makes it fun

Cozy games like Tamagotchi, Neko Atsume and Animal Crossing work because a
two-minute visit is satisfying and there is always something new since last
time. This garden adds two hooks those games don't have: **being remembered**,
and **drama you caused**.

### Who plays, and what they want

| Player | What they want | What gives it to them |
| --- | --- | --- |
| Nurturer | To be loved back | Creatures greet them by nickname, bring them gifts, pick them as "favourite person" |
| Matchmaker | Reality-TV drama | Crushes, jealousy, breakups, exes, love triangles, a daily gossip paper |
| Breeder | Rare babies, lineages | Hidden recessive traits, a family tree, their name on the lineage |
| Troublemaker | Mischief | Bonks that matter: grudges, gossip, nicknames, redemption arcs |
| Social player | Other people | Creatures mention other visitors; rivalry for one creature's affection |

### Principles

1. **Systems that collide tell stories.** Memory + gossip + jealousy + genetics
   produce stories nobody wrote: "Pipni dumped Lonife because Lonife's kid
   bonked her." That is the replay value.
2. **Consequences outlive the moment.** A bonk should still matter a week and
   a generation later.
3. **Always a reason to come back.** Something happened while you were away,
   and the garden tells you.
4. **Gentle stakes.** Things can go wrong, but nothing is lost forever.
5. **Legible, then surprising.** Learn a creature well enough to predict it,
   then have it surprise you in a way that still fits.

### Ideas, in build order

**Next (biggest payoff for the effort)**

1. **Garden Gazette.** A daily front page of what happened: "SCANDAL: Mibo
   seen on a date with Miba's ex", "Welcome baby Raeku!", "Someone has been
   bonking Pipni. Pipni wants answers." The diary already records the events,
   so this is mostly writing headlines.
2. **Nicknames.** Each creature names you from your history: "Snack Friend",
   "The Bonker", "Cupid", "Stranger". It's the fastest way to make memory visible.
3. **Wander off and come home.** The loss mechanic from Decisions.
4. **Gifts back.** A creature that adores you leaves a pebble, flower or
   drawing. These are collectible, and each one names who gave it and why.

**Then (deeper systems)**

5. **Gossip.** Creatures share opinions of people. Bonk one, and its
   best friend is cold to you before you've met. Feed one, and a friend asks
   for a snack too.
6. **Romance with history.** Couples, jealousy when a partner is introduced
   to someone else, breakups, exes who stay awkward, and rekindled sparks.
7. **Family stories.** Babies inherit a little of their parents' feelings about
   people. Bully a creature, and its children are born wary of you. Love one,
   and its babies run to you first. This makes the troublemaker's choices last
   across generations, the strongest hook on this list.
8. **Personality drift.** Treatment reshapes temperament over time. A Sweet
   creature bonked often turns Shy; a Grumpy one loved consistently softens.
   This is evolution that players cause, not just genetics.
9. **Hidden secrets.** Each creature has one secret to discover, such as a
   fear of thunder or loving to be sung to. Discovering it is a moment.

**Later (breadth)**

10. **Rare recessive traits.** Sparkles, two-tone fur, tiny wings. Two plain
    parents can surprise you. A family tree shows who carries what.
11. **Talk to them.** Free-text chat through an LLM that's given the
    creature's personality and memories, so its voice stays consistent.
12. **Seasons and places.** Day/night, weather, and spots like a pond or sunny
    rock. Where creatures hang out decides who meets whom.
13. **Owner tools.** Rate limits, a "reset this creature" button, and an
    activity log, so one person can't ruin the garden for everyone.

## Decisions

- **One shared garden.** Everyone the owner approves visits the same creatures.
  Each person has their own relationship with each creature.
- **Suns, Moons and Stargazers.** Creatures are Suns (`a`) or Moons (`b`).
  Whom they fall for is a separate gene: Suns, Moons, anyone, or nobody.
  Stargazers aren't into romance but still make close friends. Any mutually
  attracted pair can have babies, so same-kind couples are parents too.
- **No death; creatures can wander off.** A creature that's neglected or
  mistreated for long enough leaves the garden and leaves a note. Anyone can
  leave its favourite food at the garden's edge to coax it home. It comes
  back with a story, and wary of whoever drove it away. Loss is real but
  always recoverable, which suits a cute game. *(Not built yet; first on the roadmap.)*
- **Pace.** Stage times are set to real hours (see `STAGE_HOURS` in `sim.js`).
  Shorten them for quick testing and lengthen them if you want a slow garden.
