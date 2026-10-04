# Architecture Draft

## Goals

- automate symbol-to-asset classification
- maintain target asset allocation percentages
- provide clear rebalance suggestions

## Baseline Components

1. Ingestion: import holdings and market values
2. Classification: map symbols to asset classes using rules
3. Allocation engine: compute current vs target weights
4. Rebalance engine: suggest buy/sell deltas
5. UI/API: provide visibility and workflow controls

We will refine each component with your requirements in upcoming steps.

## Added Feature Tracks

1. Authentication and sync
   - login/session token layer
   - provider connection metadata (Notion first)
   - periodic/manual sync entrypoints

2. Market price feed
   - symbol quote adapter with provider abstraction
   - current mock feed for harness and local development
   - later replace with real provider (broker/open API)

3. Asset import UX
   - CSV import as primary path
   - image upload + OCR recognition as fallback path
   - normalized holding schema shared across ingestion paths
