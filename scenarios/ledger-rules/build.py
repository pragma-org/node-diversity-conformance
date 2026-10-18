"""Build and score the ledger transaction rules scenario."""

import json
import re

from build_common import ROOT


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
    return {"definitions": definitions}, entries, definitions


def score(report, definitions, _node_id=None):
    if report is None:
        return 0, 0
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
