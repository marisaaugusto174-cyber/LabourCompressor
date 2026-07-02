#!/usr/bin/env python3
"""Refine PySceneDetect shot boundaries to local frame peaks."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np

CUT_REFINE_WINDOW_FRAMES = 12
CUT_SUSTAINED_WINDOW_FRAMES = 6
CUT_SUSTAINED_SCORE_RATIO = 0.65
CUT_SUSTAINED_FRACTION = 0.50
CUT_MIN_PEAK_PROMINENCE = 1.18
CUT_LUMA_ONLY_RATIO = 0.65
CUT_LUMA_STRUCTURE_ABS_MAX = 5.0
CUT_MOTION_MIN_GOOD_MATCHES = 18
CUT_MOTION_INLIER_RATIO = 0.45
CUT_MOTION_INLIER_KEYPOINT_RATIO = 0.08
CUT_SAME_SCENE_GOOD_MATCHES = 80
CUT_SAME_SCENE_STRUCTURE_MAX = 14.0
CUT_SAME_SCENE_LUMA_MIN = 1.35
CUT_BLUR_MOTION_SUSTAINED_FRACTION = 0.60


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def read_request(file_path: str) -> dict[str, Any]:
    value = json.loads(Path(file_path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("shot refinement request must be an object")
    return value


def median(values: list[float]) -> float:
    clean = sorted(float(value) for value in values if value is not None)
    if not clean:
        return 0.0
    middle = len(clean) // 2
    if len(clean) % 2:
        return clean[middle]
    return (clean[middle - 1] + clean[middle]) / 2.0


def frame_features(frame: np.ndarray) -> dict[str, np.ndarray]:
    small = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150).astype(np.float32) / 255.0
    hist = cv2.calcHist([small], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    return {"lab": lab, "edges": edges, "hist": hist}


def pair_metric(prev: dict[str, np.ndarray], curr: dict[str, np.ndarray],
                frame_index: int, fps: float) -> dict[str, float]:
    lab_diff = float(np.mean(np.abs(curr["lab"] - prev["lab"])))
    luma_diff = float(np.mean(np.abs(curr["lab"][..., 0] - prev["lab"][..., 0])))
    chroma_diff = float(np.mean(np.abs(curr["lab"][..., 1:] - prev["lab"][..., 1:])))
    edge_diff = float(np.mean(np.abs(curr["edges"] - prev["edges"])) * 20.0)
    hist_diff = float(cv2.compareHist(prev["hist"], curr["hist"], cv2.HISTCMP_BHATTACHARYYA) * 20.0)
    score = lab_diff + edge_diff + hist_diff
    structure = chroma_diff + edge_diff + hist_diff
    luma_structure = chroma_diff + edge_diff
    return {
        "frame_index": float(frame_index),
        "time": finite_float(frame_index / max(fps, 0.001)),
        "score": finite_float(score),
        "luma": finite_float(luma_diff),
        "chroma": finite_float(chroma_diff),
        "edge": finite_float(edge_diff),
        "hist": finite_float(hist_diff),
        "structure": finite_float(structure),
        "luma_structure": finite_float(luma_structure),
        "luma_ratio": finite_float(luma_diff / max(score, 0.001)),
    }


def read_frame_window(video: str, start_frame: int, end_frame: int) -> list[tuple[int, np.ndarray]]:
    capture = cv2.VideoCapture(video)
    if not capture.isOpened():
        return []
    start = max(0, int(start_frame))
    end = max(start, int(end_frame))
    capture.set(cv2.CAP_PROP_POS_FRAMES, start)
    frames: list[tuple[int, np.ndarray]] = []
    index = start
    while index <= end:
        ok, frame = capture.read()
        if not ok or frame is None:
            break
        frames.append((index, frame))
        index += 1
    capture.release()
    return frames


def local_cut_metrics(video: str, center_frame: int, fps: float) -> list[dict[str, float]]:
    first_pair_frame = max(1, center_frame - CUT_REFINE_WINDOW_FRAMES)
    last_pair_frame = max(first_pair_frame, center_frame + CUT_REFINE_WINDOW_FRAMES)
    frames = read_frame_window(video, first_pair_frame - 1, last_pair_frame)
    if len(frames) < 2:
        return []
    metrics: list[dict[str, float]] = []
    prev_features = frame_features(frames[0][1])
    for frame_index, frame in frames[1:]:
        curr_features = frame_features(frame)
        metrics.append(pair_metric(prev_features, curr_features, frame_index, fps))
        prev_features = curr_features
    return metrics


def candidate_pair_frames(video: str, frame_index: int) -> tuple[np.ndarray | None, np.ndarray | None]:
    frames = read_frame_window(video, max(0, frame_index - 1), frame_index)
    if len(frames) < 2:
        return None, None
    return frames[0][1], frames[1][1]


def feature_match_stats(prev_frame: np.ndarray, curr_frame: np.ndarray) -> dict[str, float]:
    prev = cv2.resize(prev_frame, (320, 180), interpolation=cv2.INTER_AREA)
    curr = cv2.resize(curr_frame, (320, 180), interpolation=cv2.INTER_AREA)
    prev_gray = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    curr_gray = cv2.cvtColor(curr, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(nfeatures=600, fastThreshold=12)
    kp1, des1 = orb.detectAndCompute(prev_gray, None)
    kp2, des2 = orb.detectAndCompute(curr_gray, None)
    if des1 is None or des2 is None or len(kp1) < 12 or len(kp2) < 12:
        return {"good_matches": 0.0, "inlier_ratio": 0.0, "inlier_keypoint_ratio": 0.0}
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    good = []
    for pair in matcher.knnMatch(des1, des2, k=2):
        if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance:
            good.append(pair[0])
    min_keypoints = max(1, min(len(kp1), len(kp2)))
    inliers = 0
    if len(good) >= 8:
        src = np.float32([kp1[item.queryIdx].pt for item in good]).reshape(-1, 1, 2)
        dst = np.float32([kp2[item.trainIdx].pt for item in good]).reshape(-1, 1, 2)
        _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if mask is not None:
            inliers = int(mask.ravel().sum())
    return {
        "good_matches": finite_float(float(len(good))),
        "inlier_ratio": finite_float(inliers / max(1, len(good))),
        "inlier_keypoint_ratio": finite_float(inliers / min_keypoints),
    }


def analyze_candidate(video: str, cut_time: float, duration: float, fps: float) -> dict[str, Any]:
    center_frame = max(1, int(round(cut_time * fps)))
    metrics = local_cut_metrics(video, center_frame, fps)
    if not metrics:
        return boundary_result(cut_time, cut_time, center_frame, True, "no_metrics", {})
    peak = max(metrics, key=lambda item: item["score"])
    peak_frame = int(peak["frame_index"])
    neighbor_scores = [item["score"] for item in metrics if abs(int(item["frame_index"]) - peak_frame) > 1]
    baseline = median(neighbor_scores) or median([item["score"] for item in metrics]) or 0.001
    prominence = peak["score"] / max(baseline, 0.001)
    context = [item for item in metrics if abs(int(item["frame_index"]) - peak_frame) <= CUT_SUSTAINED_WINDOW_FRAMES]
    sustained_scores = [item["score"] for item in context if item["score"] >= peak["score"] * CUT_SUSTAINED_SCORE_RATIO]
    sustained_fraction = len(sustained_scores) / max(1, len(context))
    match = read_match_stats(video, peak_frame)
    accepted, reason = classify_candidate(peak, prominence, sustained_fraction, match)
    refined_time = min(max(peak_frame / max(fps, 0.001), 0.0), duration)
    return boundary_result(cut_time, refined_time, peak_frame, accepted, reason, {
        "score": peak["score"],
        "prominence": finite_float(prominence),
        "sustainedFraction": finite_float(sustained_fraction),
        "lumaRatio": peak["luma_ratio"],
        "structure": peak["structure"],
        "lumaStructure": peak["luma_structure"],
        "matches": match["good_matches"],
    })


def read_match_stats(video: str, peak_frame: int) -> dict[str, float]:
    prev_frame, curr_frame = candidate_pair_frames(video, peak_frame)
    if prev_frame is None or curr_frame is None:
        return {"good_matches": 0.0, "inlier_ratio": 0.0, "inlier_keypoint_ratio": 0.0}
    return feature_match_stats(prev_frame, curr_frame)


def classify_candidate(peak: dict[str, float], prominence: float, sustained_fraction: float,
                       match: dict[str, float]) -> tuple[bool, str]:
    luma_only = peak["luma_ratio"] >= CUT_LUMA_ONLY_RATIO and peak["luma_structure"] <= CUT_LUMA_STRUCTURE_ABS_MAX
    motion_like = (
        match["good_matches"] >= CUT_MOTION_MIN_GOOD_MATCHES
        and match["inlier_ratio"] >= CUT_MOTION_INLIER_RATIO
        and match["inlier_keypoint_ratio"] >= CUT_MOTION_INLIER_KEYPOINT_RATIO
    )
    same_scene_motion = (
        match["good_matches"] >= CUT_SAME_SCENE_GOOD_MATCHES
        and peak["structure"] <= CUT_SAME_SCENE_STRUCTURE_MAX
        and peak["luma_ratio"] >= CUT_SAME_SCENE_LUMA_MIN
    )
    blurred_motion = (
        sustained_fraction >= CUT_BLUR_MOTION_SUSTAINED_FRACTION
        and peak["structure"] <= CUT_SAME_SCENE_STRUCTURE_MAX
        and peak["luma_ratio"] >= CUT_SAME_SCENE_LUMA_MIN
    )
    weak_or_sustained = prominence < CUT_MIN_PEAK_PROMINENCE or sustained_fraction >= CUT_SUSTAINED_FRACTION
    if luma_only:
        return False, "亮度/遮挡变化为主"
    if same_scene_motion or blurred_motion or (motion_like and weak_or_sustained):
        return False, "连续运镜/可对齐运动"
    if prominence < 1.08 and sustained_fraction >= 0.60:
        return False, "变化不是孤立切点"
    return True, "confirmed"


def boundary_result(original: float, refined: float, frame: int, accepted: bool,
                    reason: str, metrics: dict[str, float]) -> dict[str, Any]:
    return {
        "originalSeconds": finite_float(original),
        "refinedSeconds": finite_float(refined),
        "refinedFrame": int(frame),
        "accepted": bool(accepted),
        "reason": reason,
        "metrics": metrics,
    }


def analyze(request: dict[str, Any]) -> dict[str, Any]:
    input_path = str(request["inputFilePath"])
    duration = float(request["durationSeconds"])
    fps = max(float(request["frameRate"]), 0.001)
    boundaries = [float(value) for value in request["boundarySeconds"]]
    return {
        "algorithmVersion": "atomic-boundary-refinement-v1",
        "thresholds": {
            "windowFrames": CUT_REFINE_WINDOW_FRAMES,
            "minPeakProminence": CUT_MIN_PEAK_PROMINENCE,
            "lumaOnlyRatio": CUT_LUMA_ONLY_RATIO,
        },
        "boundaries": [analyze_candidate(input_path, boundary, duration, fps) for boundary in boundaries],
    }


def finite_float(value: float) -> float:
    if not math.isfinite(float(value)):
        raise ValueError("shot refinement metric must be finite")
    return float(value)


def main() -> None:
    args = parse_args()
    result = analyze(read_request(args.request))
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
