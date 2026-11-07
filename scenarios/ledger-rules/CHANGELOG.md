# Changelog

## Changes Since `8038e7d`

This file describes the ledger-rules report and fixture changes between
`8038e7d` and the current `HEAD` (`8974561`). The important migration is from
a producer-owned summary to a raw-result report scored from the versioned
fixture definitions.

### Spec Changes

- Rename the top-level `schema_version` field to `version` and keep the value
  at `"1"`.
- Remove the top-level `corpus` and `totals` fields. Do not emit `passed`,
  `failed`, or `total`; the platform derives all counts from the fixture set.
- Keep `scenario: "ledger-rules"` and the `implementation.name` field.
- Each item in `scenarios` now contains only:

  ```json
  { "id": "00001", "result": "pass" }
  ```

- `id` is exactly the first five digits of the fixture filename.
- `result` is either `pass` or one of the predicate-failure values listed in
  [`schema.json`](schema.json), including `DecodingFailure` where applicable.
- Missing fixture ids are failures. Extra or unrecognized ids are ignored.

The fixture definitions under
[`fixtures/scenarios/`](fixtures/scenarios/) are now the source of truth for
titles, descriptions, categories, expected outcomes, and the denominator.
Do not copy that metadata into the report.

### Identifier Reconciliation

- Treat the first five digits of the Amaru fixture filename as the canonical
  scenario id. The website fixtures for `00284` through `00307` were reconciled
  with that numbering so report results from Amaru and the Haskell harness now
  resolve to the same definitions.
- Several older website fixtures had been assigned later ids and were also
  duplicated at their canonical ids. Downstream report producers should not
  renumber ids independently; copy the current fixture filenames and emit the
  id encoded by each filename.

### Fixture Additions

The fixture corpus now contains 368 scenarios. This additive update adds the
following previously unpublished fixture ids:

- `00291`, `00293`, and `00299` through `00304`
- `00308` through `00330`, plus `00332` through `00334`
- `00342` through `00382`

The additions cover Conway governance-field restrictions in Plutus contexts,
phase-two witness and datum failures, script-purpose validation, malformed and
unavailable reference scripts, invalid protocol-parameter updates, Byron
address restrictions, large-value arithmetic, and collateral/fee boundaries.
The fixture definitions now also carry the category used to group them in the
report.

Downstream runners do not need a report-format change: keep `version: "1"`,
enumerate the expanded fixture directory, and emit the same five-digit id and
observed result for every fixture. The report schema has only gained the
predicate names exercised by these fixtures.

### Migration

1. Enumerate the JSON files in `fixtures/scenarios/`.
2. Extract the five-digit id from each filename and run every fixture using
   its declared ledger context.
3. Emit one result item per fixture using only the stable id and observed
   result.
4. Map implementation-specific failures to the predicate names accepted by
   [`schema.json`](schema.json). Use `pass` for an accepted transaction.
5. Remove producer-side totals and corpus metadata.
6. Set `version` to `"1"`, validate the report, and publish it using the node
   metadata entry for `ledger-rules`.

For local preview data, use
`preview/<node-id>.json` or `preview/<node-id>.json.<compression>` and run
`python3 scripts/build.py --preview`. The site builder accepts plain JSON and
`.gzip`, `.gz`, or `.zst` reports.

### Platform Behavior

The scenario-local [`build.py`](build.py) loads the fixture definitions,
computes the expected result for each id, ignores unknown report items, and
counts missing items as failures. The page derives the category, title,
description, expected value, and expected-versus-actual failure details from
the fixture definitions. A producer should therefore treat the fixture files
and schema as authoritative and should not try to precompute the displayed
score.
