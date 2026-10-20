# Changelog

## Changes Since `8038e7d`

This file describes the report contract changes between `8038e7d` and the
current `HEAD` (`8974561`). It is written for an implementation that already
produces the older CBOR-decoding report.

### Spec Changes

- Rename the top-level `schema_version` field to `version`.
- Keep the value at the string `"1"`.
- Keep the top-level `scenario` value as `"cbor-decoding"`.
- The existing `corpus`, `protocol_version`, `totals`, and `rules` fields
  remain part of the report contract. There is no new per-sample result format
  in this change.

The current schema is authoritative: [`schema.json`](schema.json).

### Migration

1. Change the producer key from `schema_version` to `version`.
2. Leave the totals and rule outcome structure unchanged.
3. Validate the resulting report against [`schema.json`](schema.json).
4. Publish the report at the URL configured for `cbor-decoding` in the node's
   metadata. The site builder accepts plain JSON and `.gzip`, `.gz`, or `.zst`
   reports; compressed reports are decompressed before validation.

For local preview data, place the report at
`preview/<node-id>.json` or `preview/<node-id>.json.<compression>` and run:

```sh
python3 scripts/build.py --preview
```

The scenario-local builder is now
[`build.py`](build.py). It owns the score calculation; do not duplicate that
calculation in a node producer.

### Compatibility Note

The shared site builder temporarily upgrades a versionless legacy CBOR report
when it still contains `corpus`, `totals`, and `rules`. New producers should
not rely on this compatibility path: emit `version: "1"` explicitly.
