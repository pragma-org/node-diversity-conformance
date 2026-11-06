"""Build and score the CBOR decoding scenario."""


import json
import re

import build_common

DATASET_REPOSITORY = "r2rationality/cardano-cbor-dataset"
DATASET_RAW = f"https://raw.githubusercontent.com/{DATASET_REPOSITORY}"


def dataset_change(era, commit=None):
    """The newest commit that changed the samples of an era, up to a commit (the default branch when None).

    A commit that only changes the README, the code or the reference reports does not make a new dataset. Returns None
    when GitHub cannot be read."""
    query = f"path=dataset/{era}&per_page=1" + (f"&sha={commit}" if commit else "")
    try:
        commits = json.loads(build_common.download(f"https://api.github.com/repos/{DATASET_REPOSITORY}/commits?{query}"))
        return commits[0]["sha"]
    except Exception as error:
        print(f"warn   cbor-decoding: no dataset change for {era} at {(commit or 'the default branch')[:7]} ({error})")
        return None


def ledger_commit(dataset_commit):
    """The cardano-ledger commit that the dataset pins in its Dockerfile, or None when it cannot be read."""
    try:
        dockerfile = build_common.download(f"{DATASET_RAW}/{dataset_commit}/Dockerfile").decode()
    except Exception as error:
        print(f"warn   cbor-decoding: no ledger commit for dataset {dataset_commit[:7]} ({error})")
        return None
    # The dataset named this commit LEDGER_COMMIT before it named it CBOR_IMPLEMENTATION_COMMIT.
    match = re.search(r"^ARG (?:LEDGER|CBOR_IMPLEMENTATION)_COMMIT=([0-9a-f]{40})", dockerfile, re.MULTILINE)
    return match.group(1) if match else None


def freshness(report, dataset_changes):
    """Whether a report was made with the latest dataset of its era: {"status": "latest" | "outdated", "dataset": the
    dataset change of the report or None}. None when it cannot be told, for example when GitHub could not be read."""
    if not (report and report.get("protocol_version")):
        return None
    try:
        changes = dataset_changes[build_common.era_of_protocol(report["protocol_version"])]
    except (KeyError, ValueError):
        return None
    if not changes["latest"]:
        return None
    if not report.get("dataset_commit"):
        return {"status": "outdated", "dataset": None}
    own = changes["by_commit"].get(report["dataset_commit"])
    if not own:
        return None
    return {"status": "latest" if own == changes["latest"] else "outdated", "dataset": own}


def outdated(entry, _context=None):
    """Whether any report of a node, in any era, was made with an older dataset."""
    results = [entry, *entry.get("eras", {}).values()]
    return any((result.get("freshness") or {}).get("status") == "outdated" for result in results)


def prepare(_scenario, entries):
    results = [*entries, *(result for entry in entries for result in entry.get("eras", {}).values())]
    # The commits of each report, by the era of its protocol version.
    commits_by_era = {}
    for result in results:
        report = result["report"]
        if not (report and report.get("protocol_version") and report.get("dataset_commit")):
            continue
        try:
            era = build_common.era_of_protocol(report["protocol_version"])
        except ValueError:
            continue
        commits_by_era.setdefault(era, set()).add(report["dataset_commit"])
    # For each era, the dataset change that is the latest, and the one that each report was made with. A report is up to
    # date when both are the same commit, even if the repository has other commits since.
    dataset_changes = {
        era: {"latest": dataset_change(era), "by_commit": {commit: dataset_change(era, commit) for commit in sorted(commits)}}
        for era, commits in sorted(commits_by_era.items())
    }
    for result in results:
        result["freshness"] = freshness(result["report"], dataset_changes)
    datasets = {commit for change in dataset_changes.values() for commit in [change["latest"], *change["by_commit"].values()] if commit}
    ledger_commits = {dataset: ledger_commit(dataset) for dataset in sorted(datasets)}
    latest = {era: {"latest": change["latest"]} for era, change in dataset_changes.items()}
    return {"ledger_commits": ledger_commits, "dataset_changes": latest}, entries, None


def score(report, _context, _node_id=None):
    if not report:
        return 0, 0
    if report.get("scenarios"):
        totals = report.get("totals", {})
        return int(totals.get("passed", 0)), int(totals.get("total", 0))
    if report.get("rules"):
        totals = report.get("totals", {})
        expected = sum(value for key, value in totals.items() if key.endswith("_expected"))
        actual = sum(value for key, value in totals.items() if key.endswith("_actual"))
        return actual, expected
    return 0, 0
