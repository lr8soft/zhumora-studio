# Zhumora Studio

A local LLM studio for Windows, Linux, and macOS — a visual manager for llama.cpp `llama-server`, built with Electron and React.

Zhumora Studio downloads the right llama.cpp build for your GPU, manages your GGUF model library, and turns every launch flag into a form field. It runs a local OpenAI-compatible API you can share with other apps, and tracks every request it serves.

[简体中文](./README.md) · [Technical documentation](./ARCHITECTURE.md) · [Development guide](./DEVELOPMENT.md)

<p align="center">
  <img src="./imgs/model_list.png" alt="Zhumora Studio — Model marketplace with Hugging Face search" width="960" />
</p>

## Features

- **Runtime manager** — auto-detects your GPU and downloads the matching llama.cpp build (CUDA / Vulkan / CPU) with checksum verification and resume support
- **Model marketplace** — search Hugging Face for GGUF models, inspect quantizations and metadata, and download with progress and resume; import local `.gguf` files
- **Visual launch parameters** — every `llama-server` flag (context, threads, GPU layers, sampling, templates, extras) rendered as a grouped form; edit and restart without memorizing the CLI
- **OpenAI-compatible API** — exposes a local endpoint with API key management that any external app can call
- **Live status** — server health, process and system CPU/memory, and per-GPU utilization at a glance
- **Chat** — built-in OpenAI-compatible chat with streaming responses, sessions, and token speed
- **Usage tracking** — every request is recorded (IP, key, model, tokens, latency) with daily, per-model, and per-key breakdowns
- **Light / dark themes and multilingual UI** — English, 中文, 日本語, Español, Français, Deutsch

## Model marketplace

Search Hugging Face directly from the app, pick a quantization, and download it straight into your local library. Local models are scanned on startup, with architecture and quantization parsed from the GGUF header.

<p align="center">
  <img src="./imgs/model_list.png" alt="Zhumora Studio — Model marketplace with Hugging Face search" width="960" />
</p>

## Usage tracking

The built-in reverse proxy records every request — including ones made by external apps — so you can see exactly how many tokens each key and each model served, at what speed.

<p align="center">
  <img src="./imgs/track_usage.png" alt="Zhumora Studio — Usage statistics dashboard" width="960" />
</p>

## Quick start

### Requirements

- Windows 10 / 11, macOS, or Linux
- Node.js 22.12+
- npm

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Package

```bash
npm run build:win         # Windows (nsis, x64 + arm64)
npm run build:win:x64     # Windows x64 (x86-64) only
npm run build:win:arm64   # Windows arm64 only
npm run build:mac     # macOS (dmg, x64 + arm64)
npm run build:linux   # Linux (AppImage + deb, x64 + arm64)
```

The installer is written to `release/`.

## Documentation

The system architecture, process topology, and IPC contracts are documented in [ARCHITECTURE.md](./ARCHITECTURE.md). Layering rules, the three-platform compatibility spec, and the definition of done live in [DEVELOPMENT.md](./DEVELOPMENT.md).

## License

Zhumora Studio is licensed under the MIT License.
