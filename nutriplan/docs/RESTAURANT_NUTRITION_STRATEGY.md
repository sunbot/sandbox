# Restaurant Nutrition Strategy (Phase 2.5)

Date: 2026-11-23. Status: **research and recommendation only**. No restaurant provider will be built without owner approval.

## What the chains publish (official sources)

| Chain | Official data | Format | Notes |
|---|---|---|---|
| Chipotle | chipotle.com/nutrition-calculator; a US nutrition chart PDF | calculator + PDF (the PDF found is from 2021–22) | ingredient-level (rice, beans, meats, salsas), which suits build-your-own bowls |
| Chick-fil-A | chick-fil-a.com/nutrition-allergens | web pages (US); PDFs only for UK/Singapore | standard recipes; customizations not covered |
| McDonald's | mcdonalds.com/us/en-us/about-our-food/nutrition-calculator.html | calculator + item pages | values are averages of standard formulations; site under its online terms (2025) |
| Taco Bell | tacobell.com/nutrition (+ allergen page, calculator) | web pages | full nutrition and ingredient statements online |
| Panera | panerabread.com nutrition guide (PDF, US and Canada) | PDF | the copies found were dated 2016–18; the current US file is linked from the site |
| Starbucks | starbucks.com/menu (per item); country PDFs | web pages + seasonal PDFs | calculated with ESHA from standard recipes; values change without notice |

US chains with 20 or more locations must post calories and provide fuller nutrition information under the FDA menu
labeling rule (compliance since 2018). That makes the data **available**, but **not licensed for reuse**.

## Licensing: public ≠ redistributable

- Chain websites are covered by their own terms of use (McDonald's online terms, for example). None of the pages found
  grants a licence to copy the data into another product. Treat chain nutrition as **copyrighted compilations under
  restrictive terms** unless a chain says otherwise. Facts aren't copyrightable in the US, but bulk scraping and storage
  can breach site terms, and commercial reuse raises the risk. **Not legal advice:** get a review before commercialising.
- **USDA FoodData Central is CC0** (public domain), and the app already uses it:
  - FNDDS has **177 generic "fast food" / "restaurant" foods** ("Hamburger, from fast food, 1 large patty").
  - SR Legacy has **215 restaurant entries**, including some chain-named ones ("McDONALD'S, QUARTER POUNDER with Cheese",
    "TACO BELL, BURRITO SUPREME with chicken", "CHICK-FIL-A, hash browns"). They are frozen as of 2018 and **menus have changed since**.
  - USDA Branded is supplied by manufacturers. Restaurant menu items are rarely in it (not verified per chain).
- **Commercial APIs** (Nutritionix and others) license restaurant data. Reported pricing is a few hundred to about $1,000+ per
  month, recently with no free tier. The sources disagree, so confirm directly. **This is a paid service and is out of scope without approval.**

## Recommendation: low-cost, honest, USDA-first

1. **Keep USDA as the core.** Restaurant support is a separate provider with its own source type, as `CLAUDE.md` already
   requires: "a separate provider abstraction for restaurant/branded text search", and "serving-based restaurant items
   explicitly where gram weight is unknown".
2. **Tier 1 (no cost, no licensing risk): surface what we already have.**
   - Label SR Legacy chain items as **"USDA, chain item as of 2018 or earlier: menu may have changed"**.
   - Label FNDDS generic restaurant foods as **"USDA estimate for a typical restaurant item"**.
   - Let search show them for chain names. No new data, only attribution and a freshness warning.
3. **Tier 2 (no cost, user-owned): "From the restaurant's site" custom foods.** The user enters an item from the chain's
   official page into the existing custom food form. It's saved per user with the source (chain name, URL, date) and
   **serving-based** (no invented grams). Nothing is redistributed: each user enters what they need. Phase 3 OCR can read
   a screenshot of the official page to speed this up.
4. **Tier 3 (needs approval): licensed data.** Only if many users need many chains: a licensed API, behind the restaurant
   provider interface, with caching and attribution per its terms. Decide on cost and terms first.
5. **Never present estimates as official.** Every restaurant value carries one of: `Official (chain, date)`,
   `USDA chain item (≤2018)`, `USDA generic estimate`, or `Your entry`. The data model already keeps source and quality per
   food, so this needs labels and a source kind, not a new system.

## Proposed next steps (for approval)

- [ ] Tier 1: chain-name search and labels for existing USDA restaurant items (code only; no data change).
- [ ] Tier 2: a "restaurant item" option in custom foods (serving-based, with source URL and date).
- [ ] Decide whether Tier 3 (a paid licence) is ever wanted.

Sources:
[Chipotle nutrition calculator](https://chipotle.com/nutrition-calculator) ·
[Chipotle US nutrition PDF](https://chipotle.com/content/dam/chipotle/menu/nutrition/paper-menu-standard-no-pricing120221-us.pdf) ·
[Chick-fil-A Nutrition & Allergens](https://chick-fil-a.com/nutrition-allergens) ·
[McDonald's Nutrition Calculator](https://www.mcdonalds.com/us/en-us/about-our-food/nutrition-calculator.html) ·
[McDonald's online terms](https://www.mcdonalds.com/us/en-us/terms-and-conditions.html) ·
[Taco Bell nutrition](https://tacobell.com/nutrition) ·
[Taco Bell FAQ](https://www.tacobell.com/faq/our-products-nutrition) ·
[Panera nutrition PDF (CDN)](https://www.panerabread.com/content/dam/panerabread/documents/nutrition/Panera-Nutrition-CDN.pdf) ·
[Starbucks UK nutrition](https://www.starbucks.co.uk/nutrition) ·
[Starbucks DE nutrition (ESHA method)](https://starbucks.de/en/nutrition) ·
[FDA menu labeling requirements](https://www.fda.gov/food/food-labeling-nutrition/menu-labeling-requirements) ·
[FoodData Central data types (CC0)](https://fdc.nal.usda.gov/data-documentation) ·
[Nutritionix API pricing (third-party summary)](https://calorieapi.com/blog/nutritionix-api-pricing) ·
[Nutrition API comparison 2026 (third-party)](https://www.getdietly.com/developers/nutrition-api-comparison/)
