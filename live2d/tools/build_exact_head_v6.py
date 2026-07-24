#!/usr/bin/env python3
"""Build exact-pixel head layers from the user-approved master.

Visible pixels always come from the approved RGB master. Generated artwork is
used only as an underlay for regions hidden by hair in the approved master.
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE_RGB = ROOT / "live2d/source/abc_succubus_live2d_master_v5_user_approved.png"
SOURCE_ALPHA = ROOT / "live2d/source/abc_succubus_live2d_master_v5.png"
SAM_HAIR = ROOT / "live2d/source/v6_exact/mask_hair_horns.png"
GENERATED_FACE = ROOT / "live2d/source/v6_generated/face_complete_v2.png"
OUT = ROOT / "live2d/source/v6_exact_head"


def polygon_mask(size: tuple[int, int], points: list[tuple[int, int]]) -> np.ndarray:
    width, height = size
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [np.array(points, dtype=np.int32)], 255)
    return mask


def save_layer(rgb: np.ndarray, alpha: np.ndarray, path: Path) -> None:
    Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(path)


def place_generated_face(canvas_size: tuple[int, int]) -> np.ndarray:
    width, height = canvas_size
    canvas = np.zeros((height, width, 4), dtype=np.uint8)
    face = np.array(Image.open(GENERATED_FACE).convert("RGBA"))
    resized = cv2.resize(face, (335, 335), interpolation=cv2.INTER_LANCZOS4)
    x, y = 277, 103
    src_a = resized[:, :, 3:4].astype(np.float32) / 255.0
    region = canvas[y : y + 335, x : x + 335].astype(np.float32)
    region[:, :, :3] = resized[:, :, :3] * src_a + region[:, :, :3] * (1.0 - src_a)
    region[:, :, 3:4] = np.maximum(resized[:, :, 3:4], region[:, :, 3:4])
    canvas[y : y + 335, x : x + 335] = np.clip(region, 0, 255).astype(np.uint8)
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    source_rgba = np.array(Image.open(SOURCE_ALPHA).convert("RGBA"))
    rgb = source_rgba[:, :, :3]
    foreground = source_rgba[:, :, 3]
    height, width = foreground.shape

    head_region = np.zeros_like(foreground)
    head_region[0:435, 280:595] = 255
    head_foreground = cv2.bitwise_and(foreground, head_region)

    hair = np.array(Image.open(SAM_HAIR).convert("L"))
    hair = cv2.bitwise_and(hair, head_region)
    hair[430:, :] = 0

    regions = {
        "horn_l": polygon_mask((width, height), [(300, 0), (438, 0), (430, 165), (315, 168)]),
        "horn_r": polygon_mask((width, height), [(462, 0), (575, 0), (570, 170), (465, 168)]),
        "earring_l": polygon_mask((width, height), [(360, 265), (398, 265), (399, 354), (356, 354)]),
        "earring_r": polygon_mask((width, height), [(487, 262), (524, 262), (527, 354), (487, 354)]),
        "hair_side_l": polygon_mask(
            (width, height), [(287, 178), (390, 155), (410, 310), (406, 430), (290, 430)]
        ),
        "hair_side_r": polygon_mask(
            (width, height), [(488, 150), (578, 175), (585, 430), (479, 430), (473, 305)]
        ),
        "hair_crown": polygon_mask(
            (width, height), [(330, 80), (535, 72), (528, 298), (474, 329), (414, 332), (348, 295)]
        ),
    }

    allocated = np.zeros_like(foreground)
    layers: dict[str, np.ndarray] = {}
    for name in ("horn_l", "horn_r", "earring_l", "earring_r", "hair_side_l", "hair_side_r", "hair_crown"):
        source = head_foreground if name.startswith("earring") else hair
        mask = cv2.bitwise_and(source, regions[name])
        mask = cv2.bitwise_and(mask, cv2.bitwise_not(allocated))
        layers[name] = mask
        allocated = cv2.bitwise_or(allocated, mask)

    layers["hair_back"] = cv2.bitwise_and(hair, cv2.bitwise_not(allocated))
    allocated = cv2.bitwise_or(allocated, layers["hair_back"])
    face_neck_region = polygon_mask(
        (width, height),
        [(345, 145), (535, 145), (545, 345), (505, 420), (380, 420), (340, 345)],
    )
    layers["face_visible"] = cv2.bitwise_and(
        cv2.bitwise_and(head_foreground, face_neck_region),
        cv2.bitwise_not(allocated),
    )

    for name, alpha in layers.items():
        save_layer(rgb, alpha, OUT / f"{name}.png")
        Image.fromarray(alpha, "L").save(OUT / f"mask_{name}.png")

    underlay = place_generated_face((width, height))
    Image.fromarray(underlay, "RGBA").save(OUT / "face_hidden_underlay.png")

    reconstruction = np.zeros((height, width, 4), dtype=np.uint8)
    for name in ("face_visible", "hair_back", "horn_l", "horn_r", "hair_side_l", "hair_side_r", "hair_crown", "earring_l", "earring_r"):
        active = layers[name] > 0
        reconstruction[active, :3] = rgb[active]
        reconstruction[:, :, 3] = np.maximum(reconstruction[:, :, 3], layers[name])
    Image.fromarray(reconstruction, "RGBA").save(OUT / "head_reconstructed.png")

    covered = reconstruction[:, :, 3] > 0
    expected_alpha = np.zeros_like(foreground)
    for alpha in layers.values():
        expected_alpha = np.maximum(expected_alpha, alpha)
    expected = expected_alpha > 0
    missing = expected & ~covered
    rgb_error = np.abs(reconstruction[:, :, :3].astype(np.int16) - rgb.astype(np.int16))
    max_error = int(rgb_error[covered].max()) if np.any(covered) else 0
    report = (
        f"expected_head_pixels={int(expected.sum())}\n"
        f"covered_head_pixels={int((covered & expected).sum())}\n"
        f"missing_head_pixels={int(missing.sum())}\n"
        f"max_rgb_error_on_covered_pixels={max_error}\n"
    )
    (OUT / "verification.txt").write_text(report, encoding="utf-8")
    print(report, end="")


if __name__ == "__main__":
    main()
