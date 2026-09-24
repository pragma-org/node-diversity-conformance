# node-diversity-conformance

A static site comparing the CBOR decoding conformance reports of Cardano node implementations.

Reports follow the [cardano-cbor-dataset report format](https://github.com/etorreborre/cardano-cbor-dataset#report-output-format).
The page shows a ranking, per-category scores, a per-rule table and the failures of every node.

## Adding a node implementation

Add an entry to `nodes.json`:

```json
{
  "name": "My node",
  "language": "Rust",
  "repository": "https://github.com/me/my-node",
  "report": "https://example.org/my-node/latest.json"
}
```

`color` is optional; nodes without one get a color from a default palette.

`report` must be a public, stable URL that always serves the node's latest report as JSON.

When a node publishes its report as a GitHub release file with a versioned name, `report` can instead look up the
newest one. The build picks the matching file with the latest `YYYYMMDD` date in its name:

```json
"report": {
  "github_releases": "pragma-org/amaru",
  "asset": "amaru-*-cbor-conformance.json"
}
```

## Building

No reports are stored in this repository. They are downloaded when the site is built:

```
python3 scripts/build.py
python3 -m http.server -d _site
```

The build needs Python 3 only. It writes the site to `_site/`. A report that cannot be downloaded does not fail the
build; the page shows the node with the error instead.

The `Publish site` workflow builds and deploys the site to GitHub Pages on every push to `main` and once a day.
