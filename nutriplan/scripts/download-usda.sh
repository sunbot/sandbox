#!/usr/bin/env bash
# Downloads the USDA FoodData Central datasets NutriPlan uses (public domain) and imports them.
#   ./scripts/download-usda.sh            # Foundation + SR Legacy + Survey (FNDDS) ≈ 13k foods, ~12 MB download
#   ./scripts/download-usda.sh --branded  # also Branded foods (~450k packaged foods w/ barcodes, ~400 MB download)
# Newer releases appear at https://fdc.nal.usda.gov/download-datasets — update the file names below when they do.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data/usda"
BASE="https://fdc.nal.usda.gov/fdc-datasets"
FILES=(
  "FoodData_Central_foundation_food_csv_2026-04-30.zip"
  "FoodData_Central_sr_legacy_food_csv_2018-04.zip"
  "FoodData_Central_survey_food_csv_2024-10-31.zip"
)
if [[ "${1:-}" == "--branded" ]]; then FILES+=("FoodData_Central_branded_food_csv_2026-10-29.zip"); fi

mkdir -p "$DATA"
FOLDERS=()
for f in "${FILES[@]}"; do
  if [[ ! -f "$DATA/$f" ]]; then
    echo "Downloading $f"
    curl -fSL -o "$DATA/$f" "$BASE/$f"
  fi
  dir="$DATA/${f%.zip}"
  [[ -d "$dir" ]] || unzip -q -o "$DATA/$f" -d "$dir"
  # Zips contain one top-level folder holding food.csv.
  FOLDERS+=("$(dirname "$(find "$dir" -name food.csv | head -1)")")
done

echo "Importing into the database (safe to re-run; already-imported foods are skipped)…"
cd "$ROOT/backend/src/NutriPlan.Api"
dotnet run -- import-usda "${FOLDERS[@]}"
