# UPLC Turbo Scenario

This is a non-functional performance scenario. It does not decide whether a
node is semantically correct; it makes the cost of processing the same UPLC
programs visible across implementations.

## Setup

1. Download the pinned turbo corpus and record its identifier or digest.
2. For every flat-encoded program, decode it into the implementation's VM
   representation and evaluate it with an unbounded execution budget.
3. Repeat each script measurement for the configured sample count. The Amaru
   CI setup currently uses 10 samples per script.
4. Report the decode time, evaluation time, and total wall-clock time in
   nanoseconds. The total includes decode, evaluation, and the benchmark's
   reset step; report the mean and maximum for each script.
5. Compare the maximum execution time with the consumed CPU budget using one
   picosecond per CPU unit. Compare arena growth during evaluation with the
   consumed memory budget using one byte per memory unit. The presentation
   accepts a result when both ratios are at most 1.50. The arena measurement is an
   implementation-neutral approximation, not an allocator profile.
6. Emit one JSON report matching [`schema.json`](schema.json), including the
   corpus id, protocol version, sample count, budget deviation, and one record
   for every script. Memory measurements may be `null` when the implementation
   cannot provide them; CPU measurements remain independently reportable. The
   presentation treats all Plutus language versions as one corpus.
7. Group exact or near-duplicate flat programs when their serialized bytes are
   at least 90% shared and their median measurements differ by no more than
   10%. Keep the complete per-script records, but use one representative in
   the compact presentation.

The corpus, sample count, runtime, compiler profile, and cost model all affect
the measurements. They must be recorded so that performance comparisons remain
meaningful.
