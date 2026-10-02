// Package shell only. Future adapters receive explicit executable paths from
// FFMPEG_PATH / FFPROBE_PATH through worker configuration, without relying on PATH.
// Do not resolve paths or launch media subprocesses in Phase 0A.
export {};
