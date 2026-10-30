# UPLC Functional Tests Scenario

This scenario checks UPLC semantics and execution accounting separately across
the complete vector set, including regression vectors. All vectors are
presented as one scenario set and grouped by their source folders. Vectors
without an applicable budget outcome are retained for evaluation reporting but
excluded from the budget total.

## Setup

1. Download and unpack the [test corpus](https://pub-2239d82d9a074482b2eb2c886191cb4e.r2.dev/uplc-conformance.tar.zst).

2. Run every vector with its declared Plutus language version and protocol
   version. The protocol version is given by the top-level folder; plutus
   versions are captured by the folders at the second level. Respective cost
   models used for the test hardness are provided under `cost-models/`.

2. Evaluate the given program using a maximum budget of 10B CPU units and 14M
   MEM units. Report either:

   - The CEK result, as textual UPLC, and the measured budget.
   - One of "evaluation failure", "out of budget" or "parse/decode error" on
     error (matching one of those cases); and `null` as budget.

3. Record the results in a single JSON report matching
   [`schema.json`](schema.json). The report is limited to the observed outcome.
   The deliberation of whether each test is a success is done by the platform
   at build-time.
