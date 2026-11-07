"""Build and score the ledger rules scenario."""

import json
import re

import build_common
from build_common import ROOT

DATASET_REPOSITORY = "pragma-org/amaru"
DATASET_PATH = "crates/amaru-ledger/tests/data/transaction/scenarios"


def dataset_change(commit=None):
    """Return the latest Amaru commit that changed the ledger scenario corpus."""
    query = f"path={DATASET_PATH}&per_page=1" + (f"&sha={commit}" if commit else "")
    try:
        commits = json.loads(build_common.download(f"https://api.github.com/repos/{DATASET_REPOSITORY}/commits?{query}"))
        return commits[0]["sha"]
    except Exception as error:
        print(f"warn   ledger-rules: no dataset change at {(commit or 'the default branch')[:7]} ({error})")
        return None


def load_definitions():
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
            "expected": document.get("expected", "Pass"),
        })
    if not definitions:
        raise ValueError(f"{root}: no ledger scenario definitions found")
    return definitions


def expected_result(definition):
    expected = definition.get("expected", "Pass")
    if expected == "Pass":
        return "pass"
    if isinstance(expected, dict):
        if expected.get("decoding_failure") is True:
            return "DecodingFailure"
        predicate = expected.get("predicate")
        if predicate:
            return predicate
    return "failed"


def result_matches(definition, result):
    return result == expected_result(definition)


def prepare(_scenario, entries):
    definitions = load_definitions()
    reports = [entry["report"] for entry in entries]
    reports += [result["report"] for entry in entries for result in entry.get("eras", {}).values()]
    commits = {report["dataset_commit"] for report in reports if report and report.get("dataset_commit")}
    dataset_changes = {
        "latest": dataset_change(),
        "by_commit": {commit: dataset_change(commit) for commit in sorted(commits)},
    }
    context = {"definitions": definitions, "dataset_changes": dataset_changes}
    return {"definitions": definitions, "dataset_changes": dataset_changes}, entries, context


def is_outdated(report, changes):
    """Whether a report names an older known version of the scenario corpus."""
    if not changes or not changes.get("latest"):
        return False
    if not report or not report.get("dataset_commit"):
        return True
    own = changes["by_commit"].get(report["dataset_commit"])
    return bool(own) and own != changes["latest"]


def outdated(entry, context):
    """Whether any report published by a node is older than the current corpus."""
    changes = context.get("dataset_changes") if context else None
    reports = [entry["report"], *(result["report"] for result in entry.get("eras", {}).values())]
    return any(is_outdated(report, changes) for report in reports)


def score(report, context, _node_id=None):
    if report is None:
        return 0, 0
    definitions = context.get("definitions", []) if isinstance(context, dict) else context
    definitions_by_id = {definition["id"]: definition for definition in definitions or []}
    results = {
        str(item.get("id", ""))[:5]: item.get("result")
        for item in report.get("scenarios", [])
        if str(item.get("id", ""))[:5] in definitions_by_id
    }
    passed = sum(
        result_matches(definition, results.get(identifier))
        for identifier, definition in definitions_by_id.items()
    )
    return passed, len(definitions_by_id)
