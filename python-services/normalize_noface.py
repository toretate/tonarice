#!/usr/bin/env python3
"""noface画像を元衣装と同じキャンバスサイズ・アルファマスクへ正規化する。"""

import argparse
import json
import sys

import cv2


def normalize_noface(source_path: str, noface_path: str) -> dict:
    source = cv2.imread(source_path, cv2.IMREAD_UNCHANGED)
    noface = cv2.imread(noface_path, cv2.IMREAD_UNCHANGED)
    if source is None or noface is None:
        raise ValueError("Failed to load source or noface image")

    source_height, source_width = source.shape[:2]
    if noface.shape[:2] != (source_height, source_width):
        noface = cv2.resize(noface, (source_width, source_height), interpolation=cv2.INTER_LANCZOS4)

    if source.ndim == 3 and source.shape[2] == 4:
        if noface.ndim == 2:
            noface = cv2.cvtColor(noface, cv2.COLOR_GRAY2BGRA)
        elif noface.shape[2] == 3:
            noface = cv2.cvtColor(noface, cv2.COLOR_BGR2BGRA)
        noface[:, :, 3] = source[:, :, 3]

    if not cv2.imwrite(noface_path, noface):
        raise ValueError("Failed to write normalized noface image")

    channels = noface.shape[2] if noface.ndim == 3 else 1
    return {
        "success": True,
        "width": source_width,
        "height": source_height,
        "channels": channels
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_path", help="元衣装画像の絶対パス")
    parser.add_argument("noface_path", help="正規化対象noface画像の絶対パス")
    args = parser.parse_args()

    try:
        print(json.dumps(normalize_noface(args.source_path, args.noface_path)))
    except ValueError as error:
        print(json.dumps({"success": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
