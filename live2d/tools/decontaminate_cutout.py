#!/usr/bin/env python3

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("cutout", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def border_background(rgb):
    border = np.concatenate(
        [
            rgb[:8].reshape(-1, 3),
            rgb[-8:].reshape(-1, 3),
            rgb[:, :8].reshape(-1, 3),
            rgb[:, -8:].reshape(-1, 3),
        ],
        axis=0,
    )
    return np.median(border, axis=0)


def main():
    args = parse_args()
    source = np.asarray(Image.open(args.source).convert("RGB"), dtype=np.float32)
    cutout = np.asarray(Image.open(args.cutout).convert("RGBA"), dtype=np.float32)
    alpha = cutout[..., 3:4] / 255.0
    background = border_background(source)

    denominator = np.maximum(alpha, 0.08)
    foreground = (source - (1.0 - alpha) * background) / denominator
    foreground = np.clip(foreground, 0, 255)
    foreground = np.where(alpha > 0.02, foreground, 0)

    visible = alpha[..., 0] > 0.02
    edge_distance = ndimage.distance_transform_edt(visible)
    cyan_spill = (
        (foreground[..., 1] > foreground[..., 0] + 15)
        & (foreground[..., 2] > foreground[..., 0] + 20)
        & (foreground[..., 1] > 80)
        & (edge_distance <= 24)
        & visible
    )
    spill_value = np.clip(
        foreground[cyan_spill].max(axis=1),
        30,
        140,
    )
    foreground[cyan_spill] = np.stack(
        [
            spill_value * 0.28,
            spill_value * 0.35,
            spill_value * 0.55,
        ],
        axis=1,
    )

    output = np.concatenate(
        [foreground, np.rint(alpha * 255.0)],
        axis=2,
    ).astype(np.uint8)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, "RGBA").save(args.output)


if __name__ == "__main__":
    main()
