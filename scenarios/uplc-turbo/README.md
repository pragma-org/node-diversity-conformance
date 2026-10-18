# UPLC Turbo Scenario

This is a non-functional performance scenario focused on the UPLC virtual
machine, using real-world scenarios extracted from mainnet. This scenario has
three main goals:

1. Assess the overall performance of a Plutus virtual machine across a large
   corpus of "real world" situations

2. Compare the measured performance against the estimated budget, thus
   validating (or not) the accuracy of the implementation towards the cost
   model

3. Identify discrepancies in the measured costs across implementations

## Setup

1. Download the [pinned turbo corpus](https://pub-2239d82d9a074482b2eb2c886191cb4e.r2.dev/turbo.tar.zst).
   It contains a curated set of 3,997 V1, V2, and V3 Flat-encoded programs. The
   samples retain their epoch directories so that the protocol version can be
   inferred from the source epoch. Flat decoding and program preparation happen
   before the timed evaluator.

2. The benchmark should evaluate each program 50 times, take the best 30, and
   return the following measurements (see the [schema.json](./schema.json)):

   | Dimension    | Description                                                                  |
   | ---          | ---                                                                          |
   | `cpu_us`     | Mean pure CEK evaluation time, in microseconds.                              |
   | `mem_bytes`  | Mean additional memory used by the program evaluation.                       |
   | `budget_cpu` | Counted CPU budget through the costing model.                                |
   | `budget_mem` | Counted memory budget through the costing model.                             |

3. /!\ Use the correct semantics and default cost models depending on each
   epoch (otherwise, scripts may fail to evaluate due to budget restriction and
   comparison across implementations is compromised). For the corpus, the
   following versions are relevant:

   | Epoch             | Protocol Version |
   | ---               | ---              |
   | `>= 644`          | 11               |
   | `>= 537 && < 644` | 10               |
   | `>= 507 && < 537` | 9                |
   | `< 507`           | 8                |

4. Every evaluation must also count and check for budget, as it would normally
   happen in a real script validation. Use default budgets of 10B cpu units and
   10M mem units.

## Evaluation Method

The results are evaluated through multiple lenses. A result is accepted only if
all the points below are verified:

1. Compute `cpu_delta = (cpu_us - cpu_budget_us) / cpu_budget_us`, where
   `cpu_budget_us = budget_cpu / 1_000_000`. The result passes when
   `cpu_delta <= 1.0`. Conceptually, we treat 1 cpu unit as 1 picosecond.

   Results strictly smaller than 200μs (i.e. <2% of the maximum budget) are
   always treated as within tolerance for deviation from budget is quite
   unreliable (and frankly, irrelevant) for very small measures.

   Such results are excluded from delta-summaries and worst-case rankings.

2. Compute `mem_delta = (mem_bytes - budget_mem) / budget_mem`. The result
   passes when `mem_delta <= 1.0`. Cocneptually, we treat 1 mem unit as 1 byte
   of allocated memory.

   An absolute measure within 320 KiB (i.e. <2% of the maximum budget) of the
   budget is treated as within tolerance: it passes, has no delta, and is
   excluded from memory delta-summaries and worst-case rankings.

3. A benchmark missing from a node report is failed. A nullable measurement
   is unavailable for that dimension and is not treated as zero.

4. The computed mem and cpu budgets must both agree with the majority of nodes.
   If there is no majority, the Haskell cardano-node value is treated as valid.
