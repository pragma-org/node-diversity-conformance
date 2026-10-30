# Changelog

## Version 2 Reports

The CBOR-decoding scenario now reads the report format of
[cardano-cbor-dataset](https://github.com/r2rationality/cardano-cbor-dataset#report-output-format). Version 1
reports stay valid: the site reads both versions.

### Spec Changes

- A version 2 report has one outcome per sample, in `results`. The value is `true`, or an error message of the form
  `<category>: <message>`.
- The report names the commit of the dataset (`dataset_commit`) and the commit of the node code
  (`implementation_commit`). These fields are required.
- The report has no `era` field. The site deduces the era from the protocol version: major versions 10 and 11 are
  Conway, and 12 and more are Dijkstra.
- The report has no `totals`, `rules`, `corpus`, or `scenario` field. The site computes the counts from `results`.
- The current schema is [`schema.json`](schema.json). The schema of version 1 is
  [`schema-v1.json`](schema-v1.json).

### How the Site Counts Samples

The category in the path of a sample (`<rule>/<category>/<file>`) gives its expectation class:

| Category                                  | Class            |
| ----------------------------------------- | ---------------- |
| `valid`, `manual-valid`                   | Valid round-trip |
| `invalid-zap-<n>`, `manual-invalid`       | Invalid rejected |

Whether a sample was mutated does not matter for conformance, so the site makes no difference between the
mutation levels. For a version 1 report, the site adds the mutation counts to the invalid counts.

The site stops with an error for any other category.

### Eras

A node can publish one report per era. In `metadata.json`, give a source for each era:

```json
"reports": {
  "cbor-decoding": {
    "conway": "https://example.org/my-node/cbor-conway.json",
    "dijkstra": "https://example.org/my-node/cbor-dijkstra.json"
  }
}
```

A single source stays valid. The site reads the era from the report. A version 1 report has no era, and the site
assigns it to `conway`. The page shows one era at a time, and the score on the homepage uses `conway`.

For local preview data, name the files `preview/<node-id>-<era>.json` when the metadata names eras.

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
