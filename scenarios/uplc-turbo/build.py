"""Build and score the UPLC turbo benchmark scenario.

The raw reports contain measurements only. This module derives the CPU and
memory acceptance dimensions used by the site, keeping those rules in one
place rather than applying them independently in the browser.
"""

from collections import Counter
import json
import math

from build_common import ROOT


DEVIATION_LIMIT = 1.0
CPU_TOLERANCE_US = 200
MEMORY_TOLERANCE_BYTES = 320 * 1024
WORST_CASE_LIMIT = 100
ORDERS = ("cpu", "memory", "cpu-deviation", "memory-deviation")


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def benchmarks(report, accepted=None):
    accepted = set(accepted) if accepted is not None else None
    return [
        item
        for item in (report or {}).get("benchmarks", [])
        if isinstance(item, dict)
        and isinstance(item.get("bench"), str)
        and (accepted is None or item["bench"] in accepted)
    ]


def index_reports(entries, benchmark_ids):
    reports = {
        entry["id"]: benchmarks(entry["report"], benchmark_ids)
        for entry in entries
        if entry["report"] is not None
    }
    return reports, {
        node_id: {item["bench"]: item for item in items}
        for node_id, items in reports.items()
    }


def corpus_benchmarks(scenario):
    schema = json.loads((ROOT / scenario["schema"]).read_text())
    benchmark_ids = schema["$defs"]["benchmark"]["properties"]["bench"].get("enum")
    if not benchmark_ids or not all(isinstance(benchmark, str) for benchmark in benchmark_ids):
        raise ValueError("UPLC turbo schema must enumerate the corpus benchmark identifiers")
    if len(benchmark_ids) != len(set(benchmark_ids)):
        raise ValueError("UPLC turbo schema contains duplicate benchmark identifiers")
    return benchmark_ids


def cpu_budget_us(item):
    budget = item.get("budget_cpu")
    return budget / 1_000_000 if is_number(budget) and budget > 0 else None


def measurements(item):
    if item is None:
        return {
            "cpu_us": None,
            "mem_bytes": None,
            "cpu_delta": None,
            "cpu_delta_raw": None,
            "cpu_delta_suppressed": False,
            "mem_delta": None,
            "mem_delta_raw": None,
            "mem_delta_suppressed": False,
            "cpu_pass": False,
            "mem_pass": False,
            "missing": True,
        }

    cpu_us = item.get("cpu_us") if is_number(item.get("cpu_us")) else None
    mem_bytes = item.get("mem_bytes") if is_number(item.get("mem_bytes")) else None
    cpu_budget = cpu_budget_us(item)
    mem_budget = item.get("budget_mem") if is_number(item.get("budget_mem")) and item.get("budget_mem") > 0 else None
    cpu_delta_raw = ((cpu_us - cpu_budget) / cpu_budget
                     if cpu_us is not None and cpu_budget is not None else None)
    mem_delta_raw = ((mem_bytes - mem_budget) / mem_budget
                     if mem_bytes is not None and mem_budget is not None else None)
    cpu_delta_suppressed = (
        cpu_us is not None
        and cpu_budget is not None
        and abs(cpu_us - cpu_budget) <= CPU_TOLERANCE_US
    )
    mem_delta_suppressed = (
        mem_bytes is not None
        and mem_budget is not None
        and abs(mem_bytes - mem_budget) <= MEMORY_TOLERANCE_BYTES
    )
    cpu_delta = None if cpu_delta_suppressed else cpu_delta_raw
    mem_delta = None if mem_delta_suppressed else mem_delta_raw

    return {
        "cpu_us": cpu_us,
        "mem_bytes": mem_bytes,
        "cpu_delta": cpu_delta,
        "cpu_delta_raw": cpu_delta_raw,
        "cpu_delta_suppressed": cpu_delta_suppressed,
        "mem_delta": mem_delta,
        "mem_delta_raw": mem_delta_raw,
        "mem_delta_suppressed": mem_delta_suppressed,
        "cpu_pass": (
            cpu_delta_raw <= DEVIATION_LIMIT
            or cpu_delta_suppressed
            if cpu_delta_raw is not None
            else None
        ),
        "mem_pass": (
            mem_delta_raw <= DEVIATION_LIMIT
            or mem_delta_suppressed
            if mem_delta_raw is not None
            else None
        ),
        "missing": False,
    }


def dimension_pass(item, dimension, budget_failures=None):
    measured = measurements(item)
    if dimension == "cpu":
        result = measured["cpu_pass"]
        failed_budgets = (budget_failures or {}).get("cpu", set())
    else:
        result = measured["mem_pass"]
        failed_budgets = (budget_failures or {}).get("memory", set())
    if item is not None and item.get("bench") in failed_budgets:
        return False
    return result


def benchmark_failed(item, budget_failures=None):
    if item is None:
        return True
    checks = [
        dimension_pass(item, "cpu", budget_failures),
        dimension_pass(item, "memory", budget_failures),
    ]
    checks = [check for check in checks if check is not None]
    return not checks or not all(checks)


def summary_dimension(items, dimension):
    measured = [measurements(item) for item in items]
    if dimension == "cpu":
        available = [item for item in measured if item["cpu_us"] is not None]
        values = [item["cpu_us"] for item in available]
        deltas = [item["cpu_delta"] for item in available if item["cpu_delta"] is not None]
        raw_deltas = [item["cpu_delta_raw"] for item in available if item["cpu_delta_raw"] is not None]
        mean_delta = sum(deltas) / len(deltas) if deltas else None
        max_delta = max(deltas) if deltas else None
        maximum = max(available, key=lambda item: item["cpu_us"], default=None)
        return {
            "mean": sum(values) / len(values) if values else None,
            "mean_delta": mean_delta,
            "mean_delta_suppressed": bool(raw_deltas) and not deltas,
            "max": maximum["cpu_us"] if maximum else None,
            "max_delta": max_delta,
            "max_delta_suppressed": bool(raw_deltas) and not deltas,
            "mean_pass": mean_delta <= DEVIATION_LIMIT if mean_delta is not None else None,
            "max_pass": max_delta <= DEVIATION_LIMIT if max_delta is not None else None,
            "available": bool(values),
        }

    available = [item for item in measured if item["mem_bytes"] is not None]
    values = [item["mem_bytes"] for item in available]
    deltas = [item["mem_delta"] for item in available if item["mem_delta"] is not None]
    raw_deltas = [item["mem_delta_raw"] for item in available if item["mem_delta_raw"] is not None]
    mean_delta = sum(deltas) / len(deltas) if deltas else None
    max_delta = max(deltas) if deltas else None
    maximum = max(available, key=lambda item: item["mem_bytes"], default=None)
    return {
        "mean": sum(values) / len(values) if values else None,
        "mean_delta": mean_delta,
        "mean_delta_suppressed": bool(raw_deltas) and not deltas,
        "max": maximum["mem_bytes"] if maximum else None,
        "max_delta": max_delta,
        "max_delta_suppressed": bool(raw_deltas) and not deltas,
        "mean_pass": mean_delta <= DEVIATION_LIMIT if mean_delta is not None else None,
        "max_pass": max_delta <= DEVIATION_LIMIT if max_delta is not None else None,
        "available": bool(values),
    }


def summary(report, benchmark_ids, budget_failures=None):
    items = {item["bench"]: item for item in benchmarks(report, benchmark_ids)}
    passed = sum(
        not benchmark_failed(items.get(bench), (budget_failures or {}).get(bench, {}))
        for bench in benchmark_ids
    )
    reported = [item for item in items.values()]
    return {
        "passed": passed,
        "total": len(benchmark_ids),
        "reported": len(reported),
        "machine": report.get("machine"),
        "cpu": summary_dimension(reported, "cpu"),
        "memory": summary_dimension(reported, "memory"),
    }


def budget_analysis(entries, benchmark_ids, limit=10):
    reports, indexes = index_reports(entries, benchmark_ids)
    metadata = {
        item["bench"]: item
        for items in reports.values()
        for item in items
    }
    disagreements = []
    disagreements_by_node = Counter()
    failed_by_node = {
        node_id: {"cpu": set(), "memory": set()}
        for node_id in reports
    }

    for bench in benchmark_ids:
        values = {
            entry["id"]: {
                "cpu": indexes.get(entry["id"], {}).get(bench, {}).get("budget_cpu"),
                "mem": indexes.get(entry["id"], {}).get(bench, {}).get("budget_mem"),
            }
            for entry in entries
        }
        statuses = {}
        has_disagreement = False
        for dimension in ("cpu", "mem"):
            observed = {
                node_id: value[dimension]
                for node_id, value in values.items()
                if is_number(value[dimension])
            }
            distinct = len(set(observed.values())) > 1
            has_disagreement |= distinct
            majority = Counter(observed.values()).most_common(1)[0] if observed else (None, 0)
            clear_majority = distinct and majority[1] * 2 > len(observed)
            statuses[dimension] = {}
            for node_id in values:
                if node_id not in observed:
                    status = "missing"
                elif not distinct or (clear_majority and observed[node_id] == majority[0]):
                    status = "agree"
                elif not clear_majority and node_id == "cardano-node":
                    status = "agree"
                else:
                    status = "outlier"
                statuses[dimension][node_id] = status
                if status == "outlier":
                    failed_by_node.setdefault(node_id, {"cpu": set(), "memory": set()})[
                        "cpu" if dimension == "cpu" else "memory"
                    ].add(bench)

        if not has_disagreement:
            continue
        outlier_nodes = {
            node_id
            for dimension_statuses in statuses.values()
            for node_id, status in dimension_statuses.items()
            if status == "outlier"
        }
        for node_id in outlier_nodes:
            disagreements_by_node[node_id] += 1
        disagreements.append({
            "bench": bench,
            "plutus_version": metadata.get(bench, {}).get("plutus_version"),
            "protocol_version": metadata.get(bench, {}).get("protocol_version"),
            "nodes": {
                node_id: {
                    "cpu": values[node_id]["cpu"],
                    "cpu_status": statuses["cpu"][node_id],
                    "mem": values[node_id]["mem"],
                    "mem_status": statuses["mem"][node_id],
                }
                for node_id in values
            },
        })

    return {
        "total": len(disagreements),
        "items": disagreements[-limit:],
        "by_node": {node_id: disagreements_by_node[node_id] for node_id in reports},
    }, failed_by_node


def view_item(item, indexes, node_ids, budget_failures):
    nodes = {}
    for node_id in node_ids:
        node_item = indexes.get(node_id, {}).get(item["bench"])
        derived = measurements(node_item)
        nodes[node_id] = {
            "missing": node_item is None,
            "cpu_us": derived["cpu_us"],
            "cpu_delta": derived["cpu_delta"],
            "cpu_delta_suppressed": derived["cpu_delta_suppressed"],
            "cpu_pass": dimension_pass(node_item, "cpu", budget_failures.get(node_id)),
            "mem_bytes": derived["mem_bytes"],
            "mem_delta": derived["mem_delta"],
            "mem_delta_suppressed": derived["mem_delta_suppressed"],
            "mem_pass": dimension_pass(node_item, "memory", budget_failures.get(node_id)),
        }
    return {
        "bench": item["bench"],
        "plutus_version": item.get("plutus_version"),
        "protocol_version": item.get("protocol_version"),
        "nodes": nodes,
    }


def order_value(item, order):
    derived = measurements(item)
    values = {
        "cpu": derived["cpu_us"],
        "memory": derived["mem_bytes"],
        "cpu-deviation": derived["cpu_delta"],
        "memory-deviation": derived["mem_delta"],
    }
    value = values[order]
    return (value is None, -(value or 0))


def order_failed(item, order, budget_failures):
    if item is None:
        return True
    dimension = "memory" if order == "memory-deviation" or order == "memory" else "cpu"
    return dimension_pass(item, dimension, budget_failures) is False


def build_views(entries, benchmark_ids, budget_failures):
    reports, indexes = index_reports(entries, benchmark_ids)
    node_ids = [entry["id"] for entry in entries]
    views = {}
    for source_id, items in reports.items():
        source_views = {}
        for order in ORDERS:
            candidates = items
            if order in ("cpu", "cpu-deviation"):
                candidates = [
                    item
                    for item in items
                    if not measurements(item)["cpu_delta_suppressed"]
                    and (order == "cpu" or order_value(item, order)[0] is False)
                ]
            elif order in ("memory", "memory-deviation"):
                candidates = [
                    item
                    for item in items
                    if not measurements(item)["mem_delta_suppressed"]
                    and (order == "memory" or order_value(item, order)[0] is False)
                ]
            ordered = sorted(candidates, key=lambda item: (*order_value(item, order), item["bench"]))
            source_views[order] = [
                view_item(item, indexes, node_ids, budget_failures)
                for item in ordered[:WORST_CASE_LIMIT]
            ]
            source_views[f"{order}-failed"] = [
                view_item(item, indexes, node_ids, budget_failures)
                for item in ordered
                if order_failed(item, order, budget_failures.get(source_id, {}))
            ][:WORST_CASE_LIMIT]
        views[source_id] = source_views
    summaries = {}
    for entry in entries:
        if entry["report"] is None:
            continue
        node_failures = budget_failures.get(entry["id"], {})
        benchmark_failures = {
            bench: {
                dimension: failed
                for dimension, failed in node_failures.items()
                if bench in failed
            }
            for bench in benchmark_ids
            if any(bench in failed for failed in node_failures.values())
        }
        summaries[entry["id"]] = summary(entry["report"], benchmark_ids, benchmark_failures)
    return summaries, views


def prepare(scenario, entries):
    benchmark_ids = corpus_benchmarks(scenario)
    accepted = set(benchmark_ids)
    for entry in entries:
        if entry["report"] is not None:
            entry["report"]["benchmarks"] = benchmarks(entry["report"], accepted)
    disagreements, budget_failures = budget_analysis(entries, benchmark_ids)
    summaries, views = build_views(entries, benchmark_ids, budget_failures)
    extra = {
        "turbo_summary": summaries,
        "turbo_views": views,
        "turbo_disagreements": disagreements,
    }
    output_entries = [
        {
            **entry,
            "report": {"implementation": entry["report"].get("implementation")}
            if entry["report"] is not None
            else None,
        }
        for entry in entries
    ]
    return extra, output_entries, {"benchmark_ids": benchmark_ids, "budget_failures": budget_failures}


def score(report, context, node_id=None):
    if not report:
        return 0, 0
    benchmark_ids = context.get("benchmark_ids", [])
    budget_failures = context.get("budget_failures", {}).get(node_id, {})
    items = {item["bench"]: item for item in benchmarks(report, benchmark_ids)}
    passed = sum(
        not benchmark_failed(items.get(bench), {
            dimension: {bench} if bench in failures else set()
            for dimension, failures in budget_failures.items()
        })
        for bench in benchmark_ids
    )
    return passed, len(benchmark_ids)
