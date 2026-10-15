#!/usr/bin/env python3
"""Assemble the static scenario site from reports published by node projects.

This repository deliberately does not run any node tests.  Each node has a
small, versioned directory containing its metadata, presentation, logo, and
stable report locations. Each scenario has its own report setup and is
assembled into an independent directory under ``_site/scenarios``.
"""

import argparse
import fnmatch
import gzip
import html
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
TIMEOUT_SECONDS = 60
TURBO_DEVIATION_LIMIT = 1.5
TURBO_ORDERS = ("cpu", "memory", "cpu-deviation", "memory-deviation")
COMPRESSION_SUFFIXES = (".zst", ".gzip", ".gz")


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def inline_markdown(value):
    """Render the small Markdown subset used by node descriptions."""
    value = html.escape(value, quote=False)
    value = re.sub(r"`([^`]+)`", r"<code>\1</code>", value)
    value = re.sub(
        r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
        r'<a href="\2" target="_blank" rel="noopener">\1</a>',
        value,
    )
    value = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", value)
    value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", value)
    return value


def markdown_to_html(path):
    """Render headings, paragraphs, lists, links, and emphasis from a README."""
    blocks = []
    paragraph = []
    items = []

    def flush_paragraph():
        nonlocal paragraph
        if paragraph:
            blocks.append(f"<p>{inline_markdown(' '.join(paragraph))}</p>")
            paragraph = []

    def flush_items():
        nonlocal items
        if items:
            blocks.append("<ul>" + "".join(f"<li>{inline_markdown(item)}</li>" for item in items) + "</ul>")
            items = []

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            flush_items()
        elif line.startswith("#"):
            flush_paragraph()
            flush_items()
            match = re.match(r"^(#{1,6})\s+(.+)$", line)
            if match:
                level, title = len(match.group(1)), match.group(2)
                blocks.append(f"<h{level}>{inline_markdown(title)}</h{level}>")
        elif re.match(r"^[-*]\s+", line):
            flush_paragraph()
            items.append(re.sub(r"^[-*]\s+", "", line))
        else:
            flush_items()
            paragraph.append(line)

    flush_paragraph()
    flush_items()
    return "".join(blocks)


def load_nodes():
    nodes = []
    for directory in sorted((ROOT / "nodes").iterdir()):
        if not directory.is_dir():
            continue
        metadata_path = directory / "metadata.json"
        readme_path = directory / "README.md"
        logos = sorted(
            path
            for path in directory.iterdir()
            if path.suffix.lower() in {".svg", ".png", ".webp"} and path.stem == "logo"
        )
        if not metadata_path.is_file() or not readme_path.is_file() or len(logos) != 1:
            raise ValueError(f"{directory}: expected metadata.json, README.md, and exactly one logo.svg/png/webp")
        metadata = json.loads(metadata_path.read_text())
        if metadata.get("id") != directory.name:
            raise ValueError(f"{metadata_path}: id must match the directory name")
        for key in ("id", "name", "language"):
            if not metadata.get(key):
                raise ValueError(f"{metadata_path}: missing required field {key!r}")
        metadata.update({
            "description_html": markdown_to_html(readme_path),
            "logo_path": f"nodes/{directory.name}/{logos[0].name}",
            "logo_source": logos[0],
        })
        nodes.append(metadata)
    if not nodes:
        raise ValueError("nodes/: no node metadata found")
    return nodes


def compression_suffix(name):
    """Return the compression suffix carried by a URL or asset name."""
    name = name.lower()
    return next((suffix for suffix in COMPRESSION_SUFFIXES if name.endswith(suffix)), None)


def uncompressed_asset_name(name):
    suffix = compression_suffix(name)
    return name[: -len(suffix)] if suffix else name


def decompress_zstd(payload):
    try:
        from compression import zstd
    except ImportError:
        try:
            result = subprocess.run(
                ["zstd", "-d", "-c"],
                input=payload,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
        except FileNotFoundError as error:
            raise RuntimeError(".zst reports require Python 3.14+ or the zstd command") from error
        except subprocess.CalledProcessError as error:
            message = error.stderr.decode(errors="replace").strip()
            raise RuntimeError(f"unable to decompress .zst report: {message}") from error
        return result.stdout
    return zstd.decompress(payload)


def decompress_download(urls, payload):
    """Decompress a report using its filename while leaving JSON untouched."""
    suffix = next(
        (
            suffix
            for url in urls
            if url
            for suffix in (compression_suffix(urlsplit(url).path),)
            if suffix
        ),
        None,
    )
    if suffix == ".gzip" or suffix == ".gz":
        return gzip.decompress(payload)
    if suffix == ".zst":
        return decompress_zstd(payload)
    return payload


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "node-diversity-conformance"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        payload = response.read()
        return decompress_download((response.geturl(), url), payload)


def latest_release_asset(lookup):
    """Return the newest dated GitHub release asset matching a glob."""
    repository, pattern = lookup["github_releases"], lookup["asset"]
    releases = json.loads(download(f"https://api.github.com/repos/{repository}/releases?per_page=100"))
    dated = []
    for release in releases:
        for asset in release["assets"]:
            date = re.search(r"(?<!\d)\d{8}(?!\d)", asset["name"])
            matches = fnmatch.fnmatchcase(asset["name"], pattern) or fnmatch.fnmatchcase(
                uncompressed_asset_name(asset["name"]), pattern
            )
            if matches and date:
                dated.append((date.group(), asset["browser_download_url"]))
    if not dated:
        raise ValueError(f"no dated release file matching {pattern} in {repository}")
    return max(dated)[1]


def parse_report(payload, scenario):
    report = json.loads(payload)
    # CBOR reports predate the shared scenario envelope. Keep the existing
    # published reports visible while producers roll out schema version 1.
    if scenario["id"] == "cbor-decoding" and "schema_version" not in report:
        if "corpus" not in report or "totals" not in report or "rules" not in report:
            raise ValueError("legacy CBOR report is missing corpus, totals or rules")
        report.update({
            "schema_version": "1",
            "scenario": "cbor-decoding",
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
    if report.get("schema_version") != "1":
        raise ValueError("report must declare schema_version=1")
    if report.get("scenario") != scenario["id"]:
        raise ValueError(f"report belongs to {report.get('scenario')!r}, expected {scenario['id']!r}")
    return report


def report_url(source):
    return source if isinstance(source, str) else latest_release_asset(source)


def fetch_node(node, scenario, use_preview):
    entry = {
        "id": node["id"],
        "name": node["name"],
        "language": node.get("language"),
        "repository": node.get("repository"),
        "color": node.get("color"),
        "report_url": None,
        "report": None,
        "error": None,
    }
    source = node.get("reports", {}).get(scenario["id"])
    preview = ROOT / "scenarios" / scenario["id"] / "preview" / f"{node['id']}.json"
    if source is None and not (use_preview and preview.is_file()):
        entry["error"] = "no report"
        return entry
    try:
        if use_preview and preview.is_file():
            entry["report_url"] = f"../../scenarios/{scenario['id']}/preview/{node['id']}.json"
            payload = preview.read_bytes()
        else:
            entry["report_url"] = report_url(source)
            payload = download(entry["report_url"])
        entry["report"] = parse_report(payload, scenario)
        print(f"ok     {scenario['id']}: {node['name']}")
    except Exception as error:
        entry["error"] = str(error)
        print(f"failed {scenario['id']}: {node['name']}: {error}", file=sys.stderr)
    return entry


def copy_static_site():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    shutil.copy(ROOT / "shared" / "index.html", OUT / "index.html")
    shutil.copytree(ROOT / "shared" / "css", OUT / "css")
    shutil.copytree(ROOT / "shared" / "js", OUT / "js")
    shutil.copytree(ROOT / "shared" / "icons", OUT / "icons")
    shutil.copytree(ROOT / "scenarios", OUT / "scenarios", ignore=shutil.ignore_patterns("preview"))


def copy_node_assets(nodes):
    for node in nodes:
        target = OUT / "nodes" / node["id"]
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy(node["logo_source"], target / node["logo_source"].name)


def load_ledger_definitions():
    definitions = []
    root = ROOT / "scenarios" / "ledger-rules" / "fixtures" / "scenarios"
    for path in sorted(root.glob("*.json")):
        document = json.loads(path.read_text())
        match = re.match(r"^(\d{5})-", path.stem)
        if match is None:
            raise ValueError(f"{path}: scenario filename must start with a five-digit id")
        if "description" not in document or "category" not in document:
            raise ValueError(f"{path}: scenario must define description before category")
        definitions.append({
            "id": match.group(1),
            "title": document["title"],
            "description": document["description"],
            "category": document["category"],
        })
    if not definitions:
        raise ValueError(f"{root}: no ledger scenario definitions found")
    return definitions


def report_score(report, scenario_id=None, definitions=None):
    """Return the comparable passed/total score represented by one report."""
    if not report:
        return 0, 0
    if scenario_id == "ledger-rules":
        definition_ids = {definition["id"] for definition in definitions or []}
        results = {
            str(item.get("id", ""))[:5]: item.get("result")
            for item in report.get("scenarios", [])
            if str(item.get("id", ""))[:5] in definition_ids
        }
        return sum(results.get(identifier) == "pass" for identifier in definition_ids), len(definition_ids)
    if report.get("scenarios"):
        totals = report.get("totals", {})
        return int(totals.get("passed", 0)), int(totals.get("total", 0))
    if report.get("rules"):
        totals = report.get("totals", {})
        expected = sum(value for key, value in totals.items() if key.endswith("_expected"))
        actual = sum(value for key, value in totals.items() if key.endswith("_actual"))
        return actual, expected
    if report.get("benchmarks"):
        benchmarks = report["benchmarks"]
        passed = 0
        for item in benchmarks:
            ratios = []
            cpu_max = item.get("cpu_max_ns")
            cpu_budget = item.get("budget_cpu")
            if isinstance(cpu_max, (int, float)) and isinstance(cpu_budget, (int, float)) and cpu_budget > 0:
                ratios.append(cpu_max / (cpu_budget / 1_000))
            memory_max = item.get("mem_max_bytes")
            memory_budget = item.get("budget_mem")
            if isinstance(memory_max, (int, float)) and isinstance(memory_budget, (int, float)) and memory_budget > 0:
                ratios.append(memory_max / memory_budget)
            if ratios and all(value <= TURBO_DEVIATION_LIMIT for value in ratios):
                passed += 1
        return passed, len(benchmarks)
    return 0, 0


def turbo_benchmarks(report):
    return [
        item
        for item in (report or {}).get("benchmarks", [])
        if isinstance(item, dict) and isinstance(item.get("bench"), str)
    ]


def turbo_value(item, dimension, statistic):
    prefix = "mem" if dimension == "memory" else "cpu"
    unit = "bytes" if dimension == "memory" else "ns"
    value = item.get(f"{prefix}_{statistic}_{unit}")
    return value if isinstance(value, (int, float)) else None


def turbo_ratio(item, dimension, statistic):
    value = turbo_value(item, dimension, statistic)
    budget = item.get("budget_mem" if dimension == "memory" else "budget_cpu")
    if not isinstance(value, (int, float)) or not isinstance(budget, (int, float)) or budget <= 0:
        return None
    return value / budget if dimension == "memory" else value / (budget / 1_000)


def turbo_dimension_summary(items, dimension):
    means = [
        (turbo_value(item, dimension, "mean"), turbo_ratio(item, dimension, "mean"))
        for item in items
    ]
    maxima = [
        (turbo_value(item, dimension, "max"), turbo_ratio(item, dimension, "max"))
        for item in items
    ]
    values = [value for value, _ in means if value is not None]
    mean_ratios = [ratio for _, ratio in means if ratio is not None]
    max_values = [value for value, _ in maxima if value is not None]
    max_ratios = [ratio for _, ratio in maxima if ratio is not None]
    return {
        "mean": sum(values) / len(values) if values else None,
        "mean_ratio": sum(mean_ratios) / len(mean_ratios) if mean_ratios else None,
        "max": max(max_values) if max_values else None,
        "max_ratio": max(max_ratios) if max_ratios else None,
        "available": bool(values),
    }


def turbo_summary(report):
    items = turbo_benchmarks(report)
    passed = 0
    for item in items:
        ratios = [
            turbo_ratio(item, dimension, "max")
            for dimension in ("cpu", "memory")
        ]
        ratios = [value for value in ratios if value is not None]
        if ratios and all(value <= TURBO_DEVIATION_LIMIT for value in ratios):
            passed += 1
    return {
        "passed": passed,
        "total": len(items),
        "cpu": turbo_dimension_summary(items, "cpu"),
        "memory": turbo_dimension_summary(items, "memory"),
    }


def build_turbo_views(entries):
    reports = {
        entry["id"]: turbo_benchmarks(entry["report"])
        for entry in entries
        if entry["report"] is not None
    }
    indexes = {
        node_id: {item["bench"]: item for item in items}
        for node_id, items in reports.items()
    }
    summaries = {
        entry["id"]: turbo_summary(entry["report"])
        for entry in entries
        if entry["report"] is not None
    }
    views = {}
    for source_id, items in reports.items():
        source_views = {}
        for order in TURBO_ORDERS:
            dimension = "memory" if order in ("memory", "memory-deviation") else "cpu"
            statistic = "max"
            def order_value(item):
                value = turbo_ratio(item, dimension, statistic) if order.endswith("deviation") else turbo_value(item, dimension, statistic)
                return (value is None, -(value or 0))

            selected = sorted(
                items,
                key=lambda item: (*order_value(item), item["bench"]),
            )[:10]
            source_views[order] = [
                {
                    "bench": item["bench"],
                    "nodes": {
                        node_id: {
                            "cpu_max_ns": node_item.get("cpu_max_ns"),
                            "cpu_ratio": turbo_ratio(node_item, "cpu", "max"),
                            "mem_max_bytes": node_item.get("mem_max_bytes"),
                            "mem_ratio": turbo_ratio(node_item, "memory", "max"),
                        }
                        for node_id, index in indexes.items()
                        for node_item in [index.get(item["bench"])]
                        if node_item is not None
                    },
                }
                for item in selected
            ]
        views[source_id] = source_views
    return summaries, views


def build_node_catalog(nodes, scenarios, scenario_entries, built_at):
    definitions = load_ledger_definitions()
    denominators = {}
    for scenario in scenarios:
        scenario_id = scenario["id"]
        denominators[scenario_id] = max(
            (
                report_score(entry["report"], scenario_id, definitions)[1]
                for entry in scenario_entries[scenario_id]
                if entry["report"]
            ),
            default=0,
        )
        if scenario_id == "ledger-rules":
            denominators[scenario_id] = len(definitions)

    cards = []
    for node in nodes:
        entries = {
            scenario_id: next(entry for entry in scenario_entries[scenario_id] if entry["id"] == node["id"])
            for scenario_id in denominators
        }
        scenario_scores = []
        weighted_ratio = 0.0
        for scenario in scenarios:
            scenario_id = scenario["id"]
            report = entries[scenario_id]["report"]
            passed, total = report_score(report, scenario_id, definitions)
            denominator = denominators[scenario_id]
            ratio = passed / denominator if denominator else 0
            weighted_ratio += ratio / len(scenarios)
            scenario_scores.append({
                "id": scenario_id,
                "title": scenario["title"],
                "percentage": round(ratio * 100, 2) if report else None,
                "passed": passed,
                "total": total,
                "configured": report is not None,
            })
        cards.append({
            "id": node["id"],
            "name": node["name"],
            "language": node["language"],
            "repository": node.get("repository"),
            "website": node.get("website"),
            "color": node.get("color"),
            "logo": node["logo_path"],
            "description": node["description_html"],
            "conformance": {
                "percentage": round(weighted_ratio * 100, 2),
            },
            "scenario_scores": scenario_scores,
            "built_at": built_at,
            "_ratio": weighted_ratio,
        })
    cards.sort(key=lambda node: (-node["_ratio"], node["name"]))
    for node in cards:
        node.pop("_ratio")
    return cards


def build_scenario(scenario, nodes, built_at, use_preview):
    reports_dir = OUT / "reports" / scenario["id"]
    reports_dir.mkdir(parents=True, exist_ok=True)
    entries = [fetch_node(node, scenario, use_preview) for node in nodes]
    for entry in entries:
        if entry["report"] is not None:
            report_path = reports_dir / f"{slug(entry['name'])}.json"
            report_path.write_text(json.dumps(entry["report"], indent=2) + "\n")
            entry["report_file"] = f"../../reports/{scenario['id']}/{slug(entry['name'])}.json"
            if use_preview and entry["report_url"].startswith("../../scenarios/"):
                entry["report_url"] = entry["report_file"]

    data = {
        "built_at": built_at,
        "scenario": scenario,
        "nodes": entries,
    }
    if scenario["id"] == "ledger-rules":
        data["definitions"] = load_ledger_definitions()
    elif scenario["id"] == "uplc-turbo":
        summaries, views = build_turbo_views(entries)
        data["turbo_summary"] = summaries
        data["turbo_views"] = views
        data["nodes"] = [
            {
                **entry,
                "report": {"setup": entry["report"].get("setup")}
                if entry["report"] is not None
                else None,
            }
            for entry in entries
        ]
    output_dir = OUT / "scenarios" / scenario["id"]
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "data.json").write_text(json.dumps(data, indent=2) + "\n")
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Prefer reports in scenarios/<id>/preview/ when building locally; CI does not enable this flag.",
    )
    args = parser.parse_args()

    nodes = load_nodes()
    scenarios = []
    for metadata_path in sorted((ROOT / "scenarios").glob("*/scenario.json")):
        scenario = json.loads(metadata_path.read_text())
        scenario.setdefault("schema", f"scenarios/{metadata_path.parent.name}/schema.json")
        scenarios.append(scenario)
    if len({scenario["id"] for scenario in scenarios}) != len(scenarios):
        sys.exit("scenario ids must be unique")
    if len({node["id"] for node in nodes}) != len(nodes):
        sys.exit("node metadata ids must be unique")

    copy_static_site()
    copy_node_assets(nodes)
    built_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    catalog = []
    scenario_entries = {}
    for scenario in scenarios:
        entries = build_scenario(scenario, nodes, built_at, args.preview)
        scenario_entries[scenario["id"]] = entries
        implementations = [
            {
                "id": entry["id"],
                "name": entry["name"],
                "color": entry.get("color"),
            }
            for entry in entries
            if entry["report"] is not None
        ]
        catalog.append({
            **scenario,
            "path": f"scenarios/{scenario['id']}/",
            "implementations": implementations,
            "available_reports": sum(entry["report"] is not None for entry in entries),
        })

    node_catalog = build_node_catalog(nodes, scenarios, scenario_entries, built_at)
    (OUT / "catalog.json").write_text(
        json.dumps({"built_at": built_at, "scenarios": catalog, "nodes": node_catalog}, indent=2) + "\n"
    )
    print(f"built  {OUT.relative_to(ROOT)}/ with {len(scenarios)} scenarios")


if __name__ == "__main__":
    main()
