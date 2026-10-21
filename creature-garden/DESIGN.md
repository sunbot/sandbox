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
user griefing everyone's creatures. Mitigations are in the expansion list below.

**Orientation as a real constraint.** The attraction system has to be fair.
With `a`/`b`/`both`/`none`, a creature that's attracted to `both` can date
almost anyone, and `none` creatures can't breed but can be friends. The
interesting part is the bonds that don't turn into romance. A non-romantic
best friend can matter as much as a partner.

**Don't let it get grindy.** Needs decay, but nothing is ever lost. Dying,
starving, or permanent loss would make people anxious and drive them away.
Decay pushes people to come back, while the reward is always a reaction, a
new baby, or a new diary line.

## Expansion ideas (ranked by how much they add per unit of effort)

1. **Richer breeding and evolution.** Stages already change size. Next, make
   stages change traits: a baby with high curiosity might grow up into a
   scout. Add rare mutations, visible traits (patterns, colours, accessories)
   that come from memories, and "lineages" you can track on a family tree.
2. **Talking to them.** A free-text "say something" action. Use an LLM with the
   creature's personality, the user's memory list, and recent diary entries as
   context. Keep the template engine as the fallback for cost and latency.
   Their voice stays consistent because the personality and memory are
   structured data, not prompt-only.
3. **Grudges and reputations.** Creatures talk to each other, so a bonk
   spreads. A creature can warn a friend ("be careful, that one bonks"). This
   turns one-on-one memory into a social system and gives players a reason to
   behave.
4. **Creature-to-creature events.** Without anyone watching, creatures bond,
   fall out, argue, and make up. The diary records what happened while you were
   gone. This is the cheapest way to make the world feel alive.
5. **Seasons and weather.** Day/night and seasons change needs and moods, and
   unlock seasonal foods and traits.
6. **Garden building.** A place for creatures to live: a pond, a sunny rock,
   a nest. Their location changes which creatures meet, and so who
   might fall in love.
7. **Consent and safety guardrails.** Creatures can refuse. A creature that
   has been bonked a lot can set a boundary: no more play until you apologise.
   You can't force a date with someone who doesn't want one. The MVP already
   refuses petting when a creature is too scared, and says so in its reaction.
8. **Owner tools.** Moderation controls: rate limits per person per creature,
   an owner-only "reset this creature" action, and an activity log.

## Decisions to make with you

- **Pronouns and labels for orientation/sex.** The MVP uses placeholder
  sexes `a` and `b`, with `both` and `none` for attraction. You may want
  different labels or more options. The code treats them as data, so it's a
  rename, not a rewrite.
- **Feel of dying or losing a creature.** The MVP never kills creatures. Do
  you want permanent loss, or is that too harsh for a cute game?
- **Who else shares the garden.** The owner approves everyone, so a
  single garden is the default. Would you rather each approved person have
  their own garden?
- **Pace.** Stage times are set to real hours (see `STAGE_HOURS` in `sim.js`).
  Shorten them for quick testing and lengthen them if you want a slow garden.
