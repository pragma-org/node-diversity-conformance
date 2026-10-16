# UPLC Turbo Scenario

This is a non-functional performance scenario focus on the UPLC virtual machine, using real-world scenarios extracted from mainnet. This scenario has three main goals:

1. Assess the overall performance of a Plutus virtual machine across a large corpus of "real world" situations
2. Compare the measured performances against the estimated cost, thus validating (or not) the accuracy of the implementation towards the cost model
3. Identify discrepancies in the measured costs across implementations

## Setup

1. Download the [pinned turbo corpus](https://pub-2239d82d9a074482b2eb2c886191cb4e.r2.dev/turbo.tar.xz). It contains about half a million V1 and V2, pre-applied, Plutus scripts ready to be evaluated.

2. The benchmark should evaluate each program 50 times, take the best 30, and return the following measurements (see the [schema.json](./schema.json)):

   | Dimension    | Description                                                                  |
   | ---          | ---                                                                          |
   | `cpu_us`     | Mean evaluation time, in microseconds, excluding flat-decoding.              |
   | `flat_us`    | Mean flat-decoding time of the serialised script into an executable program. |
   | `mem_bytes`  | Mean max memory allocation for the program evaluation.                       |
   | `budget_cpu` | Counted cpu cost (through the costing model)                                 |
   | `budget_mem` | Counted mem cost (through the costing model)                                 |
   | `size_bytes` | Size, in bytes, of the flat-serialised script                                |

3. /!\ Use the correct semantics and default cost models depending on each epoch (otherwise, scripts may fail to evaluate due to budget restriction and comparison across implementations is compromised). For the corpus, the following versions are relevant:

   | Epoch             | Protocol Version |
   | ---               | ---              |
   | `>= 644`          | 11               |
   | `>= 537 && < 644` | 10               |
   | `>= 507 && < 537` | 9                |
   | `< 537`           | 8                |

4. Every evaluation must also count and check for budget, as it would normally
   happen in a real script validation. Use default budgets of 10B cpu units and
   10M mem units.

## Evaluation Method

The results are evaluated through multiple lenses. A result is accepted only if all the points below are verified:

1. The cpu+flat measured executions must not exceed 1.5x the computed cpu
   budget for it; unless the difference is smaller than 100μs (this is a
   work-around for very small scripts which may differ by more than 50%, but
   are somewhat negligeable).

2. The measured mem bytes must not exceed 1.5x the computed mem budget for it.

3. The computed mem and cpu must both agree with the majority of nodes. If
   there's no majority, then the Haskell's cardano-node is always considered
   valid.
