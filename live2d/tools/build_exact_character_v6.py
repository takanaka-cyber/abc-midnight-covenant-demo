#!/usr/bin/env python3
"""Partition the approved master into exact-pixel Live2D layers."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE_RGB = ROOT / "live2d/source/abc_succubus_live2d_master_v5_user_approved.png"
SOURCE_ALPHA = ROOT / "live2d/source/abc_succubus_live2d_master_v5.png"
SAM = ROOT / "live2d/source/v6_exact"
HEAD = ROOT / "live2d/source/v6_exact_head"
CLOSED = HEAD / "closed_full_chroma.png"
MOUTH_OPEN = HEAD / "mouth_open_full_chroma.png"
OUT = ROOT / "live2d/source/v6_layers"


def largest_component(mask: np.ndarray) -> np.ndarray:
    binary = (mask > 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if count <= 1:
        return mask
    label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.where(labels == label, mask, 0).astype(np.uint8)


def polygon_mask(size: tuple[int, int], points: list[tuple[int, int]]) -> np.ndarray:
    width, height = size
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [np.array(points, dtype=np.int32)], 255)
    return mask


def ellipse_mask(
    size: tuple[int, int],
    center: tuple[int, int],
    axes: tuple[int, int],
    feather: float = 0,
) -> np.ndarray:
    width, height = size
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1, cv2.LINE_AA)
    if feather > 0:
        mask = cv2.GaussianBlur(mask, (0, 0), feather)
    return mask


def save_layer(rgb: np.ndarray, alpha: np.ndarray, name: str) -> None:
    Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(OUT / f"{name}.png")


def expand_within(
    mask: np.ndarray,
    foreground: np.ndarray,
    region: np.ndarray,
    radius: int = 3,
) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    expanded = cv2.dilate(mask, kernel, iterations=1)
    return cv2.bitwise_and(cv2.bitwise_and(expanded, foreground), region)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rgba = np.array(Image.open(SOURCE_ALPHA).convert("RGBA"))
    rgb = rgba[:, :, :3]
    foreground = rgba[:, :, 3]
    closed_rgb = np.array(Image.open(CLOSED).convert("RGB"))
    mouth_open_rgb = np.array(Image.open(MOUTH_OPEN).convert("RGB"))
    height, width = foreground.shape
    size = (width, height)

    raw = {}
    for name in ("wing_l", "wing_r", "arm_l", "arm_r", "cloak_l", "cloak_r", "tail"):
        raw[name] = largest_component(np.array(Image.open(SAM / f"mask_{name}.png").convert("L")))
        raw[name] = cv2.bitwise_and(raw[name], foreground)

    semantic_regions = {
        "wing_l": polygon_mask(size, [(0, 190), (315, 190), (355, 465), (310, 1060), (0, 1090)]),
        "wing_r": polygon_mask(size, [(572, 190), (886, 190), (886, 1090), (576, 1060), (532, 465)]),
        "arm_l": polygon_mask(size, [(112, 315), (370, 315), (365, 820), (110, 820)]),
        "arm_r": polygon_mask(size, [(515, 315), (775, 315), (775, 820), (510, 820)]),
        "cloak_l": polygon_mask(size, [(60, 500), (430, 500), (410, 1510), (60, 1510)]),
        "cloak_r": polygon_mask(size, [(457, 500), (827, 500), (827, 1510), (477, 1510)]),
        "tail": polygon_mask(size, [(390, 770), (495, 770), (500, 1460), (390, 1460)]),
    }
    for name, region in semantic_regions.items():
        raw[name] = expand_within(raw[name], foreground, region, 3)

    head_names = (
        "face_visible",
        "hair_back",
        "horn_l",
        "horn_r",
        "hair_side_l",
        "hair_side_r",
        "hair_crown",
        "earring_l",
        "earring_r",
    )
    for name in head_names:
        raw[name] = np.array(Image.open(HEAD / f"mask_{name}.png").convert("L"))
        raw[name] = cv2.bitwise_and(raw[name], foreground)

    hidden_head = np.array(Image.open(HEAD / "face_hidden_underlay.png").convert("RGBA"))
    visible_head_mask = np.zeros_like(foreground)
    for name in head_names:
        visible_head_mask = np.maximum(visible_head_mask, raw[name])
    hidden_alpha = cv2.bitwise_and(
        hidden_head[:, :, 3],
        cv2.dilate(visible_head_mask, np.ones((7, 7), np.uint8), iterations=1),
    )
    save_layer(hidden_head[:, :, :3], hidden_alpha, "head_underlay")

    raw["bust_l"] = cv2.bitwise_and(
        foreground,
        polygon_mask(size, [(323, 338), (444, 338), (447, 610), (399, 637), (326, 555)]),
    )
    raw["bust_r"] = cv2.bitwise_and(
        foreground,
        polygon_mask(size, [(443, 338), (565, 338), (558, 555), (488, 637), (440, 610)]),
    )

    priority = (
        "hair_crown",
        "hair_side_l",
        "hair_side_r",
        "earring_l",
        "earring_r",
        "horn_l",
        "horn_r",
        "face_visible",
        "arm_l",
        "arm_r",
        "bust_l",
        "bust_r",
        "tail",
        "cloak_l",
        "cloak_r",
        "hair_back",
        "wing_l",
        "wing_r",
    )
    allocated = np.zeros_like(foreground)
    layers = {}
    for name in priority:
        layers[name] = cv2.bitwise_and(raw[name], cv2.bitwise_not(allocated))
        allocated = cv2.bitwise_or(allocated, layers[name])
    layers["body_base"] = cv2.bitwise_and(foreground, cv2.bitwise_not(allocated))

    for name, mask in layers.items():
        save_layer(rgb, mask, name)

    eye_l = ellipse_mask(size, (411, 213), (31, 24), 1.2)
    eye_r = ellipse_mask(size, (478, 213), (31, 24), 1.2)
    eye_pair = cv2.bitwise_or(eye_l, eye_r)
    eye_pair[:, 443:447] = 0
    eye_pair = cv2.bitwise_and(eye_pair, raw["face_visible"])
    save_layer(rgb, eye_pair, "eyewhite")

    iris_l = ellipse_mask(size, (411, 213), (11, 15), 0.8)
    iris_r = ellipse_mask(size, (478, 213), (11, 15), 0.8)
    irides = cv2.bitwise_and(cv2.bitwise_or(iris_l, iris_r), eye_pair)
    save_layer(rgb, irides, "irides")

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    eyelash = np.where((gray < 92) & (eye_pair > 0), eye_pair, 0).astype(np.uint8)
    eyelash = cv2.dilate(eyelash, np.ones((2, 2), np.uint8), iterations=1)
    save_layer(rgb, eyelash, "eyelash")

    closed_l = ellipse_mask(size, (411, 213), (31, 25), 1.4)
    closed_r = ellipse_mask(size, (478, 213), (31, 25), 1.4)
    eye_close = cv2.bitwise_or(closed_l, closed_r)
    eye_close[:, 443:447] = 0
    save_layer(closed_rgb, eye_close, "eye_close")

    mouth_close = ellipse_mask(size, (444, 258), (34, 17), 1.4)
    mouth_close = cv2.bitwise_and(mouth_close, raw["face_visible"])
    save_layer(rgb, mouth_close, "mouth_close")
    save_layer(mouth_open_rgb, mouth_close, "mouth_open")

    reconstruction = np.zeros((height, width, 4), dtype=np.uint8)
    for name in reversed(priority + ("body_base",)):
        active = layers[name] > 0
        reconstruction[active, :3] = rgb[active]
        reconstruction[:, :, 3] = np.maximum(reconstruction[:, :, 3], layers[name])
    Image.fromarray(reconstruction, "RGBA").save(OUT / "reconstructed.png")

    covered = reconstruction[:, :, 3] > 0
    expected = foreground > 0
    rgb_error = np.abs(reconstruction[:, :, :3].astype(np.int16) - rgb.astype(np.int16))
    report = (
        f"source_foreground_pixels={int(expected.sum())}\n"
        f"covered_foreground_pixels={int((covered & expected).sum())}\n"
        f"missing_foreground_pixels={int((expected & ~covered).sum())}\n"
        f"extra_foreground_pixels={int((covered & ~expected).sum())}\n"
        f"max_rgb_error_on_covered_pixels={int(rgb_error[covered].max())}\n"
        f"semantic_layers={len(layers)}\n"
        f"expression_layers=6\n"
    )
    (OUT / "verification.txt").write_text(report, encoding="utf-8")
    print(report, end="")


if __name__ == "__main__":
    main()
