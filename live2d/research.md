# Research evidence

## Runtime smoke test

- Engine: Anime2.5DRig
- Revision: `d48825867acd081de22b0e7b5585bb562288796d`
- Sample PSD: 20 parts / 12 detected hair strands
- Browser display: 120 fps
- Observation window: 8 seconds / 556 samples
- Eye openness: `1.000` to `0.003`
- Breath: `0.000` to `1.000`
- Bust spring displacement: `-6.306` to `+5.309`
- Bust strength during measurement: `2.5`

The sample verifies that the engine can fully close the eyes and maintains a bust-specific spring state. It does not yet prove that the current ABC character survives automatic layer decomposition or deformation without seams.

## Layer decomposition preflight

- Candidate: See-through wrapped by ComfyUI-See-through
- ComfyUI-See-through revision: `eb6fa6f6f9849ed1162b37c13a68b7cb107284e2`
- Machine: Apple M4 Pro / 48 GB unified memory
- PyTorch: 2.13.0 / MPS
- MPS `bfloat16`: arithmetic smoke test passed
- Comfy custom nodes: all six See-through nodes imported
- CUDA-only NF4 and group offload: disabled
- Layer model: about 10.16 GB
- Depth model: about 3.27 GB

The plugin has no published Apple Silicon benchmark.

## Apple Silicon result

- Local lab: Apple M4 Pro / 48 GB unified memory
- 512px / 4 steps: `81.21s`, 24 layers / 23 non-empty
- 512px / 12 steps: `139.61s`, 24 layers / 18 non-empty
- MPS issue: `torch.median` did not support the five-dimensional axis used by TransparentVAE
- Fix: the augmentation loop currently returns one tensor, so the one-element median was replaced by its identical first element
- Depth model: not downloaded; Anime2.5DRig does not require it and its model-card license metadata was not confirmed

The raw 12-step composite contained hallucinated back hair and color drift. Therefore the generated RGB was discarded. Only semantic alpha masks were clipped by the original cutout, and every visible layer reuses the original RGB.

## Current character result

- Source cutout: 512×512
- PSD: 16 layers / 731 KB
- Runtime: 20 parts / 6 front-hair strands
- Static recomposite coverage: 100%
- RGB mean absolute error against source: `0.000035`
- Automatic blink: eye openness `1.000` → `0.003`
- Embedded bust strength: `3.0`
- Sustained bust displacement: approximately `-2.61px` → `+2.98px`
- 375×812 full workflow: 4 answers read back correctly, overflow 0
- Embedded 5-second rAF: `121.8fps`
- Browser console/page error: 0
- Reduced motion: static fallback verified

## Decision

1. Use See-through only for initial semantic separation.
2. Discard generated color and keep only clipped masks.
3. Add character-specific closed-eye and closed-mouth layers before rigging.
4. Feed the correctly named PSD into Anime2.5DRig.
5. Keep all runtime work on `codex/live2d-rig-poc`; do not change the Pages source branch until the user approves the moving result.
