# Node Diversity Conformance

A platform comparing reports produced by independent Cardano node
implementations. The site is a presentation layer: it does not run a node,
benchmark or conformance suite. Each participating project publishes a small
JSON report from its own CI, and this repository downloads those reports when
the site is built.

Here is therefore a place to explore results pertaining to node's conformance,
as well as a home for documenting the various cross-compatible efforts going
on. At the moment, the following scenarios are available:

### Functional Tests

- [CBOR decoding conformance](./scenarios/cbor-decoding)
- [UPLC conformance, including implementation-specific regression vectors](./scenarios/uplc-conformance)
- [ledger transaction-rule scenarios](./scenarios/ledger-rules)

### Non-Functional Tests

- [UPLC turbo benchmarks](./scenarios/uplc-turbo)

---

Each scenario is a self-contained product under [`scenarios/`](scenarios): its
directory contains the metadata, README, schemas, page, and local preview
reports. Importantly, it contains the fixtures, test vectors and instructions
necessary to replay the scenario and produce a compatible report.

## Adding a node implementation

Participating nodes are listed under [`nodes/`](nodes). Each directory contains
structured metadata, a presentation README, and a logo. New scenario families
and node implementations can therefore evolve independently while sharing only
the site shell and generic comparison code in [`shared/`](shared).

To participate, add a directory under `nodes/` with `metadata.json`,
`README.md`, and exactly one `logo.{svg, png, webp}`. Put report sources under
`reports` in `metadata.json` for each scenario it implements:

```json
{
  "id": "my-node",
  "name": "My node",
  "language": "Rust",
  "repository": "https://github.com/me/my-node",
  "website": "https://example.org",
  "reports": {
    "ledger-rules": "https://example.org/my-node/ledger-rules.json"
  }
}
```

`repository`, `website`, and `color` are optional. The README is rendered as the node's homepage description.

### Reports

#### Direct link

Reports can be provided as a direct download URL, which must be public and
stable, and must serve the latest JSON document for that scenario. The report
may be compressed with `.gzip`, `.gz`, or `.zst`; the builder detects the
suffix and decompresses it before validating the JSON.

#### Github release

Alternatively, node can publish their report as GitHub release files with a
versioned name. The build picks the matching file with the latest `YYYYMMDD`
date in its name. Compression suffixes are optional in the asset glob, so the
same pattern matches both the JSON and its compressed form:

```json
"reports": {
  "cbor-decoding": {
    "github_releases": "pragma-org/amaru",
    "asset": "amaru-*-cbor-conformance.json"
  }
}
```

## Building

No reports are stored in this repository. They are downloaded when the site is built:

```
python3 scripts/build.py
python3 -m http.server -d _site
```

The build needs Python 3. For `.zst` reports, Python 3.14 or the `zstd`
command is also required. It writes the site to `_site/`. A report that cannot
be downloaded does not fail the build; the relevant scenario shows the node as
unavailable instead. The generated layout is:

```
_site/
  index.html                 # homepage
  nodes/<id>/                # copied node logos
  scenarios/<id>/            # one page and data.json per scenario
  reports/<id>/<node>.json   # downloaded source reports
  catalog.json               # homepage data
```

Before publishing a report, validate it against the schema named by its scenario. A report must contain
`schema_version: "1"` and the matching `scenario` identifier. The homepage gives every scenario the
same weight: a node receives one quarter of the overall score for each of the four scenarios. An
unavailable scenario contributes zero to the total and is shown as `-` on the node card.

> [!TIP]
> For local development, place reports under `scenarios/<scenario-id>/preview/<node-id>.json` and build with
> `python3 scripts/build.py --preview`. The preview directory is intentionally ignored by CI.
