# Logging, editing and deleting food

## Measures (what a food can be logged in)

`FoodMeasures.For(food)` (Domain/Units) lists the measures a food really supports, and the app only offers those:

| Kind | Where it comes from | Example |
|---|---|---|
| Count / named portion | the food's own USDA or label portions | almond (1.2 g), large (egg), container, scoop, slice, serving |
| Volume | **solid food:** only through a volume USDA measured for that food (tbsp = its measured cup ÷ 16). **Drink per 100 ml:** exact ml conversions | cup, tbsp, tsp; for drinks also fl oz and ml |
| Mass | exact unit conversion; **never** for a drink measured per 100 ml (that would need its density) | g, oz |

Every measure is computed by the same `QuantityResolver` that converts a logged amount, so a measure the app offers always
resolves to the same weight on the server. Labels are natural ("almond", "container"); the original USDA wording is kept and
shown under each measure ("From USDA: cup, whole"). A solid food without a measured volume says so instead of offering cups.
Measures are sent with every food (`measures` on `GET /api/foods/{id}`, search and match results).

### Names of USDA portions

- A portion is named by its first word ("slice", "large", "container"), which must resolve back to that same portion.
- A description led by a number that qualifies the noun is named by the whole phrase: "100 calorie package" →
  **100-calorie package** (plural "100-calorie packages"), "1-3 ring thin pretzel" and "…thick pretzel" stay two measures.
  The phrase is also the unit that's sent and stored, and `QuantityResolver` matches it exactly (description, label or plural);
  if several portions share that name with different weights, it isn't offered. A number followed by a unit keeps the noun
  ("6 oz container" → container). Entries logged earlier as "calorie" still resolve to the same 18 g.
- "calorie", "kcal" and "NFS" are never a measure, and a portion that starts with a weight ("oz, NFS", "oz, without shell",
  "oz grilled patties", "lb, boneless") is a weight (offered as g/oz), not an item called "nfs", "shell" or "patty".
- The original USDA description is always kept (`source`) and shown under the measure.

### Foundation foods with no USDA measures

Many USDA Foundation foods have no portions in USDA's own download (e.g. "Nuts, almonds, whole, raw": none in
`food_portion.csv`), so only g/oz can be offered. Most continue an SR Legacy food and carry its NDB number (here 12061, SR
Legacy "Nuts, almonds", which has almond 1.2 g and cup, whole 143 g). `enrich-usda-portions` (below) copies the SR food's
portions onto the Foundation food only when `EquivalentPortions` shows they're the same physical food:

- the shared NDB number (USDA's link), **and** every word of the SR name appears in the Foundation name, which adds only
  "raw", "whole", "halves" or "kernels" (so no other variety, state, cut, salt level or form: Honeycrisp ≠ Golden Delicious,
  raw ≠ grilled/dried/roasted, ground flaxseed ≠ whole seeds);
- if the Foundation name adds a cut ("whole", "halves"), only portions naming that cut, and items, are taken: whole almonds
  get "cup, whole", never "cup, sliced/slivered/ground", and no plain cup;
- weights are copied unchanged, each borrowed portion records `origin` ("USDA SR Legacy “Nuts, almonds” (FDC 170567, same
  NDB 12061)"), and the app shows it under the measure. Nutrition, names and ids are never changed.

Anything that can't be shown to be the same food stays without household measures (the command lists each one and why).
Against the 2026-04 Foundation and 2018-04 SR Legacy downloads it fills 49 of 115 linked foods; 66 are left as they are.

```bash
# From backend/src/NutriPlan.Api, with DATABASE_URL pointing at the database to change:
dotnet run -- enrich-usda-portions <foundation folder> <sr legacy folder>           # dry run: lists what would change
dotnet run -- enrich-usda-portions <foundation folder> <sr legacy folder> --apply   # saves; safe to re-run
# In the Docker image the folders are under /data/usda:
#   dotnet NutriPlan.Api.dll enrich-usda-portions /data/usda/<foundation>/<…> /data/usda/<sr legacy>/<…> [--apply]
```

On a hosted deployment with no shell (Render), set the environment variable `Usda__EnrichPortions` to `dry-run` and restart: the
server logs every food it would change and each one it leaves alone, and saves nothing. Then set it to `apply` and restart to
save, and **remove the variable afterwards** (it is harmless but runs every start). It uses the USDA files baked into the image
(`Usda:SeedFolder`).

It only touches Foundation foods with **no** portions, so re-running changes nothing. A fresh database gets this automatically
after the first-start USDA import; an existing one only when someone runs the command. Undo:
`update foods set portions = '[]' where source = 'UsdaFoundation' and portions @> '[{}]' and not exists (select 1 from jsonb_array_elements(portions) p where p->>'origin' is null);`
Diary and plan entries keep their snapshots; recipe ingredients keep their stored grams until edited or re-matched.

### Search

`FoodRanker` adds a small +2 to a food with a count or household-volume measure from USDA data (its own, or borrowed as above)
(`FoodRanker.HasMeasuredPortion`). That only separates otherwise-equal matches: what you asked for (raw/cooked, the food
itself), the source's trust and your own history all count for more.

## Editing an amount

- `PATCH /api/diary/{id}` accepts `{ amount, unit }` (and still `scale` / `meal` / `date`); `POST /api/plan/{id}/amount`
  does the same for a planned item (only while it's planned).
- `ItemAmounts.ChangeAsync` resolves the new amount to a weight and scales **the entry's own logged nutrition** by the change
  in weight (same unit: the ratio of amounts). Historical numbers are never re-read from a food that changed since, and the
  amount, unit, weight and nutrition always agree. Recipes change in servings; quick entries have no amount.
- An entry can always change its amount in its own unit (even an older one such as "oz (23 whole kernels)" or "2 eggs"
  stored as "serving"); plural spellings count as the same unit. Undo sends the previous amount, unit and weight, so an
  older unit is restored exactly.
- Refused with the reason (400): zero/negative/non-numbers, amounts that would round to nothing (under 0.001, or 0.01 g/ml),
  more than 5 kg, 5 litres or 50 servings (new logs too), a measure the food doesn't have, converting a drink to grams, a unit
  sent without an amount, or converting an old entry whose original weight is unknown.
- Typing "1,000" is refused (it could mean 1000 or 1.000); a decimal comma like "1,5" is fine.
- The app's `features/quantity` model (parse, convert, preview) mirrors this exactly for the live preview; the server is
  authoritative. One `QuantityPicker` is used by the diary editor, new logs/plans/recipe ingredients, planned items and Ask.
- The diary and planned-item editors keep the height they opened at (`BottomSheet` `steadyKey`): opening the measure list
  scrolls inside the editor instead of pushing the sheet's top and title up (#52). The sheet still gives way to the keyboard.
- Typing: decimals with `.` or `,`, fractions `1/2`, `1 1/2`, `½`, `1½`. Switching measure keeps the physical amount.
- Save is disabled for invalid amounts and while saving; a failed save keeps the draft; Undo restores the previous amount
  and measure (and meal).
- **View nutrition** in the editor shows the saved entry's snapshot, including catalog nutrients and units. Missing values say
  "Not reported"; a reported zero stays zero. It does not include unsaved quantity changes or read the food's current nutrition.
  Recipe values may be incomplete when ingredients or nutrients were missing.

## Deleting

Swipe a logged diary row left (Today and Week) to reveal **Delete**; it never deletes by itself. Tapping Delete hides the row
and shows Undo; the server delete happens when the Undo window closes (about 5 s). One row is open at a time; tapping a row or
starting to scroll closes it (that tap doesn't open the editor). A drag has to be clearly sideways to take the touch, so taps and
vertical scrolling are untouched. Screen readers get a "Delete" action on the row, and Delete is also in
the editor. Long press is reserved (not used).

- Implementation: `features/diary/SwipeableDiaryRow.tsx`: React Native's own `PanResponder` + `Pressable` (not a gesture-handler
  swipe component: inside `ReanimatedSwipeable` taps on the row and on the revealed Delete button never arrived on an Android phone,
  so editing and deleting didn't work). `GestureHandlerRootView` and gesture-handler's `ScrollView` on Today/Week stay from the
  earlier version and still work. With reduced motion on, the row jumps instead of sliding.
- Web: works with touch (phone browsers). A desktop mouse drag does not open the swipe; use Delete in the editor there.

## Barcode scanner

- Android keeps continuous autofocus (expo-camera's Android `autofocus` option focuses once at a corner of the preview, so it
  isn't used). Blur is usually the phone held closer than its camera can focus: the guide is shorter and wider, a hint asks for
  15–20 cm, a **zoom** toggle (a share of the phone's own max zoom, so magnification varies by phone) lets you stand back, and a
  **torch** toggle helps in dim light.
- **Type the barcode** is always available (digit count and check digit validated). It's also offered when camera access is
  denied (with Open settings when Android won't ask again) or the camera fails to start.
- One lookup at a time; a code that just failed isn't looked up again for 4 s while the camera keeps seeing it. USDA → Open
  Food Facts lookup, Retry for temporary failures, and manual label entry for unknown codes are unchanged; a focus problem is
  never reported as "not found".
- Devices whose Google Play services lack ML Kit barcode scanning can't scan with the camera; typing the barcode still works.

### Web scanner (Chrome on Android, desktop browsers)

`features/scan/ScanCamera` is split by platform. Android/iOS use `ExpoScanCamera` (expo-camera `CameraView`, the same props as before).
On web, `ScanCamera.web.tsx` opens the camera itself when the browser has `BarcodeDetector`, because expo-camera's web camera
can't be told a picture size, a focus mode or a lens: it asks for `facingMode: environment` only, so Chrome returns its default
size (measured: 640×480 even from a camera that supports 3840 px wide), stretched over the screen, and the focus mode it tries
to set is dropped by its own converter. What the web scanner does (pure logic in `webCamera.ts`, tested):

- Requests the rear camera at an ideal 1920×1080; if the browser says that can't be met it retries looser (rear camera, then any).
- Applies continuous focus only when the camera's capabilities list it. If the default lens reports focus modes **without**
  continuous (fixed focus), it tries the other rear lenses once, one at a time (a phone can't open two), keeps the first with
  continuous focus (if none has it, the browser's own choice stays), and closes the rest. No device ids or labels are hard-coded; a camera that reports
  nothing about focus is left as the browser chose it. No repeated restarts.
- **Zoom** is offered only when the camera has a zoom range with a real step above the normal view; it goes to 2× (never
  further: more is only digital enlargement). **Torch** is offered only when the camera lists it. Native buttons are unchanged.
- Reads EAN-13, EAN-8, UPC-A and UPC-E (the formats this browser's detector supports) about four times a second, one detection
  at a time, paused while the tab is hidden. The screen's gate, lookup, haptics and manual entry are shared with native.
- Browsers without `BarcodeDetector` (Safari, Firefox) use the previous expo-camera scanner unchanged (it loads a decoder).
- Failures say what to do: blocked (how to allow it in Chrome), no camera, in use by another app/tab, not https. Typing the
  barcode is always offered. The camera and the detection loop stop when you leave the screen or the camera is taken away.
- Development builds log the chosen camera's size, focus modes, zoom range and torch support to the console (no images, ids or tokens).

## Needs checking on a physical Android phone (not verifiable in CI)

1. Tap a logged food on Today and Week: the editor opens; Save and Delete there work. Swipe left on a logged food: Delete appears;
   tap it: the food disappears with Undo (Undo brings it back; after ~5 s it's gone on the server and stays gone after a refresh);
   a short drag or vertical scrolling doesn't open it; TalkBack offers "Delete".
2. Editor: decimal keypad appears, the field isn't hidden by the keyboard, switching measure keeps the amount, Save/Undo work.
   Open View nutrition and return with a quantity draft: the saved amount and values remain distinct from the draft, scrolling
   and large text work, and nothing saves until Save changes is pressed. Open the measure list (on a food with many measures):
   the editor's title must not move; the list scrolls with the editor; picking a measure and typing still work with the keyboard up.
3. Scanner: sharpness at 15–20 cm, with and without zoom; torch on/off; a small barcode; dim light; denied permission;
   typing a barcode.
   **Web in Android Chrome** (confirmed on a Pixel: sharp, reads a barcode; repeat on other phones): open the site in Chrome, Today → scan;
   hold a barcode 15–20 cm away: the preview should be sharp and refocus as you move; a pickle jar's barcode should read
   within a couple of seconds; try the zoom button; deny camera access (Chrome site settings) and check the message and that
   typing works; open the camera in another app first and check the "in use" message; leave the screen and check the camera
   light goes off. Use `chrome://inspect` → the page's console in a dev build to see the chosen camera's size and focus modes.
4. Ask review: tap a row's checkbox to leave a food out (name struck through, totals and "Log N selected" update); TalkBack
   reads it as a checkbox "Include <food>".
5. Recipes: search a recipe's name in Add food: it's listed under "Your recipes" with a "Your recipe" badge; log 1 serving
   and, on a recipe with a finished volume, 1 cup; edit the logged entry between cups and servings. On a recipe, choose an
   ingredient → pick another recipe → Use as this ingredient; the line reads "Your recipe: …".
6. Today bulk move: choose **Select entries**, select foods from at least two different meals with TalkBack and touch, choose a
   destination meal, then confirm. All selected entries should move together without changing their date, quantity, or saved
   nutrition; cancel the destination sheet and verify nothing moves; try again after refreshing. Verify Move is unavailable with
   no selection, a failed request leaves the selection available to retry, and TalkBack announces each row's checked state.
7. Large text (Android font size at maximum) on the editor, rows, Ask review and scanner.
