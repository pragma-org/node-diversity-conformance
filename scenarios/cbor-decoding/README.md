# CBOR Decoding Scenario

This scenario checks whether independent implementations agree on the binary
boundary defined by the CDDL corpus. It is functional: the result is a set of
accept/reject and round-trip expectations, not a performance score.

## Setup

1. Obtain the versioned CBOR corpus and its expected normalization rules.
2. For every generated rule sample, decode it with the node's production CBOR
   decoder and, for valid samples, encode the decoded value again.
3. Compare the re-encoded bytes with the corpus reference. Invalid and zapped
   samples must be rejected.
4. Emit one JSON report matching [`schema.json`](schema.json), including the
   corpus id, protocol version, per-rule counts, and failure details.

The corpus is part of the setup and must be identified in every report. Two
reports using different corpus versions are not directly comparable.

## Expectations

The report has one outcome per CDDL rule and expectation class: generated
valid round-trips, generated invalid samples, and mutations. A node fully
meets this scenario only when all expected outcomes match.
