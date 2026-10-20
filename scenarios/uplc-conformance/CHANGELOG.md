# Changelog

## Changes Since `8038e7d`

This file describes the UPLC-conformance migration between `8038e7d` and the
current `HEAD` (`8974561`). The report is now an observation-only format; the
platform compares it with versioned expectations.

### Corpus And Definitions

- The standard and extra/regression vectors are one conformance corpus. Do not
  publish separate `standard` and `extra` reports.
- [`expectations.json`](expectations.json) is the authoritative list of
  scenarios and expected evaluation outcomes.
- The corpus is organized by protocol version, then Plutus version (`v1`,
  `v2`, `v3`, or `all`). The folder structure supplies the execution context;
  do not reconstruct it from the scenario id.
- The versioned cost-model files in the corpus are authoritative inputs for
  the test runner. A report does not need to repeat cost-model definitions or
  cost-model ids.

### Spec Changes

- Rename the top-level `schema_version` field to `version` and keep the value
  at `"1"`.
- Remove top-level `corpus`, `protocol_version`, `cost_models`, and `totals`.
- Keep `scenario: "uplc-conformance"` and `implementation.name`.
- Emit one item per expectation with these fields:

  ```json
  {
    "id": "builtin_constant_array_emptyarray_v3",
    "title": "emptyArray",
    "group": "builtin/constant/array",
    "plutus_version": "V3",
    "protocol_version": "11.0",
    "evaluation": "(program 1.1.0 (con (array integer) []))",
    "budget": { "cpu": 16100, "mem": 200 }
  }
  ```

- `evaluation` contains the observed textual UPLC result or one of the
  accepted failure strings (`evaluation failure`, `out of budget`, or
  `parse/decode error`).
- `budget` contains the observed `{ "cpu", "mem" }` object, or `null` when no
  budget is produced or expected.
- Do not emit `expected`, `actual`, `passed`, `cost_model_id`, or cost-model
  objects. Those belong to the platform's comparison layer.
- `plutus_version` and `protocol_version` are per result and must match the
  expectation for that id. A mismatch is a conformance failure.

The current contract is defined by [`schema.json`](schema.json).

### Evaluation And Migration

1. Load every expectation from [`expectations.json`](expectations.json).
2. Locate its vector under the matching `protocol-version-*` and Plutus-version
   directory.
3. Run it with that Plutus version, protocol version, and the corresponding
   versioned cost model. Use the ledger-facing flat decoder and the normal
   evaluation budget.
4. Emit exactly one observation with the id and per-result version fields.
5. Emit `budget: null` for vectors without a budget expectation. Keep those
   vectors in the report: they count for evaluation conformance but are
   excluded from the budget denominator.
6. Validate the report against [`schema.json`](schema.json). The platform
   compares evaluation text after ignoring presentation whitespace around
   UPLC punctuation, while preserving quoted string contents.

For local preview data, use
`preview/<node-id>.json` or `preview/<node-id>.json.<compression>` and run
`python3 scripts/build.py --preview`. Reports may be plain JSON, `.gzip`,
`.gz`, or `.zst`.

### Platform Behavior

The scenario-local [`build.py`](build.py) matches results by id, Plutus
version, and protocol version. Missing results fail; unrecognized results are
ignored. It computes evaluation and budget scores independently. The page
groups results by protocol version, Plutus version, and the nested `group`
path, and shows expected-versus-actual details for failures.
