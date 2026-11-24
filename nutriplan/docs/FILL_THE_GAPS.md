# Fill the Gaps (recommendation engine V2)

"What can I add to round out today?" is deterministic: no language model, and every number comes from your foods,
recipes and diary. Code: `NutriPlan.Domain/Planning/GapRecommender.cs` (engine), `GapFillPolicy.cs` (thresholds),
`GapRoles.cs` (what a food is), `GapExplainer.cs` (reasons); `NutriPlan.Application/Planning/GapFillService.cs`
(builds the day and the candidates); `mobile/src/app/gaps.tsx`.

## Why V1 gave silly answers

V1 minimized a weighted squared error over all nutrients. With nothing in the objective that means "enough to matter"
or "stop", the optimum for a day that is far over on calories was the smallest allowed amount of many dense foods
(5 g of broccoli, 80 g of coffee); the smallest amount was a quarter of what you usually log, floored at 5 g. Calories
were a soft penalty, so 100 kcal left could become +282 kcal. Candidates had no roles, so any three foods could be
combined, and a nutrient absent from the logged foods looked like a deficiency.

## How V2 decides

1. **Situation** from calories left (eaten + still planned): `Open` (>= 250 kcal: a meal fits), `Near` (80-249: a
   snack), `AtTarget` (< 80, or within 3 % over) and `Over`. At target or over, **nothing is added**; the screen
   shows lighter swaps for planned, uneaten meals (same kind of item, at least 100 kcal lighter, no major gap gets
   worse) and familiar foods that are real sources of what ran short, to plan for tomorrow.
2. **Needs.** Goals (protein, fiber, vitamins, minerals) that are still at least 10 % short; limits (sodium, saturated
   fat, added sugar) are constraints. A nutrient is judged only if it is listed for at least 80 % of the day's logged
   calories; otherwise it is not called a gap, not ranked on and not claimed. Carbs and fat are shown but not chased.
3. **Candidates**, each with a role (meal / main / side / snack / ingredient) and **real portions only**: saved
   recipes with full nutrition (one serving), pantry foods (never more than you have), foods you log (your usual
   amount) and, for new users, a few staples. A portion is your usual amount, a labelled/NLEA serving, the food's
   natural item ("1 medium") or a cup USDA measured for that food. No usable portion = not suggested (nothing is
   invented). Quantities are ½, 1, 1½ or 2 portions (whole numbers for countable items such as eggs), at least 15 g.
4. **Coherence.** A suggestion is a saved recipe (a meal, snack or side dish), a main with a vegetable, grain or legume
   (or a vegetable plus a grain/legume), or a compatible snack pair (yogurt + fruit, or a pair you have eaten together
   at least twice). A side food (carrots, rice, lentils) is never suggested alone, breakfast cereals aren't paired with
   a main, every item in a combination supplies at least 25 kcal, and ingredients (oil, coffee, flour) are never
   suggested. Roles come from a transparent rule table over the food's own name (USDA reads "Food, modifiers", so
   words like "water" or "without salt" in a modifier don't matter), then its category, and recipe categories.
   Prepared dishes (soup, pizza, sandwich) are sized by their calories rather than assembled.
5. **Hard constraints:** inside the calorie window for its category (snack 80-300, side 40-300, meal 250-900 kcal,
   never more than 5 % over what's left); an exceeded limit is never pushed further (a food with an unknown value for
   a nearly used-up limit is skipped); every item covers at least 10 % of an open need (judged against the share of the
   day's needs a suggestion of that size is expected to fill, so a snack isn't measured against a whole empty day).
6. **Ranking:** coverage of the top three needs against the whole gap (capped at what's still needed) + how much of
   the calorie room it uses + familiarity (favorite recipe, pantry, eaten at least 3 times in 90 days, your meal slot,
   eaten together) - complexity - **protein pacing** (#87). When protein is still a gap, a suggestion that uses a much
   bigger share of the calories left than of the protein still needed is ranked lower: `ProteinPacingWeight` × (calorie
   share − protein share) × protein's priority. When the difference is 40 points or more, the card says so as a caution,
   e.g. "Uses 80% of your remaining calories but only 10% of the 115 g protein still needed". Pacing is a ranking
   trade-off, not a filter: such a dish is still offered when it helps other gaps. Known: the need score sums every open
   gap against the top three priorities, so it can exceed 1 when one dish touches many micronutrients. Pacing counters this
   for protein; the score itself is unchanged, to keep the show/hide threshold stable. To show at all, a suggestion must cover at least 25 % of the share of those needs
   a suggestion of its size is expected to fill, so the list can be shorter than three, or empty. Where something comes
   from ("You eat this often", "Uses food from your pantry") is only claimed for a combination when true of all of it.
7. **Modes** (`mode=` on `GET /api/plan/gaps`): `BestMatch`, `Meal` (meals only, needs room for one), `QuickSnack`,
   `Pantry` (pantry foods, and saved recipes whose matched ingredients are all in the pantry) and `SavedRecipes` (recipes only; `recipesOnly=true` still works). The response lists
   only modes that have results; an empty selected mode returns a reason (`NoPantry`, `NoRecipes`, `NoRoomForMeal`, ...).
8. **Explanations** (`reasons`, `effects`) are generated from the calculated amounts ("Adds about 18 g protein (32 g
   still needed)"), only for nutrients the suggestion really contributes to.

## Show different ideas

The engine already builds and checks every qualifying idea (each combination at its best real amount) and shows the best
three with different lead foods. "Show different ideas" pages through the rest of that same list; nothing is added,
estimated or randomised.

- Each idea has a stable `id`: a short hash of its sorted food/recipe keys, so the same foods in any order or amount are one
  idea. The app keeps the ids it has shown this visit and sends them back (`GET /api/plan/gaps?…&exclude=id1,id2`, at most
  300, malformed ids ignored); `GapRecommender.SuggestPage` skips them and puts ideas led by a food that already led a shown
  idea after fresh ones. The same inputs always give the same pages.
- Filters (Best match, Meal, Quick snack, Pantry, Saved recipes) and the destination meal stay as chosen; rotation works within
  them. Planning or logging an idea recalculates what's left, and foods/recipes already logged or planned for the day aren't
  suggested again.
- Each filter keeps its own list of skipped ideas, so rotating in Best match doesn't use up Saved recipes.
- Meals and snack pairs are assembled from the 10 most relevant candidates of each kind (`CombinationPoolSize`), so "all
  ideas" means all qualifying ideas within that bounded search, not every possible pairing in the database.
- When every qualifying idea has been shown, the screen says "No more matching ideas right now." (`emptyReason: Exhausted`,
  or under the last page when `moreIdeas` is 0) with **Start over**, which clears the skipped list. Leaving the screen ends the
  session. No language model or paid service is involved: one candidate build per request, as before.

## Tuning

Every threshold is a property of `GapFillPolicy` and can be set with environment variables (`GapFill__MinSnackKcal`,
`GapFill__MinMealKcal`, `GapFill__MinPortionFraction`, `GapFill__MinContributionShare`, `GapFill__MinDataCoverage`,
`GapFill__MinSuggestionScore`, ...). Defaults are in the class, with comments.

## Tests

`GapRecommenderTests` (domain, 94): situations and thresholds; 500 / 200 / 50 kcal left; 1,200 kcal over; protein met;
incomplete data; exceeded and near limits; token portions; portion multiples; filler items; meal and snack coherence;
modes; empty and rich pantry; no suitable suggestion; determinism; explanations; swaps; next-day ideas; role rules.
`GapFillServiceTests` (18): real portion choice, pantry stock limits (including partly weighed stock), recipes
cookable from the pantry, recipes-only, over/at target through the service, data coverage and limits the day's data
can't judge, the "eats often" threshold, real USDA names, sodium, configuration. `AuthAndIsolationTests`: a second user never sees another's pantry
foods in any mode. App: `features/gaps/gapView.test.ts`.

A second, independent review found and led to fixes for: real USDA names misclassified as ingredients, lone side foods,
incoherent main + grain pairings, snacks outranking meals, overshoot worded as "fits", combination-wide origin claims,
partly weighed pantry stock, uncapped starter searches, and app state keyed by list position.

## Known limits

- Roles are rule-based on names/categories; an unusual food the rules don't know is only suggested if you eat it.
- Mixed dishes logged as one USDA food (e.g. "pizza") are not assembled into meals; use saved recipes for those.
- Drinks measured in ml are not suggested (as before).
