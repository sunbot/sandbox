# Recipes (unified recipe system)

One recipe model serves logging, planning and cooking: any recipe can be logged, planned, or used as an ingredient of
another recipe, at any depth.

## Model

- `Recipe` holds ingredient lines (jsonb). A line is matched to **a food** (`FoodId`, `Grams`) or to **another of your
  recipes** (`RecipeId`, `Servings`), or is unmatched/excluded. `UseFood` / `UseRecipe` switch a line cleanly between the two.
- Nutrition (`RecipeNutritionCalculator`): food lines add grams × the food's per-100 g data; recipe lines add servings × that
  recipe's per-serving nutrition. A nutrient no ingredient reports stays unknown (absent), never zero. Coverage is the share
  of countable lines that count; a nested recipe counts as far as its own coverage (a half-matched sauce counts half), with
  a warning that its numbers are a minimum.
- The per-serving result is cached on each recipe (`NutritionPerServing`) because lists, search, Fill the Gaps and logging
  read it constantly.

## Nesting rules

- **No loops** (`RecipeGraph.PathTo`): a recipe can't contain itself, directly or through others. The error names the chain.
- **Edits flow upward** (`RecipeService.PropagateAsync`, `RecipeGraph.DependentsInOrder`): after a recipe changes
  (ingredients, servings, finished weight/volume, re-import), every recipe that uses it is recalculated innermost first. A nested
  amount given by weight or volume ("200 g sauce") is converted again through the changed finished weight/volume; one given in
  servings stays that many servings.
- **Snapshots don't move**: diary and plan entries keep the nutrition they were saved with. Only new logs and plans use new numbers.
  A recipe entry also saves its **servings** (`ItemSnapshot.Servings`), so "1 cup" stays 1 serving's worth even if the
  recipe's finished volume later changes; converting the entry to another measure starts from those saved servings.
- **A conversion that no longer works isn't kept silently**: if a nested line was given by weight/volume and that recipe's
  finished weight/volume is removed, the line stops counting and asks for an amount (it stays linked to the recipe; Refresh
  matches never turns it into a food).
- **Limits**: recipe entries are bounded by servings (50 per meal; 500 as an ingredient), not by the 5 kg food limit, so a
  heavy batch can be planned.
- **Delete guard**: a recipe used inside another can't be deleted until it's removed there (its parents would silently lose it).
- Decision: recalculate-and-cache on write rather than compute-on-read. Recipes are few per user and change rarely, reads
  are many, and every reader already uses the cached value; on-read recursion would have touched every read path.

## Measures (`RecipeMeasures`)

A recipe is measured in **servings** always; by **weight** (g, oz) only when you entered the finished weight; by **volume**
(cup, tbsp, fl oz, ml) only when you entered the finished volume (`recipes.finished_volume_ml`). Nothing is estimated from the
ingredients. Each measure's `base` is servings per unit, so the app's `QuantityPicker` (base unit `serving`) converts recipes
exactly as it does foods. Logging, planning (`Amount` + `Unit`), editing a logged/planned recipe, and nesting all resolve
through the same `RecipeMeasures.Resolve`.

## Grocery list

A planned recipe's ingredients are scaled by its saved servings (a recipe planned as "250 g" of a 1 kg pot is a quarter of
it), and a line that is another of your recipes is expanded into that recipe's own ingredients, all the way down.

## App

- Search (`app/food/search.tsx`) lists **Your recipes** first, each marked "Your recipe" (chef-hat badge), then foods. In a
  recipe's ingredient search the recipe itself isn't offered.
- `app/recipe/amount.tsx` picks how much of a recipe: log, plan, or "Use as this ingredient".
- On a recipe, a nested line reads "Your recipe: Sauce · 2 servings (500 g)"; its sheet offers Change amount / Open this
  recipe; the recipe it's in is listed under "Used in".

## Not yet (later phases)

Automatic matching of ingredient text to your own recipes (you pick them); batch/inventory tracking; recalculating history.
