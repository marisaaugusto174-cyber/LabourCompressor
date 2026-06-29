#!/usr/bin/env python3
"""Extract deterministic visual, motion, and audio metrics at shot boundaries."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def read_request(file_path: str) -> dict[str, Any]:
    value = json.loads(Path(file_path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("continuity request must be an object")
    return value


def read_frame(capture: cv2.VideoCapture, seconds: float, width: int, height: int) -> np.ndarray:
    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, seconds) * 1000.0)
    ok, frame = capture.read()
    if not ok or frame is None:
        raise RuntimeError("unable to sample video frame")
    return cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)


def visual_metrics(before: np.ndarray, after: np.ndarray) -> dict[str, float]:
    before_hsv = cv2.cvtColor(before, cv2.COLOR_BGR2HSV)
    after_hsv = cv2.cvtColor(after, cv2.COLOR_BGR2HSV)
    before_hist = cv2.calcHist([before_hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
    after_hist = cv2.calcHist([after_hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
    cv2.normalize(before_hist, before_hist)
    cv2.normalize(after_hist, after_hist)
    similarity = cv2.compareHist(before_hist, after_hist, cv2.HISTCMP_CORREL)
    before_gray = cv2.cvtColor(before, cv2.COLOR_BGR2GRAY)
    after_gray = cv2.cvtColor(after, cv2.COLOR_BGR2GRAY)
    difference = float(np.mean(cv2.absdiff(before_gray, after_gray)) / 255.0)
    return {
        "histogramSimilarity": finite_float(similarity),
        "normalizedFrameDifference": finite_float(difference),
    }


def flow_vector(first: np.ndarray, second: np.ndarray) -> tuple[np.ndarray, float]:
    first_gray = cv2.cvtColor(first, cv2.COLOR_BGR2GRAY)
    second_gray = cv2.cvtColor(second, cv2.COLOR_BGR2GRAY)
    flow = cv2.calcOpticalFlowFarneback(
        first_gray, second_gray, None, 0.5, 3, 15, 3, 5, 1.2, 0
    )
    vector = np.mean(flow, axis=(0, 1))
    magnitude = float(np.mean(np.linalg.norm(flow, axis=2)))
    return vector, magnitude


def motion_metrics(
    before_first: np.ndarray,
    before_last: np.ndarray,
    after_first: np.ndarray,
    after_last: np.ndarray,
) -> dict[str, float]:
    before_vector, before_magnitude = flow_vector(before_first, before_last)
    after_vector, after_magnitude = flow_vector(after_first, after_last)
    denominator = float(np.linalg.norm(before_vector) * np.linalg.norm(after_vector))
    direction_cosine = 0.0 if denominator <= 1e-9 else float(
        np.dot(before_vector, after_vector) / denominator
    )
    lower = max(min(before_magnitude, after_magnitude), 1e-9)
    ratio = 1.0 if max(before_magnitude, after_magnitude) <= 1e-9 else (
        max(before_magnitude, after_magnitude) / lower
    )
    return {
        "beforeMagnitude": finite_float(before_magnitude),
        "afterMagnitude": finite_float(after_magnitude),
        "directionCosine": finite_float(direction_cosine),
        "magnitudeRatio": finite_float(ratio),
    }


def extract_audio(input_path: str, ffmpeg_path: str, output_path: str, sample_rate: int) -> bool:
    completed = subprocess.run(
        [
            ffmpeg_path, "-hide_banner", "-loglevel", "error", "-y",
            "-i", input_path, "-map", "0:a:0", "-ac", "1", "-ar", str(sample_rate),
            "-c:a", "pcm_s16le", output_path,
        ],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return completed.returncode == 0 and Path(output_path).exists()


def read_pcm(file_path: str) -> np.ndarray:
    with wave.open(file_path, "rb") as audio_file:
        frames = audio_file.readframes(audio_file.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def rms_db(samples: np.ndarray) -> float:
    if samples.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(np.square(samples))))
    return max(-120.0, 20.0 * math.log10(max(rms, 1e-6)))


def spectral_vector(samples: np.ndarray) -> np.ndarray:
    if samples.size == 0:
        return np.zeros(8, dtype=np.float64)
    windowed = samples * np.hanning(samples.size)
    spectrum = np.abs(np.fft.rfft(windowed))
    return np.array([float(np.sum(band)) for band in np.array_split(spectrum, 8)])


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    return 1.0 if denominator <= 1e-9 else float(np.dot(left, right) / denominator)


def audio_metrics(
    samples: np.ndarray | None,
    boundary: float,
    window_seconds: float,
    sample_rate: int,
) -> dict[str, Any]:
    if samples is None:
        return {"available": False}
    boundary_index = int(round(boundary * sample_rate))
    window_size = max(1, int(round(window_seconds * sample_rate)))
    before = samples[max(0, boundary_index - window_size):boundary_index]
    after = samples[boundary_index:boundary_index + window_size]
    before_db = rms_db(before)
    after_db = rms_db(after)
    return {
        "available": True,
        "beforeRmsDb": finite_float(before_db),
        "afterRmsDb": finite_float(after_db),
        "rmsDeltaDb": finite_float(abs(before_db - after_db)),
        "spectrumCosine": finite_float(cosine_similarity(
            spectral_vector(before), spectral_vector(after)
        )),
    }


def analyze(request: dict[str, Any]) -> dict[str, Any]:
    input_path = str(request["inputFilePath"])
    boundaries = [float(value) for value in request["boundarySeconds"]]
    sampling = request["sampling"]
    width = int(sampling["frameWidth"])
    height = int(sampling["frameHeight"])
    window_seconds = float(sampling["windowSeconds"])
    sample_rate = int(sampling["audioSampleRate"])
    capture = cv2.VideoCapture(input_path)
    if not capture.isOpened():
        raise RuntimeError("unable to open video for continuity analysis")
    with tempfile.TemporaryDirectory(prefix="labour-continuity-audio-") as temp_dir:
        wav_path = str(Path(temp_dir) / "audio.wav")
        has_audio = extract_audio(input_path, str(request["ffmpegPath"]), wav_path, sample_rate)
        samples = read_pcm(wav_path) if has_audio else None
        results = [
            analyze_boundary(capture, boundary, width, height, window_seconds, samples, sample_rate)
            for boundary in boundaries
        ]
    capture.release()
    return {"boundaries": results}


def analyze_boundary(
    capture: cv2.VideoCapture,
    boundary: float,
    width: int,
    height: int,
    window_seconds: float,
    samples: np.ndarray | None,
    sample_rate: int,
) -> dict[str, Any]:
    near_offset = min(0.1, window_seconds / 2.0)
    before_first = read_frame(capture, boundary - window_seconds, width, height)
    before_last = read_frame(capture, boundary - near_offset, width, height)
    after_first = read_frame(capture, boundary + near_offset, width, height)
    after_last = read_frame(capture, boundary + window_seconds, width, height)
    return {
        "boundarySeconds": finite_float(boundary),
        "visual": visual_metrics(before_last, after_first),
        "motion": motion_metrics(before_first, before_last, after_first, after_last),
        "audio": audio_metrics(samples, boundary, window_seconds, sample_rate),
    }


def finite_float(value: float) -> float:
    if not math.isfinite(float(value)):
        raise ValueError("continuity metric must be finite")
    return float(value)


def main() -> None:
    args = parse_args()
    result = analyze(read_request(args.request))
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
