#!/usr/bin/env python3
"""Segment the user-approved character image into exact-pixel Live2D source layers."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from rembg import new_session
from rembg.sessions.sam import apply_coords, get_input_points, transform_masks


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "live2d/source/abc_succubus_live2d_master_v5_user_approved.png"
OUT = ROOT / "live2d/source/v6_exact"


PROMPTS = {
    "hair_horns": [
        {"type": "point", "label": 1, "data": [369, 121]},
        {"type": "point", "label": 1, "data": [506, 97]},
        {"type": "point", "label": 1, "data": [352, 236]},
        {"type": "point", "label": 1, "data": [521, 242]},
        {"type": "point", "label": 1, "data": [379, 351]},
        {"type": "point", "label": 1, "data": [500, 349]},
        {"type": "point", "label": 0, "data": [444, 266]},
        {"type": "point", "label": 0, "data": [443, 337]},
        {"type": "point", "label": 0, "data": [444, 505]},
        {"type": "point", "label": 0, "data": [268, 258]},
        {"type": "point", "label": 0, "data": [610, 258]},
    ],
    "front_hair": [
        {"type": "point", "label": 1, "data": [393, 198]},
        {"type": "point", "label": 1, "data": [423, 230]},
        {"type": "point", "label": 1, "data": [361, 289]},
        {"type": "point", "label": 1, "data": [513, 284]},
        {"type": "point", "label": 1, "data": [386, 369]},
        {"type": "point", "label": 0, "data": [444, 274]},
        {"type": "point", "label": 0, "data": [323, 327]},
        {"type": "point", "label": 0, "data": [541, 345]},
        {"type": "point", "label": 0, "data": [369, 121]},
        {"type": "point", "label": 0, "data": [506, 97]},
    ],
    "face": [
        {"type": "point", "label": 1, "data": [443, 283]},
        {"type": "point", "label": 1, "data": [443, 337]},
        {"type": "point", "label": 1, "data": [409, 320]},
        {"type": "point", "label": 1, "data": [478, 320]},
        {"type": "point", "label": 0, "data": [394, 199]},
        {"type": "point", "label": 0, "data": [350, 291]},
        {"type": "point", "label": 0, "data": [516, 284]},
        {"type": "point", "label": 0, "data": [444, 449]},
    ],
    "eye_l": [
        {"type": "rectangle", "label": 1, "data": [382, 264, 438, 304]},
        {"type": "point", "label": 1, "data": [410, 282]},
    ],
    "eye_r": [
        {"type": "rectangle", "label": 1, "data": [451, 261, 505, 303]},
        {"type": "point", "label": 1, "data": [478, 281]},
    ],
    "mouth": [
        {"type": "rectangle", "label": 1, "data": [417, 326, 472, 353]},
        {"type": "point", "label": 1, "data": [444, 339]},
    ],
    "wing_l": [
        {"type": "rectangle", "label": 1, "data": [0, 220, 342, 1050]},
        {"type": "point", "label": 1, "data": [120, 455]},
        {"type": "point", "label": 1, "data": [112, 705]},
        {"type": "point", "label": 0, "data": [305, 510]},
        {"type": "point", "label": 0, "data": [235, 850]},
        {"type": "point", "label": 0, "data": [440, 620]},
    ],
    "wing_r": [
        {"type": "rectangle", "label": 1, "data": [545, 220, 886, 1050]},
        {"type": "point", "label": 1, "data": [770, 455]},
        {"type": "point", "label": 1, "data": [774, 705]},
        {"type": "point", "label": 0, "data": [582, 510]},
        {"type": "point", "label": 0, "data": [650, 850]},
        {"type": "point", "label": 0, "data": [445, 620]},
    ],
    "arm_l": [
        {"type": "rectangle", "label": 1, "data": [115, 330, 365, 815]},
        {"type": "point", "label": 1, "data": [330, 420]},
        {"type": "point", "label": 1, "data": [279, 612]},
        {"type": "point", "label": 1, "data": [205, 754]},
        {"type": "point", "label": 0, "data": [145, 510]},
        {"type": "point", "label": 0, "data": [390, 510]},
    ],
    "arm_r": [
        {"type": "rectangle", "label": 1, "data": [522, 330, 770, 815]},
        {"type": "point", "label": 1, "data": [556, 420]},
        {"type": "point", "label": 1, "data": [610, 612]},
        {"type": "point", "label": 1, "data": [682, 754]},
        {"type": "point", "label": 0, "data": [742, 510]},
        {"type": "point", "label": 0, "data": [495, 510]},
    ],
    "cloak_l": [
        {"type": "rectangle", "label": 1, "data": [75, 520, 395, 1505]},
        {"type": "point", "label": 1, "data": [260, 700]},
        {"type": "point", "label": 1, "data": [190, 1120]},
        {"type": "point", "label": 1, "data": [220, 1380]},
        {"type": "point", "label": 0, "data": [350, 930]},
        {"type": "point", "label": 0, "data": [115, 720]},
    ],
    "cloak_r": [
        {"type": "rectangle", "label": 1, "data": [492, 520, 812, 1505]},
        {"type": "point", "label": 1, "data": [625, 700]},
        {"type": "point", "label": 1, "data": [695, 1120]},
        {"type": "point", "label": 1, "data": [665, 1380]},
        {"type": "point", "label": 0, "data": [535, 930]},
        {"type": "point", "label": 0, "data": [772, 720]},
    ],
    "tail": [
        {"type": "rectangle", "label": 1, "data": [397, 780, 488, 1415]},
        {"type": "point", "label": 1, "data": [443, 935]},
        {"type": "point", "label": 1, "data": [440, 1175]},
        {"type": "point", "label": 1, "data": [458, 1370]},
        {"type": "point", "label": 0, "data": [380, 1110]},
        {"type": "point", "label": 0, "data": [515, 1110]},
    ],
    "leg_l": [
        {"type": "rectangle", "label": 1, "data": [260, 745, 452, 1585]},
        {"type": "point", "label": 1, "data": [365, 930]},
        {"type": "point", "label": 1, "data": [350, 1240]},
        {"type": "point", "label": 1, "data": [330, 1480]},
        {"type": "point", "label": 0, "data": [445, 1100]},
        {"type": "point", "label": 0, "data": [220, 1100]},
    ],
    "leg_r": [
        {"type": "rectangle", "label": 1, "data": [435, 745, 627, 1585]},
        {"type": "point", "label": 1, "data": [520, 930]},
        {"type": "point", "label": 1, "data": [535, 1240]},
        {"type": "point", "label": 1, "data": [558, 1480]},
        {"type": "point", "label": 0, "data": [442, 1100]},
        {"type": "point", "label": 0, "data": [665, 1100]},
    ],
}


def chroma_foreground(rgb: np.ndarray) -> np.ndarray:
    cyan = rgb[:, :, 1].astype(np.int16) + rgb[:, :, 2].astype(np.int16)
    red = rgb[:, :, 0].astype(np.int16)
    mask = ((cyan - 2 * red) < 260) | (red > 80)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return mask * 255


def clean_mask(mask: np.ndarray, foreground: np.ndarray) -> np.ndarray:
    mask = np.where(foreground > 0, mask, 0).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return mask


def save_layer(rgb: np.ndarray, mask: np.ndarray, path: Path) -> None:
    rgba = np.dstack([rgb, mask])
    Image.fromarray(rgba, "RGBA").save(path)


def prepare_embedding(session, image: Image.Image) -> dict:
    target_size = 1024
    input_size = (684, 1024)
    cv_image = np.array(image.convert("RGB"))
    original_size = cv_image.shape[:2]
    scale = min(input_size[1] / cv_image.shape[1], input_size[0] / cv_image.shape[0])
    transform_matrix = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]])
    encoded_image = cv2.warpAffine(
        cv_image,
        transform_matrix[:2],
        (input_size[1], input_size[0]),
        flags=cv2.INTER_LINEAR,
    )
    image_embedding = session.encoder.run(
        None, {session.encoder.get_inputs()[0].name: encoded_image.astype(np.float32)}
    )[0]
    return {
        "image_embedding": image_embedding,
        "original_size": original_size,
        "transform_matrix": transform_matrix,
        "input_size": input_size,
        "target_size": target_size,
    }


def predict_cached(session, embedding: dict, prompt: list[dict]) -> np.ndarray:
    points, labels = get_input_points(prompt)
    coords = np.concatenate([points, np.array([[0.0, 0.0]])], axis=0)[None, :, :]
    labels = np.concatenate([labels, np.array([-1])], axis=0)[None, :].astype(np.float32)
    coords = apply_coords(
        coords, embedding["input_size"], embedding["target_size"]
    ).astype(np.float32)
    coords = np.concatenate(
        [coords, np.ones((1, coords.shape[1], 1), dtype=np.float32)], axis=2
    )
    coords = np.matmul(coords, embedding["transform_matrix"].T)[:, :, :2].astype(np.float32)
    masks = session.decoder.run(
        None,
        {
            "image_embeddings": embedding["image_embedding"],
            "point_coords": coords,
            "point_labels": labels,
            "mask_input": np.zeros((1, 1, 256, 256), dtype=np.float32),
            "has_mask_input": np.zeros(1, dtype=np.float32),
            "orig_im_size": np.array(embedding["input_size"], dtype=np.float32),
        },
    )[0]
    masks = transform_masks(
        masks,
        embedding["original_size"],
        np.linalg.inv(embedding["transform_matrix"]),
    )
    merged = np.zeros((masks.shape[2], masks.shape[3]), dtype=np.uint8)
    for candidate in masks[0]:
        merged[candidate > 0.0] = 255
    return merged


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.open(SOURCE).convert("RGB")
    rgb = np.array(image)
    foreground = chroma_foreground(rgb)
    session = new_session("sam")
    embedding = prepare_embedding(session, image)

    masks = {}
    for name, prompt in PROMPTS.items():
        predicted = predict_cached(session, embedding, prompt)
        masks[name] = clean_mask(predicted, foreground)
        Image.fromarray(masks[name], "L").save(OUT / f"mask_{name}.png")
        save_layer(rgb, masks[name], OUT / f"layer_{name}.png")

    back_hair = cv2.subtract(masks["hair_horns"], masks["front_hair"])
    Image.fromarray(back_hair, "L").save(OUT / "mask_back_hair_horns.png")
    save_layer(rgb, back_hair, OUT / "layer_back_hair_horns.png")

    debug = rgb.copy()
    colors = {
        "hair_horns": (196, 44, 114),
        "front_hair": (43, 157, 255),
        "face": (52, 211, 153),
        "eye_l": (255, 214, 10),
        "eye_r": (255, 214, 10),
        "mouth": (255, 92, 92),
    }
    for name, color in colors.items():
        active = masks[name] > 0
        debug[active] = (0.48 * debug[active] + 0.52 * np.array(color)).astype(np.uint8)
    Image.fromarray(debug, "RGB").save(OUT / "segmentation_debug.png")


if __name__ == "__main__":
    main()
