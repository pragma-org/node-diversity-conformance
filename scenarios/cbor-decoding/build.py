"""Build and score the CBOR decoding scenario."""


def prepare(_scenario, entries):
    return {}, entries, None


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
