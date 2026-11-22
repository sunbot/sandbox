# One image = API + web app + USDA food data. Build from the nutriplan/ folder:
#   docker build -t nutriplan .
#   docker run -p 8080:8080 -e DATABASE_URL=postgres://... -e Auth__FirebaseProjectId=your-project nutriplan
# Sign-in (docs/AUTH.md): the web app needs the Firebase web config at build time; Render passes service environment
# variables to the Docker build as build args.
# On first start with an empty database it imports ~13.6k USDA foods in the background (~30 s).

# ── 1. Web build of the Expo app ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS web
WORKDIR /src/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY mobile/ ./
# Public Firebase web-app identifiers (not secrets). Without them the web app shows "Sign-in isn't set up".
ARG EXPO_PUBLIC_FIREBASE_API_KEY=""
ARG EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=""
ARG EXPO_PUBLIC_FIREBASE_PROJECT_ID=""
ARG EXPO_PUBLIC_FIREBASE_APP_ID=""
ENV EXPO_PUBLIC_FIREBASE_API_KEY=$EXPO_PUBLIC_FIREBASE_API_KEY \
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=$EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN \
    EXPO_PUBLIC_FIREBASE_PROJECT_ID=$EXPO_PUBLIC_FIREBASE_PROJECT_ID \
    EXPO_PUBLIC_FIREBASE_APP_ID=$EXPO_PUBLIC_FIREBASE_APP_ID
RUN npx expo export --platform web

# ── 2. API ───────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY backend/ ./backend/
RUN dotnet publish backend/src/NutriPlan.Api -c Release -o /app

# ── 3. USDA FoodData Central (public domain) ────────────────────────────────
FROM debian:bookworm-slim AS usda
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /data
ARG USDA_BASE=https://fdc.nal.usda.gov/fdc-datasets
ARG USDA_FILES="FoodData_Central_foundation_food_csv_2026-04-30 FoodData_Central_sr_legacy_food_csv_2018-04 FoodData_Central_survey_food_csv_2024-10-31"
RUN for f in $USDA_FILES; do \
      curl -fsSL -o "$f.zip" "$USDA_BASE/$f.zip" && unzip -q "$f.zip" -d "$f" && rm "$f.zip"; \
    done

# ── 4. Runtime ───────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /src/mobile/dist ./wwwroot
COPY --from=usda /data /data/usda
ENV ASPNETCORE_ENVIRONMENT=Production \
    Usda__SeedFolder=/data/usda \
    PORT=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "NutriPlan.Api.dll"]
