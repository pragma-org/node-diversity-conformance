"""Build and score the CBOR decoding scenario."""


import re

import build_common

DATASET_RAW = "https://raw.githubusercontent.com/r2rationality/cardano-cbor-dataset"


def ledger_commit(dataset_commit):
    """The cardano-ledger commit that the dataset pins in its Dockerfile, or None when it cannot be read."""
    try:
        dockerfile = build_common.download(f"{DATASET_RAW}/{dataset_commit}/Dockerfile").decode()
    except Exception as error:
        print(f"warn   cbor-decoding: no ledger commit for dataset {dataset_commit[:7]} ({error})")
        return None
    match = re.search(r"^ARG LEDGER_COMMIT=([0-9a-f]{40})", dockerfile, re.MULTILINE)
    return match.group(1) if match else None


def prepare(_scenario, entries):
    reports = [entry["report"] for entry in entries]
    reports += [result["report"] for entry in entries for result in entry.get("eras", {}).values()]
    datasets = {report["dataset_commit"] for report in reports if report and report.get("dataset_commit")}
    ledger_commits = {dataset: ledger_commit(dataset) for dataset in sorted(datasets)}
    return {"ledger_commits": ledger_commits}, entries, None


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
