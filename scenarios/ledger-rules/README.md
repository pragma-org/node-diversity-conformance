# Ledger Transaction Rules Scenario

This functional scenario compares phase-one ledger validation across node
implementations. Every implementation runs the same versioned transaction
fixtures against the same ledger context and reports the observed validation
outcome. The scenario is intentionally independent of any particular test
framework or node repository.

## Setup

The complete fixture corpus lives under
[`fixtures/`](fixtures/). The files in that directory are part of the scenario
version and must be treated as immutable test inputs during a run.

Each file in [`fixtures/scenarios/`](fixtures/scenarios/) describes one test
case identified by a unique id.

To implement this scenario:

1. Enumerate the JSON files in `fixtures/scenarios/` and use the first five
   digits of each filename as its id.

2. Resolve every referenced document from the fixture tree, including the era
   history, protocol parameters, credentials, initial UTxO and governance
   state.

3. Decode the transaction from the fixture's CBOR value and construct the
   validation context from the declared initial state.

4. Validate the transaction at the declared network, point, and protocol
   parameters.

5. Record the observed outcome as `"pass"` or `{ "expected":
   "SomePredicateFailure" }`, mapping your own ledger failures to one of the
   listed predicate in the JSON schema.

## Evaluation Method

The files in this repository are treated as ground-truth, and any observed
outcome is expected to match. A result is marked as failed when it doesn't.

Any missing result from the report is considered failed. Extra or unrecognized
ids are ignored.

The report must conform to [`schema.json`](./schema.json).
