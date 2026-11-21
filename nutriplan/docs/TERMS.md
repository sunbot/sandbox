# Calorie terms used in Intake Grid

Each word means one thing everywhere in the app. All numbers come from the diary (what you logged) and the plan
(what you intend to eat); nothing planned is ever counted as eaten.

| Term (as shown) | Meaning |
| --- | --- |
| **Eaten** | Calories of diary entries for the day (or week so far). A planned meal counts only once it is logged, and only once. |
| **Planned** | Calories of plan entries still marked Planned. Skipped and eaten entries are not included. |
| **Left to eat** (Today) | Today's target minus what you have eaten. Ignores the plan. |
| **Not planned yet** (Week) | The day's (or week's) target minus *eaten + planned*: room that no meal is assigned to. It is **not** the same as "left to eat". |
| **Eaten + planned** | Eaten plus planned: where the day or week lands if you follow the plan. |
| **Over target** | Eaten + planned is above the target. |
| **Daily target** | The calorie goal you set. In weekly budget mode each day's target is adjusted (below). |
| **Adjusted target** | Weekly mode only: the daily target after spreading what you are over/under so far across the remaining days. Marked "adj." in Week. The weekly-budget algorithm is unchanged. |

Example (21 Nov): target 1,410, rice logged 338 kcal, nothing else planned. Today shows **338 eaten, 1,072 left to eat**.
Week shows **338 eaten + 0 planned, 1,072 not planned yet**. Both are the same 1,072 kcal of room, described from two angles.

## Planned vs logged rules

- A plan entry is **Eaten** only while a diary entry linked to it exists. If the log is deleted the meal returns to **Planned**.
  Reads (Week, Grocery, gap suggestions, rebalance) repair legacy "Eaten without a log" rows in memory so every screen agrees.
- "Mark eaten" creates exactly one linked diary entry. The database has a unique index on the link, and Log all / Plan all
  accept an `Idempotency-Key`, so a double tap or retry cannot save twice.
- A meal planned for a later day cannot be logged early. "Today" is the device's date (sent by the app), not the server's.

## Recipe details: three separate ideas

- **Show** (Per serving / Whole recipe / Per 100 g): only changes how the numbers are displayed. Per serving is the stored value;
  whole recipe is per serving × the servings the recipe makes; per 100 g is the whole recipe ÷ the finished dish's weight × 100.
- **Makes** (the recipe's yield): how many servings the whole recipe produces. Editable with *Change*.
- **Servings I'm having**: how much you are logging or planning (fractions allowed). Independent of the two above.

Per 100 g appears only when a finished-dish weight (`cookedWeightGrams`) was entered in Edit recipe. It is never estimated from
ingredient weights (raw weight is not cooked weight) or invented densities.

The macro donut splits *macro-derived* energy (protein 4, carbohydrate 4 including fiber, fat 9 kcal per gram). The centre shows the
recipe's own calories; when the two differ noticeably the screen says so (fiber, alcohol, rounding) instead of forcing them to match.
"Based on N% of ingredients" counts lines that have a food and an amount; it does not verify that each match is the right food.

## Nutrients screen

- **Overview** shows one day (today by default) or **Week average**: the average per *finished* logged day; today is never
  averaged because it is still under way. The heatmap's "avg" column uses the same finished days.
- Goal statuses: **Goal met** (100%+), **Nearly met** (90–99%, finished day), **Below goal** (under 90%, finished day),
  **In progress** / **Behind pace** (today). Carbohydrate and fat above 110% of target read **Over target** (more isn't better there). Limit statuses: **Within limit** or **Over limit**; reaching a limit is never shown as an
  achievement, and limit bars carry a marker at 100%.
- **Some data missing**: at least one entry has no value for the nutrient (unknown, not zero). The amount is shown as "≥" and the
  nutrient is never called below goal or within limit, because the real amount may be higher. The summary counts these; a
  collapsed row just reads "In progress" (today) or "May be higher", and opening it explains which entries lack the value. A known amount that already
  reaches a goal or exceeds a limit still counts.
- Weekly notes ("Below goal on average…") need at least 3 finished logged days and skip nutrients with missing data.
- **From** (food sources) is shown for a single day only, from each entry's saved nutrition snapshot.
