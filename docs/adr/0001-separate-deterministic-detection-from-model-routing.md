# Separate deterministic detection from model routing

The framework will keep scheduling, provider polling, and candidate detection in
deterministic code, then use model-assisted routing only when candidate work
requires judgment about difficulty or remediation strategy. This keeps routine
loops cheap and testable while still allowing stronger workers for ambiguous or
high-risk failures.
