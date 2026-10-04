# apps/api

Backend API placeholder.

Planned responsibilities:

- ingest holdings and transactions
- classify asset categories
- compute allocation drift
- generate rebalance plan

## Initial modules

- `src/modules/auth.ts`: demo login/session
- `src/modules/sync.ts`: provider connection + notion sync
- `src/modules/prices.ts`: quote feed adapter (mock)
- `src/modules/assets.ts`: CSV import + OCR queue placeholder

## Feature mapping to your requirements

1. Basic login and sync
   - `login(email, password)`
   - `connectProvider(userId, provider, config)`
   - `syncHoldingsFromNotion()`

2. Current stock price retrieval
   - `getQuotes(symbols)`

3. Asset import
   - direct CSV import: `importAssetsFromCsvText(csvText)`
   - screenshot fallback (placeholder): `queueImageRecognition(fileName)`
