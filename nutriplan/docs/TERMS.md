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
