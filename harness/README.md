# harness

Harness engineering area for validating portfolio behavior against deterministic scenarios.

## Folder Intent

- `fixtures`: sample holdings, prices, and target allocation inputs
- `rules`: classification and policy rules
- `scenarios`: expected outputs for specific market/portfolio conditions

## Validation Flow

1. load fixtures
2. apply rules
3. run scenario checks
4. compare expected vs actual outputs

## Notion Import Flow

Import a local Notion CSV export by passing its path. The committed fixture uses sample amounts.

```bash
pnpm harness:import:notion --csv /path/to/export.csv
pnpm harness:validate:notion
```

Optional flags:

- `--csv <path>`: custom Notion CSV path
- `--out <path>`: custom output fixture path
