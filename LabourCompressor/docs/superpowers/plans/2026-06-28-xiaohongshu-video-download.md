# Xiaohongshu Single-Note Video Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable single-video Xiaohongshu note downloads to the existing local pipeline.

**Architecture:** Register Xiaohongshu as a supported platform and route it through yt-dlp first. When yt-dlp specifically reports no Xiaohongshu formats, fetch and parse the note page, select the best H.264 MP4 candidate, and stream it into the existing artifact model.

**Tech Stack:** TypeScript on Node.js, native fetch/streams, yt-dlp, Node test runner.

---

## Tasks

- [x] Register `xiaohongshu` in platform detection, credential configuration, API validation, templates, and UI labels.
- [x] Extract a reusable Netscape cookies-to-header reader and retain Douyin behavior.
- [x] Add a pure Xiaohongshu note-page parser with deterministic H.264-first candidate selection.
- [x] Add an abortable, progress-reporting Xiaohongshu streaming downloader with atomic `.part` handling and bounded retries.
- [x] Route Xiaohongshu through yt-dlp first and use page fallback only for `No video formats found`.
- [x] Add structured Xiaohongshu errors and user-facing CLI/Web descriptions.
- [x] Add credential import/static checks/connectivity checks and update documentation.
- [x] Run focused tests, the full suite, security scans, and a private real-link download with ffprobe validation.

## Fixed behavior

- Supported URLs: `/explore/<note-id>` and `/discovery/item/<note-id>` on `xiaohongshu.com`.
- One note produces one MP4; image notes are rejected explicitly.
- Candidate order: H.264, height, width, bitrate, then file size.
- Page attempts: three total, with 250 ms and 750 ms abort-aware backoff.
- Cookies from an imported Netscape file are used by the page fallback; anonymous fallback remains allowed.
- Real cookies, xsec tokens, page HTML, and signed media URLs must never be committed or logged.
