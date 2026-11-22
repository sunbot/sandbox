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
- Typing: decimals with `.` or `,`, fractions `1/2`, `1 1/2`, `½`, `1½`. Switching measure keeps the physical amount.
- Save is disabled for invalid amounts and while saving; a failed save keeps the draft; Undo restores the previous amount
  and measure (and meal).

## Deleting

Swipe a logged diary row left (Today and Week) to reveal **Delete**; it never deletes by itself. Tapping Delete hides the row
and shows Undo; the server delete happens when the Undo window closes. One row is open at a time; tapping a row or starting to
scroll closes it (that tap doesn't open the editor). Screen readers get a "Delete" action on the row, and Delete is also in
the editor. Long press is reserved (not used).

- Implementation: `features/diary/SwipeableDiaryRow.tsx` (react-native-gesture-handler `ReanimatedSwipeable`, with
  `GestureHandlerRootView` at the app root and gesture-handler's `ScrollView` on Today/Week). Reanimated follows the system
  reduced-motion setting.
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

## Needs checking on a physical Android phone (not verifiable in CI)

1. Swipe left on a logged food on Today and Week: Delete appears; tap it; Undo restores; vertical scrolling still works and
   doesn't open swipes; only one row open at a time; TalkBack offers "Delete".
2. Editor: decimal keypad appears, the field isn't hidden by the keyboard, switching measure keeps the amount, Save/Undo work.
3. Scanner: sharpness at 15–20 cm, with and without zoom; torch on/off; a small barcode; dim light; denied permission;
   typing a barcode.
4. Large text (Android font size at maximum) on the editor, rows and scanner.
