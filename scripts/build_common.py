"""Shared input, download, and site assembly helpers for scenario builders."""

import fnmatch
import gzip
import html
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
TIMEOUT_SECONDS = 60
# Downloads are kept here, so that a build still works when GitHub is unreachable or limits the requests.
# Reports stay out of version control: this directory is ignored.
CACHE = ROOT / ".cache"
# The list of releases of a repository changes rarely, and GitHub limits unauthenticated requests to 60 an hour.
LISTING_MAX_AGE_SECONDS = 3600
# A download that fails for a temporary reason is tried again after each of these pauses, in seconds.
RETRY_PAUSES = (2, 5, 15, 30, 60)
# 403 is here because GitHub answers it when it limits the requests. A missing file (404) is never tried again.
RETRY_STATUS = {403, 408, 429, 500, 502, 503, 504}
COMPRESSION_SUFFIXES = (".zst", ".gzip", ".gz")
DEFAULT_ERA = "conway"
# A report does not name its era: the protocol version tells it. Each entry gives the first major protocol version of an
# era, so protocol versions 10 and 11 are Conway and 12 and more are Dijkstra.
PROTOCOL_ERAS = ((10, "conway"), (12, "dijkstra"))
CBOR_KINDS = ("valid", "invalid")
# The classes of version 1 reports that make up each kind.
CBOR_V1_CLASSES = {
    "valid": ("generated_decoded_reencoded",),
    "invalid": ("generated_must_be_rejected", "zap_must_be_rejected"),
}
CBOR_REPORT_FIELDS = ("generated_at", "protocol_version", "dataset_commit", "implementation_commit", "results")


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


def cache_path(url):
    return CACHE / hashlib.sha256(url.encode()).hexdigest()


def is_temporary(error):
    if isinstance(error, urllib.error.HTTPError):
        return error.code in RETRY_STATUS
    return isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError))


def download_with_retries(url, headers):
    for attempt, pause in enumerate((*RETRY_PAUSES, None)):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return decompress_download((response.geturl(), url), response.read())
        except Exception as error:
            if pause is None or not is_temporary(error):
                raise
            print(f"retry  {url}: {error}; attempt {attempt + 2} in {pause}s", file=sys.stderr)
            time.sleep(pause)


def download(url):
    """Download a URL. A recent copy is used for the list of releases, and an old copy when the download fails."""
    cached = cache_path(url)
    is_listing = urlsplit(url).netloc == "api.github.com"
    if is_listing and cached.is_file() and time.time() - cached.stat().st_mtime < LISTING_MAX_AGE_SECONDS:
        return cached.read_bytes()
    headers = {"User-Agent": "node-diversity-conformance"}
    try:
        payload = download_with_retries(url, headers)
    except Exception as error:
        if not cached.is_file():
            raise
        print(f"warn   {url}: {error}; using the copy downloaded earlier", file=sys.stderr)
        return cached.read_bytes()
    CACHE.mkdir(exist_ok=True)
    cached.write_bytes(payload)
    return payload


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


def cbor_kind(category):
    """Return the expectation class of the samples in a corpus category."""
    if category in ("valid", "manual-valid"):
        return "valid"
    if category == "manual-invalid" or re.fullmatch(r"invalid-zap-[0-9]+", category):
        return "invalid"
    raise ValueError(f"unknown sample category {category!r}")


def cbor_counts_from_v1(outcome):
    """Merge the classes of a version 1 outcome into the kinds of a version 2 report."""
    return {
        f"{kind}_{side}": sum(outcome.get(f"{old}_{side}", 0) for old in classes)
        for kind, classes in CBOR_V1_CLASSES.items()
        for side in ("expected", "actual")
    }


def era_of_protocol(protocol_version):
    major = int(str(protocol_version).split(".")[0])
    eras = [era for first, era in PROTOCOL_ERAS if major >= first]
    if not eras:
        raise ValueError(f"protocol version {protocol_version} belongs to no known era")
    return eras[-1]


def cbor_report_from_results(report):
    """Count the outcome of every sample of a version 2 CBOR report, per rule and per expectation class."""
    missing = [field for field in CBOR_REPORT_FIELDS if field not in report]
    if missing:
        raise ValueError(f"CBOR report is missing {', '.join(missing)}")
    era = era_of_protocol(report["protocol_version"])
    rules = {}
    failures = []
    samples = {}
    for sample, outcome in report["results"].items():
        parts = sample.split("/")
        if len(parts) < 3:
            raise ValueError(f"sample path {sample!r} is not <rule>/<category>/<file>")
        rule, kind = parts[0], cbor_kind(parts[1])
        counts = rules.setdefault(rule, {f"{k}_{side}": 0 for k in CBOR_KINDS for side in ("expected", "actual")})
        counts[f"{kind}_expected"] += 1
        samples.setdefault(rule, []).append([kind, "/".join(parts[1:]), 1 if outcome is True else outcome])
        if outcome is True:
            counts[f"{kind}_actual"] += 1
        elif isinstance(outcome, str):
            failure_class, _, reason = outcome.partition(": ")
            failures.append({"rule": rule, "class": failure_class, "sample": sample, "reason": reason})
        else:
            raise ValueError(f"outcome of {sample!r} must be true or an error message")
    totals = {key: sum(counts[key] for counts in rules.values()) for key in next(iter(rules.values()), {})}
    return {
        "version": report["version"],
        "scenario": "cbor-decoding",
        "era": era,
        "generated_at": report["generated_at"],
        "protocol_version": report["protocol_version"],
        "dataset_commit": report["dataset_commit"],
        "implementation_commit": report["implementation_commit"],
        "corpus": f"{era} {report['dataset_commit'][:7]}",
        "successful": not failures,
        "totals": totals,
        "rules": rules,
        "failures": failures,
        # Written to a file of its own by build_scenario: it is too big to load with every page.
        "samples": samples,
    }


def parse_report(payload, scenario):
    report = json.loads(payload)
    is_cbor = scenario["id"] == "cbor-decoding"
    if is_cbor and report.get("version") == "2":
        return cbor_report_from_results(report)
    if is_cbor and "version" not in report:
        if "corpus" not in report or "totals" not in report or "rules" not in report:
            raise ValueError("legacy CBOR report is missing corpus, totals or rules")
        report.update({
            "version": "1",
            "scenario": "cbor-decoding",
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
    if report.get("version") != "1":
        raise ValueError("incompatible report: must declare version=1" + (" or 2" if is_cbor else ""))
    if report.get("scenario") != scenario["id"]:
        raise ValueError(f"report belongs to {report.get('scenario')!r}, expected {scenario['id']!r}")
    if is_cbor:
        report.setdefault("era", DEFAULT_ERA)
        report["totals"] = cbor_counts_from_v1(report["totals"])
        report["rules"] = {rule: cbor_counts_from_v1(outcome) for rule, outcome in report["rules"].items()}
    return report


def report_url(source):
    return source if isinstance(source, str) else latest_release_asset(source)


def preview_report_path(scenario_id, stem):
    directory = ROOT / "scenarios" / scenario_id / "preview"
    for suffix in ("", *COMPRESSION_SUFFIXES):
        path = directory / f"{stem}.json{suffix}"
        if path.is_file():
            return path
    return None


def era_sources(source):
    """Split the report source of a scenario into one source per era; None names the era of a lone source."""
    if isinstance(source, dict) and "github_releases" not in source:
        return source
    return {None: source}


def fetch_report(node, scenario, era, source, use_preview):
    """Return the URL and the parsed report of one source; a preview file is named <node>[-<era>].json."""
    stem = node["id"] if era is None else f"{node['id']}-{era}"
    preview = preview_report_path(scenario["id"], stem)
    if use_preview and preview is not None:
        url = f"../../scenarios/{scenario['id']}/preview/{preview.name}"
        payload = decompress_download((preview.name,), preview.read_bytes())
    else:
        url = report_url(source)
        payload = download(url)
    report = parse_report(payload, scenario)
    if era is not None and report.get("era", era) != era:
        raise ValueError(f"report is for era {report['era']!r}, expected {era!r}")
    return url, report


def fetch_node(node, scenario, use_preview):
    entry = {
        "id": node["id"],
        "name": node["name"],
        "language": node.get("language"),
        "repository": node.get("repository"),
        "color": node.get("color"),
        "logo": node.get("logo_path"),
        "report_url": None,
        "report": None,
        "error": None,
    }
    source = node.get("reports", {}).get(scenario["id"])
    if source is not None:
        sources = era_sources(source)
    elif use_preview and preview_report_path(scenario["id"], node["id"]) is not None:
        sources = {None: None}
    else:
        entry["error"] = "no report"
        return entry
    results = {}
    for era, era_source in sources.items():
        result = {"report_url": None, "report": None, "error": None}
        label = f"{scenario['id']}{f' {era}' if era else ''}: {node['name']}"
        try:
            result["report_url"], result["report"] = fetch_report(node, scenario, era, era_source, use_preview)
            print(f"ok     {label}")
        except Exception as error:
            result["error"] = str(error)
            print(f"failed {label}: {error}", file=sys.stderr)
        results[era] = result
    available = [era for era, result in results.items() if result["report"] is not None]
    primary = DEFAULT_ERA if DEFAULT_ERA in available else (available or list(results))[0]
    entry.update(results[primary])
    others = {era: result for era, result in results.items() if era != primary}
    if others:
        entry["eras"] = others
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

    def publish(result, name):
        if result["report"] is None:
            return
        samples = result["report"].pop("samples", None)
        if samples:
            (reports_dir / f"{name}-samples.json").write_text(json.dumps(samples, separators=(",", ":")) + "\n")
            result["samples_file"] = f"../../reports/{scenario['id']}/{name}-samples.json"
        (reports_dir / f"{name}.json").write_text(json.dumps(result["report"], indent=2) + "\n")
        result["report_file"] = f"../../reports/{scenario['id']}/{name}.json"
        if use_preview and result["report_url"].startswith("../../scenarios/"):
            result["report_url"] = result["report_file"]

    for entry in entries:
        publish(entry, slug(entry["name"]))
        for era, result in entry.get("eras", {}).items():
            publish(result, f"{slug(entry['name'])}-{era}")

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


def version_shared_assets():
    """Add a content hash to the links to shared styles and scripts, so that a browser never shows a stale copy."""
    def versioned(match):
        quote, prefix, folder, name = match.groups()
        asset = OUT / folder / name
        if not asset.is_file():
            return match.group(0)
        digest = hashlib.sha256(asset.read_bytes()).hexdigest()[:8]
        return f"{quote}{prefix}{folder}/{name}?v={digest}{quote}"

    link = re.compile(r"""(["'])((?:\.\./)*)(css|js)/([\w.-]+\.(?:css|js))\1""")
    for page in OUT.rglob("*.html"):
        text = page.read_text()
        updated = link.sub(versioned, text)
        if updated != text:
            page.write_text(updated)
