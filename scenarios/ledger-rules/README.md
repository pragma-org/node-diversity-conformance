# Ledger Transaction Rules Scenario

This scenario compares ledger phase-one validation against a versioned set of
raw transaction fixtures. Each fixture supplies its own era history, protocol
parameters, network, initial state, ledger point, transaction bytes, and
expected outcome.

## Setup

1. Select the fixture set version from this directory's `fixtures/` tree.
2. Load the shared documents referenced by the fixture and construct the
   declared initial ledger state.
3. Apply the raw transaction bytes without re-encoding them first.
4. Mark a `pass` fixture successful only when validation accepts it. Mark a
   `fail` fixture successful only when validation rejects it with the expected
   predicate.
5. Preserve the category declared by the fixture definition. Categories are
   stable presentation metadata, not inferred from test names; use the
   vocabulary in [`schema.json`](schema.json).
6. Emit one JSON result per executed fixture matching [`schema.json`](schema.json).
   Each result contains only the five-digit fixture id and either `pass` or the
   observed predicate failure. The report must not duplicate fixture metadata;
   the versioned definitions in this directory are the source of truth. Missing
   results count as failures, while unrecognized result ids are ignored.

The fixture files are versioned in this repository so they can be downloaded
and referenced independently of a node implementation. Update the scenario
version when the fixture set changes.
