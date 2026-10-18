#!/usr/bin/env python3
"""Assemble the static scenario site from reports published by node projects."""

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone

import build_common


def load_builders(scenarios):
    builders = {}
    for scenario in scenarios:
        scenario_id = scenario["id"]
        path = build_common.ROOT / "scenarios" / scenario_id / "build.py"
        if not path.is_file():
            raise ValueError(f"{path}: missing scenario builder")

        module_name = f"scenario_builder_{scenario_id.replace('-', '_')}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ValueError(f"{path}: unable to load scenario builder")
        builder = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = builder
        spec.loader.exec_module(builder)
        for function in ("prepare", "score"):
            if not hasattr(builder, function):
                raise ValueError(f"{path}: missing {function}()")
        builders[scenario_id] = builder
    return builders


def build_node_catalog(nodes, scenarios, builders, scenario_entries, scenario_contexts, built_at):
    denominators = {}
    for scenario in scenarios:
        scenario_id = scenario["id"]
        builder = builders[scenario_id]
        denominators[scenario_id] = max(
            (
                builder.score(entry["report"], scenario_contexts[scenario_id], entry["id"])[1]
                for entry in scenario_entries[scenario_id]
                if entry["report"]
            ),
            default=0,
        )

    cards = []
    for node in nodes:
        scenario_scores = []
        weighted_ratio = 0.0
        for scenario in scenarios:
            scenario_id = scenario["id"]
            builder = builders[scenario_id]
            entry = next(item for item in scenario_entries[scenario_id] if item["id"] == node["id"])
            report = entry["report"]
            passed, total = builder.score(report, scenario_contexts[scenario_id], node["id"])
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
            "conformance": {"percentage": round(weighted_ratio * 100, 2)},
            "scenario_scores": scenario_scores,
            "built_at": built_at,
            "_ratio": weighted_ratio,
        })
    cards.sort(key=lambda node: (-node["_ratio"], node["name"]))
    for node in cards:
        node.pop("_ratio")
    return cards


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Prefer reports in scenarios/<id>/preview/ when building locally; CI does not enable this flag.",
    )
    args = parser.parse_args()

    nodes = build_common.load_nodes()
    scenarios = build_common.load_scenarios()
    builders = load_builders(scenarios)
    if len({node["id"] for node in nodes}) != len(nodes):
        sys.exit("node metadata ids must be unique")

    build_common.copy_static_site()
    build_common.copy_node_assets(nodes)
    built_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    catalog = []
    scenario_entries = {}
    scenario_contexts = {}
    for scenario in scenarios:
        builder = builders[scenario["id"]]
        entries, context = build_common.build_scenario(
            scenario,
            nodes,
            built_at,
            args.preview,
            builder.prepare,
        )
        scenario_entries[scenario["id"]] = entries
        scenario_contexts[scenario["id"]] = context
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

    node_catalog = build_node_catalog(nodes, scenarios, builders, scenario_entries, scenario_contexts, built_at)
    (build_common.OUT / "catalog.json").write_text(
        json.dumps({"built_at": built_at, "scenarios": catalog, "nodes": node_catalog}, indent=2) + "\n"
    )
    print(f"built  {build_common.OUT.relative_to(build_common.ROOT)}/ with {len(scenarios)} scenarios")


if __name__ == "__main__":
    main()
