"""Build and score the UPLC conformance scenario."""

import json
import re
from collections import defaultdict

from build_common import ROOT


def normalize_evaluation(value):
    """Ignore pretty-printer whitespace without changing string constants."""
    if not isinstance(value, str):
        return value

    tokens = re.findall(r'"(?:\\.|[^"\\])*"|[()[\],{}]|[^\s()[\],{}]+', value, re.DOTALL)
    normalized = " ".join(tokens)
    normalized = re.sub(r"([\[\({])\s+", r"\1", normalized)
    normalized = re.sub(r"\s+([)\]}])", r"\1", normalized)
    normalized = re.sub(r"\s*,\s*", ",", normalized)
    return normalized.strip()


def budget_value(value):
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return None
    match = re.search(r"cpu:\s*(-?\d+).*?mem:\s*(-?\d+)", value, re.DOTALL)
    return {"cpu": int(match.group(1)), "mem": int(match.group(2))} if match else None


def prepare(scenario, entries):
    expectations = json.loads((ROOT / scenario["expectations"]).read_text())["scenarios"]
    return {"expectations": expectations}, entries, expectations


def score(report, expectations, _node_id=None):
    if not report:
        return 0, 0
    actual = defaultdict(list)
    for item in report.get("scenarios", []):
        actual[item.get("id")].append(item)
    used = set()
    passed = 0
    for expected in expectations or []:
        candidates = [
            (index, item)
            for index, item in enumerate(actual.get(expected["id"], []))
            if (expected["id"], index) not in used
        ]
        matching = next(
            (
                candidate
                for _, candidate in candidates
                if candidate.get("plutus_version") == expected.get("plutus_version")
                and candidate.get("protocol_version") == expected.get("protocol_version")
            ),
            candidates[0][1] if candidates else None,
        )
        item = matching
        if item is not None:
            used.add((expected["id"], next(index for index, candidate in candidates if candidate is item)))
        metadata_passed = (
            item is not None
            and item.get("plutus_version") == expected.get("plutus_version")
            and item.get("protocol_version") == expected.get("protocol_version")
        )
        evaluation_passed = metadata_passed and normalize_evaluation(item.get("evaluation")) == normalize_evaluation(
            expected.get("evaluation")
        )
        expected_budget = expected.get("budget")
        budget_passed = expected_budget is None or (
            metadata_passed and budget_value(item.get("budget")) == expected_budget
        )
        passed += int(evaluation_passed and budget_passed)
    return passed, len(expectations or [])
