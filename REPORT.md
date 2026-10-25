# Report

See README.md for design and scope.

## Results
- Worked example (sample/worked_example.yaml): all 8 steps run; render 133.68 s vs timeline 133.70 s (< 1 frame).
- npm test: 3 scenarios pass. Determinism: 3 runs gave identical timeline_hash.
- Instruction latency on the 3-min sample: median 0.1 ms, max 0.3 ms (engine only, 90 instructions, laptop).

## Limits
- Reorder, multi-part instructions, two-speaker handling, OpenTimelineIO, Docker/OpenAPI/jobs not built.
- Time policy: current (edited) time, so repeating 'Remove 0:30-0:40' cuts the next content each time.
- Transcript is generated from the TTS script; word times are proportional to word length.
