# UPLC Turbo Scenario

This is a non-functional performance scenario. It does not decide whether a
node is semantically correct; it makes the cost of processing the same UPLC
programs visible across implementations.

## Setup

1. Use the pinned turbo corpus.
2. For every flat-encoded program, decode it into the implementation's VM
   representation and evaluate it with the production evaluator and a
   restrictive default budget. The evaluation must succeed.
3. Measure flat decoding and pure CEK evaluation separately. Neither measure
   includes arena reset, report generation, or other cleanup.
4. Repeat each script according to the implementation's benchmark procedure
   and report one representative `cpu_us`, `flat_us`, and `mem_bytes` value.
5. Compare CPU and memory measurements with the consumed execution budgets.
   Since CPU budgets are expressed in picoseconds, divide them by 1,000,000
   to obtain the expected duration in microseconds. Memory uses one byte per
   memory unit. CPU evaluation and flat decoding remain separate measurements,
   but acceptance uses their combined time against the CPU budget. A combined
   value no more than 50% above the budget passes; an absolute difference below
   100 μs is also accepted. Memory measurements may be `null` when the
   implementation cannot provide them; CPU and flat measurements remain
   independently reportable. A consumed-budget disagreement is also a failed
   result for the implementation treated as the outlier. Displayed deltas use
   `(measured - budget) / budget`, so positive values are above budget and
   negative values are below it.
6. Emit one JSON report matching [`schema.json`](schema.json), including one
   record for every script. Each record contains the script id, Plutus version,
   protocol version, consumed budget, measured CPU time, measured flat decoding
   time, measured memory, and flat script size. The report also records the
   benchmark machine once, including its operating system, architecture, CPU,
   logical-core count, and total memory when available. The presentation treats
   all Plutus language versions as one corpus.
7. Keep one raw record for every script. The presentation may summarize the
   complete dataset and select a bounded set of worst cases for display, but it
   must not discard the underlying measurements.

The protocol version, runtime, compiler profile, and cost model all affect the
measurements. The protocol version is recorded with each benchmark result so a
corpus can contain scripts evaluated under different protocol versions.
