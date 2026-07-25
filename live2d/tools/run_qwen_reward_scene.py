#!/usr/bin/env python3

import argparse
import json
import shutil
import time
from pathlib import Path
from urllib import request


SERVER = "http://127.0.0.1:8188"
COMFY_ROOT = Path(
    "/Users/takanakashuusuke/dev/experiments/comfyui_codex_lab/ComfyUI"
)
BASE_WORKFLOW = Path(
    "/Users/takanakashuusuke/dev/experiments/comfyui_codex_lab/"
    "workflows/qwen_live2d_front_v3_api.json"
)
REPO_ROOT = Path(__file__).resolve().parents[2]
IDENTITY_SOURCE = (
    REPO_ROOT / "live2d/source/abc_succubus_live2d_master_v5_user_approved.png"
)

SCENES = {
    "q4": {
        "guide": REPO_ROOT
        / "live2d/source/reward_scene_guides/q4_bust_press_guide.png",
        "seed": 2026072502,
        "prefix": "abc_succubus_rewards/q4_bust_press_v1",
        "prompt": """
Create a completely new production-quality reward illustration of the exact
same fictional adult succubus woman from Picture 1. Picture 1 is the sole
source of truth for her identity and art direction. Preserve her exact mature
face geometry, golden eyes, eyelids, eyebrows, nose, mouth, jawline, pale skin,
blue-black wavy hair with burgundy highlights, horns, gemstone earrings,
black-burgundy-gold fantasy outfit, wings, tail, adult body proportions, line
weight, cel shading, highlights, and color palette.

Picture 2 is only a geometric pose guide. Re-draw the character from scratch
in that pose; do not copy the guide's crude shapes or text. She stands front
facing with shoulders drawn back. Both elbows bend inward. Both open hands
press firmly from the lower outer sides of her clothed breasts, lifting and
compressing them visibly upward and toward the center. The pressure must
create a clearly deeper, narrower center cleavage and visible soft compression
through the fabric. Fingers wrap naturally along the lower outer curves; palms
must not merely rest flat on the upper chest. Keep all ten fingers anatomically
correct and separated. Her hands must not cover the center cleavage.

Keep the original deep open halter neckline, black side cups, gold piping,
burgundy side panels, bare upper sternum, and long open midriff exactly.
Coverage remains opaque and non-nude. Give her a confident, inviting,
slightly flushed adult expression while keeping the same face. Render the
entire character with both wings and tail on a perfectly flat uniform cyan
background, no shadow, scenery, floor, text, or watermark. This must be a new
illustration and a new pose, not a crop, warp, collage, or reuse of Picture 1.
""".strip(),
        "negative": (
            "different face, different character, childlike, underage, nudity, "
            "nipples, hands merely resting on upper chest, hands covering center "
            "cleavage, hands on waist, hands on hips, flat uncompressed chest, "
            "closed neckline, extra fingers, missing fingers, fused fingers, "
            "broken wrists, extra limbs, cropped head, three-quarter face, text, "
            "watermark, copied geometric guide"
        ),
    },
    "final": {
        "guide": REPO_ROOT
        / "live2d/source/reward_scene_guides/final_lean_reward_guide.png",
        "seed": 2026072503,
        "prefix": "abc_succubus_rewards/final_lean_reward_v1",
        "prompt": """
Create a completely new premium final-reward event illustration of the exact
same fictional adult succubus woman from Picture 1. Picture 1 is the sole
source of truth for her exact identity, mature face, golden eyes, hair, horns,
earrings, black-burgundy-gold fantasy outfit, wings, tail, body proportions,
line weight, cel shading, highlights, and palette.

Picture 2 is only a geometric composition guide. Re-draw the character from
scratch in a new dramatic low-view pose. She leans her upper body forward
toward the viewer with her shoulders slightly back and her chest projected
prominently toward camera. Her arms are braced wide on both sides, hands far
away from the face and chest as though enclosing the viewer between them.
Nothing may cover the face, neckline, breasts, or center cleavage. Use a close
event-CG composition where her face, golden eyes, deep open neckline, cleavage,
and upper torso dominate the frame; thighs and wing roots may remain visible.
Add a confident half-lidded gaze, subtle blush, and teasing adult smile while
preserving the same recognisable face.

Preserve the original opaque deep open halter outfit: black side cups, gold
piping, burgundy panels, bare upper sternum, and open midriff. Keep clothing
non-nude and anatomically plausible. Wings spread behind her to frame the
upper body without crossing it. Render on a perfectly flat uniform cyan
background with no scenery, shadow, floor, text, or watermark. This must be a
new illustration and new camera composition, not a crop, warp, collage, or
reuse of Picture 1.
""".strip(),
        "negative": (
            "different face, different character, childlike, underage, nudity, "
            "nipples, hands over chest, hands over face, hair covering eyes, "
            "closed neckline, small distant full body, neutral passport pose, "
            "flat chest, extra fingers, missing fingers, fused fingers, broken "
            "arms, extra limbs, crossed wings, text, watermark, copied guide"
        ),
    },
}


def get_json(path):
    with request.urlopen(f"{SERVER}{path}", timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scene", choices=SCENES, required=True)
    args = parser.parse_args()
    spec = SCENES[args.scene]

    input_dir = COMFY_ROOT / "input"
    identity_name = "abc_succubus_reward_identity.png"
    guide_name = f"abc_succubus_reward_{args.scene}_guide.png"
    shutil.copy2(IDENTITY_SOURCE, input_dir / identity_name)
    shutil.copy2(spec["guide"], input_dir / guide_name)

    graph = json.loads(BASE_WORKFLOW.read_text())
    graph["7"]["inputs"]["image"] = identity_name
    graph["8"]["inputs"]["image"] = guide_name
    graph["9"]["inputs"]["prompt"] = spec["prompt"]
    graph["10"]["inputs"]["prompt"] = spec["negative"]
    graph["14"]["inputs"]["seed"] = spec["seed"]
    graph["16"]["inputs"]["filename_prefix"] = spec["prefix"]

    payload = json.dumps({"prompt": graph}).encode("utf-8")
    req = request.Request(
        f"{SERVER}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with request.urlopen(req, timeout=60) as response:
        prompt_id = json.load(response)["prompt_id"]

    print(f"queued: {prompt_id}", flush=True)
    started = time.monotonic()
    next_report = 0
    while True:
        history = get_json(f"/history/{prompt_id}")
        if prompt_id in history:
            record = history[prompt_id]
            status = record.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(json.dumps(status, ensure_ascii=False))
            images = record.get("outputs", {}).get("16", {}).get("images", [])
            if images:
                print(
                    json.dumps(
                        {
                            "scene": args.scene,
                            "prompt_id": prompt_id,
                            "elapsed_seconds": round(time.monotonic() - started, 1),
                            "images": images,
                        },
                        ensure_ascii=False,
                    ),
                    flush=True,
                )
                return

        elapsed = int(time.monotonic() - started)
        if elapsed >= next_report:
            print(f"{args.scene} generating: {elapsed}s", flush=True)
            next_report = elapsed + 60
        time.sleep(5)


if __name__ == "__main__":
    main()
