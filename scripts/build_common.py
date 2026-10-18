"""Shared input, download, and site assembly helpers for scenario builders."""

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
    return re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", value)


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
    if suffix in (".gzip", ".gz"):
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
    if scenario["id"] == "cbor-decoding" and "version" not in report:
        if "corpus" not in report or "totals" not in report or "rules" not in report:
            raise ValueError("legacy CBOR report is missing corpus, totals or rules")
        report.update({
            "version": "1",
            "scenario": "cbor-decoding",
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
    if report.get("version") != "1":
        raise ValueError("incompatible report: must declare version=1")
    if report.get("scenario") != scenario["id"]:
        raise ValueError(f"report belongs to {report.get('scenario')!r}, expected {scenario['id']!r}")
    return report


def report_url(source):
    return source if isinstance(source, str) else latest_release_asset(source)


def preview_report_path(scenario_id, node_id):
    directory = ROOT / "scenarios" / scenario_id / "preview"
    for suffix in ("", *COMPRESSION_SUFFIXES):
        path = directory / f"{node_id}.json{suffix}"
        if path.is_file():
            return path
    return None


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
    preview = preview_report_path(scenario["id"], node["id"])
    if source is None and not (use_preview and preview is not None):
        entry["error"] = "no report"
        return entry
    try:
        if use_preview and preview is not None:
            entry["report_url"] = f"../../scenarios/{scenario['id']}/preview/{preview.name}"
            payload = decompress_download((preview.name,), preview.read_bytes())
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


def load_scenarios():
    scenarios = []
    for metadata_path in sorted((ROOT / "scenarios").glob("*/scenario.json")):
        scenario = json.loads(metadata_path.read_text())
        scenario.setdefault("schema", f"scenarios/{metadata_path.parent.name}/schema.json")
        scenarios.append(scenario)
    if len({scenario["id"] for scenario in scenarios}) != len(scenarios):
        raise ValueError("scenario ids must be unique")
    return scenarios


def build_scenario(scenario, nodes, built_at, use_preview, prepare):
    reports_dir = OUT / "reports" / scenario["id"]
    reports_dir.mkdir(parents=True, exist_ok=True)
    entries = [fetch_node(node, scenario, use_preview) for node in nodes]

    extra, output_entries, context = prepare(scenario, entries)
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
        "nodes": output_entries,
        **extra,
    }
    output_dir = OUT / "scenarios" / scenario["id"]
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "data.json").write_text(json.dumps(data, indent=2) + "\n")
    return entries, context
