# Changelog

## Changes Since `8038e7d`

This file describes the UPLC-turbo migration between `8038e7d` and the
current `HEAD` (`8974561`). The corpus and report were reduced to the current
CPU/memory benchmark contract; flat decoding is no longer part of this
scenario.

### Corpus And Spec Changes

- The published corpus is now the pinned set of 3,997 recognized benchmark
  ids. The complete id list is enumerated by the `bench` enum in
  [`schema.json`](schema.json).
- Rename the top-level `schema_version` field to `version` and keep the value
  at `"1"`.
- Remove `partial`, `flat_us`, and `size_bytes` from benchmark reports.
- Keep `scenario: "uplc-turbo"`, `implementation`, and `benchmarks`.
- Each benchmark must contain:

  ```json
  {
    "bench": "...recognized corpus id...",
    "plutus_version": "V2",
    "protocol_version": "10.0",
    "budget_cpu": 123456,
    "budget_mem": 789,
    "cpu_us": 42.5,
    "mem_bytes": 4096
  }
  ```

- `machine` is optional and may describe the OS, OS version, architecture,
  CPU, logical-core count, and physical memory. It is metadata for interpreting
  measurements, not a conformance dimension.
- `plutus_version`, `protocol_version`, and the budgets are per benchmark.
  Do not provide a single global protocol version for the report.

The schema is authoritative and rejects unknown benchmark ids. The current
scenario description and methodology are in [`README.md`](README.md).

### Benchmark Migration

1. Use the pinned corpus and run only its recognized benchmark ids.
2. Derive the protocol version from the corpus epoch and select the matching
   Plutus semantics and cost model.
3. Prepare and flat-decode the program before the timed evaluation. Flat
   decoding is deliberately outside this scenario and will be measured by a
   separate scenario.
4. Measure pure CEK evaluation and memory separately from preparation. Emit
   `cpu_us` and `mem_bytes`; do not emit flat-decoding or script-size fields.
5. Count the evaluation budget and emit `budget_cpu` and `budget_mem`.
6. Emit `version: "1"`, validate against [`schema.json`](schema.json), and
   publish the report from the node metadata configuration.

For local preview data, use
`preview/<node-id>.json` or `preview/<node-id>.json.<compression>` and run
`python3 scripts/build.py --preview`. Plain JSON, `.gzip`, `.gz`, and `.zst`
reports are supported.

### Platform Behavior

The scenario-local [`build.py`](build.py) is the scoring and materialization
layer. It filters unknown report items, treats missing recognized benchmarks
as failures, computes static summary and worst-case views, and records budget
disagreements between implementations. Downstream consumers should use the
generated `data.json` views instead of repeating these calculations in the
browser.

The current acceptance rules are:

- CPU and memory deltas are `(measured - budget) / budget` and must be at most
  `1.0` after tolerance handling.
- CPU deltas within `200 us` of the budget and memory deltas within `320 KiB`
  of the budget are suppressed and excluded from delta summaries and rankings.
- A missing dimension is unavailable; a missing benchmark fails the benchmark.
- Budget disagreements are treated as failures for outlier nodes. If no clear
  majority exists, the Cardano node value is used as the fallback reference.
