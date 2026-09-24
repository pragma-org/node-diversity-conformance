#!/usr/bin/env python3
"""Build the static site into _site/.

Reads nodes.json, downloads each node's latest conformance report and bundles
everything into _site/data.json, next to the page's static files.

A report that cannot be fetched or parsed does not fail the build: the node is
kept with an error message so the page can show that its report is missing.
"""

import json
import re
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
STATIC_FILES = ["index.html", "style.css", "app.js"]
TIMEOUT_SECONDS = 60


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "node-diversity-conformance"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read()


def parse_report(payload):
    report = json.loads(payload)
    missing = [k for k in ("corpus", "totals", "rules") if k not in report]
    if missing:
        raise ValueError(f"not a conformance report, missing: {', '.join(missing)}")
    return report


def fetch_node(node):
    entry = {
        "name": node["name"],
        "language": node.get("language"),
        "repository": node.get("repository"),
        "report_url": node["report"],
        "report": None,
        "error": None,
    }
    try:
        entry["report"] = parse_report(download(node["report"]))
        print(f"ok     {node['name']}")
    except Exception as error:
        entry["error"] = str(error)
        print(f"failed {node['name']}: {error}", file=sys.stderr)
    return entry


def main():
    config = json.loads((ROOT / "nodes.json").read_text())
    names = [node["name"] for node in config["nodes"]]
    if len(set(map(slug, names))) != len(names):
        sys.exit("nodes.json: node names must be unique")

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "reports").mkdir(parents=True)
    for name in STATIC_FILES:
        shutil.copy(ROOT / name, OUT / name)

    nodes = [fetch_node(node) for node in config["nodes"]]
    for node in nodes:
        if node["report"] is not None:
            node["report_file"] = f"reports/{slug(node['name'])}.json"
            (OUT / node["report_file"]).write_text(json.dumps(node["report"], indent=2))

    data = {"built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "nodes": nodes}
    (OUT / "data.json").write_text(json.dumps(data))
    print(f"built  {OUT.relative_to(ROOT)}/ with {sum(n['report'] is not None for n in nodes)}/{len(nodes)} reports")


if __name__ == "__main__":
    main()
