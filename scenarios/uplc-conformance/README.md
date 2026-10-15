# UPLC Conformance Scenario

This scenario checks UPLC semantics and execution accounting separately across
the complete vector set, including regression vectors. All vectors are
presented as one scenario set and grouped by their source folders. Vectors
without an applicable budget outcome are retained for evaluation reporting but
excluded from the budget total.

## Setup

1. Run every vector with its declared Plutus language version and protocol
   version.
2. Evaluate the program with the budget model selected for that version.
3. Compare the resulting term or expected failure independently from the
   consumed CPU and memory budget.
4. Record the budget-model identifier and version in the report metadata.
   Budget results from different models must not be compared as if they were
   the same scenario.
5. Emit one JSON report matching [`schema.json`](schema.json).

## Expectations

Each vector has two functional dimensions: `evaluation` and `budget`. A vector
is fully conformant when both applicable dimensions pass, but a report must
preserve partial results when only one dimension has an outcome. The report
names the source-folder group and records the exact budget models used at the
top of the report. The current default model is `v3-pv11-default`; vectors for
other language or protocol versions may use their corresponding model. Model
details are not repeated in result rows.
