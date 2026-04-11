# CodeTwin

CodeTwin is a terminal-first AI coding agent.

The CLI is the main product. Launching the CLI with no arguments opens the interactive TUI.

The mobile app is an addon and is mainly for remote control when you are away from your laptop.

Public links:

- Website: https://code-twin.vercel.app/
- GitHub: https://github.com/Sahnik0/CodeTwin

## Product Model

- Main experience: local CLI + TUI in your terminal.
- Optional companion: mobile app for remote task control and approvals.
- Provider model: BYOK supported (bring your own API key).
- Free usage path: opencode provider supports no-cost models, with an upsell prompt when free usage is exhausted.

## What Is In This Repository

- App: Flutter mobile remote companion.
- CLI: codetwin runtime, wrappers, and TUI.
- codetwin-remote-server: bridge between mobile app and worker.
- Website: landing/docs and install scripts.

## Basic User Guide (Recommended)

### 1) Install CLI (One-Liner)

Windows PowerShell:

```powershell
irm https://code-twin.vercel.app/install.ps1 | iex
```

Linux/macOS:

```bash
curl -fsSL https://code-twin.vercel.app/install.sh | bash
```

After install, open a new terminal and verify:

```bash
codetwin --help
```

### 2) Open the TUI (Main Experience)

From your project folder:

```bash
codetwin
```

This starts the interactive CodeTwin TUI.

You can also run a one-shot task:

```bash
codetwin run "refactor auth module and add tests"
```

### 3) Provider Setup (Free Tier + BYOK)

Option A: start with the built-in free usage path (opencode provider no-cost models).

Option B: BYOK for full provider choice and limits:

```bash
codetwin providers login
codetwin providers list
codetwin models
```

Supported provider set includes OpenAI, Anthropic, Groq, Gemini, Mistral, Ollama, Azure, and others via the provider system.

### 4) Mobile App Is Optional (Remote Companion)

You do not need the mobile app to use CodeTwin locally.

Use the mobile app only when you want remote control while away from your laptop.

Mobile app download link:

- Drive link (to be added by maintainer): PENDING

Remote pairing flow:

```bash
codetwin login https://codetwin-1quv.onrender.com
```

Then enter the 12-character pairing code in the app Pair screen and start worker:

```bash
codetwin worker
```

## Developer Guide

Use this if you want to change CodeTwin code, not just use it.

### Prerequisites

- Git
- Bun
- Flutter SDK (only if editing mobile app)
- Android Studio/Xcode (only if building mobile targets)

### Clone Source

```bash
git clone https://github.com/Sahnik0/CodeTwin.git
cd CodeTwin
```

### Run CLI From Source

Windows:

```powershell
.\CLI\codetwin.cmd
```

Linux/macOS:

```bash
./CLI/codetwin
```

With no args, both wrappers open the TUI.

### Run Mobile App Locally (Only If You Are Developing App Changes)

If you are just a normal user, skip this section.

```bash
cd App
flutter pub get
flutter run
```

### Remote Worker Dev Flow

Windows:

```powershell
.\CLI\codetwin.cmd login https://codetwin-1quv.onrender.com
.\CLI\codetwin.cmd worker
```

Linux/macOS:

```bash
./CLI/codetwin login https://codetwin-1quv.onrender.com
./CLI/codetwin worker
```

## Quick Command Map

- Start TUI: codetwin
- One-shot task: codetwin run "task"
- Provider login: codetwin providers login
- List providers: codetwin providers list
- List models: codetwin models
- Pair remote app: codetwin login <bridge-url>
- Start remote worker: codetwin worker
- Usage/cost stats: codetwin stats

## Troubleshooting

- codetwin not found after one-liner install:
  - open a new terminal
  - ensure your PATH update applied
- Pairing code expired:
  - re-run codetwin login and enter the new code
- Worker not connecting:
  - confirm same bridge URL in both CLI and app

## Notes On Free Usage

- Free usage can be exhausted depending on provider path and limits.
- When exceeded on opencode free usage, the CLI may surface an upsell message.
- For production reliability, BYOK is recommended.