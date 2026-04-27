# Project Knowledge Analyzer

🔍 **Transform any codebase into AI-optimized context files for Claude, Copilot, Cursor, and more**

A powerful Node.js command-line tool that analyzes your project structure, flattens complex folder hierarchies, and generates comprehensive documentation for any AI agent or model — including `CLAUDE.md` for Claude Code, `AGENTS.md` for OpenAI Codex and Devin, `.github/copilot-instructions.md` for GitHub Copilot, and `.cursorrules` for Cursor IDE.

![npm version](https://img.shields.io/npm/v/@davaux/pka)
![license](https://img.shields.io/github/license/davauxjs/project-knowledge-analyzer)
![downloads](https://img.shields.io/npm/dm/@davaux/pka)

---

## Table of Contents

- [Change Log](#change-log)
  - [1.0.1](#101)
  - [1.0.0](#100)
  - [0.9.1](#091)
  - [0.9.0](#090)
- [Why Use This Tool?](#-why-use-this-tool)
  - [The Problem](#the-problem)
  - [The Solution](#the-solution)
- [Key Features](#-key-features)
  - [Smart Analysis](#smart-analysis)
  - [Intelligent Flattening](#intelligent-flattening)
  - [AI Agent Optimization](#ai-agent-optimization)
  - [Local Model Support](#local-model-support)
  - [Developer Experience](#developer-experience)
- [Installation](#-installation)
  - [Global Installation (Recommended)](#global-installation-recommended)
  - [Local Installation](#local-installation)
  - [Direct Usage (No Installation)](#direct-usage-no-installation)
- [Usage](#-usage)
  - [Basic Usage](#basic-usage)
  - [Modes](#modes)
  - [Options by Mode](#options-by-mode)
  - [Advanced Options](#advanced-options)
  - [Config File](#config-file)
- [Output Structure](#-output-structure)
  - [Metadata Headers by File Type](#metadata-headers-by-file-type)
- [Using with Claude AI](#-using-with-claude-ai)
  - [1. Generate Knowledge Files](#1-generate-knowledge-files)
  - [2. Upload to Claude AI Projects](#2-upload-to-claude-ai-projects)
  - [3. Reference Files in Conversation](#3-reference-files-in-conversation)
- [Using with Local Agents](#-using-with-local-agents)
  - [Option A — claude-code mode (fastest)](#option-a--claude-code-mode-fastest)
  - [Option B — full mode](#option-b--full-mode)
  - [Option C — flatten with install](#option-c--flatten-with-install)
  - [Staying up to date](#staying-up-to-date)
  - [Install guard and automatic cleanup](#install-guard-and-automatic-cleanup)
  - [.gitignore auto-update](#gitignore-auto-update)
  - [.claude/ directory awareness](#claude-directory-awareness)
  - [Hierarchical CLAUDE.md](#hierarchical-claudemd)
  - [Slash command stubs](#slash-command-stubs)
- [Multi-Tool Agent Support](#-multi-tool-agent-support)
- [Watch Mode](#-watch-mode)
- [Changes Since a Git Ref](#-changes-since-a-git-ref)
- [Developer Notes (Custom Instructions)](#-developer-notes-custom-instructions)
- [Orphan File Detection](#-orphan-file-detection)
- [Context Budget Warnings](#-context-budget-warnings)
- [Using with Local Models (Ollama, LM Studio, etc.)](#-using-with-local-models-ollama-lm-studio-etc)
  - [Chunk mode](#chunk-mode-default--lossless)
  - [Omit mode](#omit-mode-single-file)
  - [Protect what matters with `--compact-keep`](#protect-what-matters-with---compact-keep)
  - [Preview before committing](#preview-before-committing)
  - [XML format](#xml-format)
- [What's in CLAUDE.md](#-whats-in-claudemd)
- [Detected Stack Coverage](#-detected-stack-coverage)
- [Configuration](#-configuration)
  - [Default Settings](#default-settings)
- [Perfect For](#-perfect-for)
  - [Modern Web Development](#modern-web-development)
  - [AI-Assisted Development](#ai-assisted-development)
  - [Team Collaboration](#team-collaboration)
- [Contributing](#-contributing)
  - [Development Setup](#development-setup)
- [License](#-license)
- [Links](#-links)

---

### Change Log

#### 1.0.1

- **New**: `init` command — generates a `pka.config.json` in the target directory with every available setting pre-filled at its runtime default. Pass any analysis flag to have it reflected in the generated file (e.g. `davaux-pka init --mode claude-code --compact`). If a config already exists at the current `configVersion`, the command is a no-op unless `--force` is also passed.
- **New**: Config versioning — generated `pka.config.json` files now include a `configVersion` field. Future releases use this to detect and migrate older configs, adding new settings without touching existing customizations.

#### 1.0.0

- **New**: Mode system — every run starts with `--mode` to define what gets generated; options apply only when relevant to the selected mode. See [Modes](#modes)
  - `flatten` (default) — flattened files + `CODEBASE.txt` + `PROJECT_MAP.md` + `CLAUDE.md` in `outputDir`
  - `claude-code` — `CLAUDE.md` at the project root only (alias: `--cc`)
  - `multi-tool` — all four agent files at the project root (`CLAUDE.md` + `AGENTS.md` + copilot-instructions + `.cursorrules`); set any to `false` in `pka.config.json` to exclude it
  - `full` — flatten output in `outputDir` plus all four agent files at the project root
- **New**: `--agents-md` — adds `AGENTS.md` for OpenAI Codex, Devin, and agent runtimes that read this file by convention (on by default in `multi-tool`/`full` mode)
- **New**: `--copilot` — adds `.github/copilot-instructions.md` for GitHub Copilot (on by default in `multi-tool`/`full` mode)
- **New**: `--cursor-rules` — adds `.cursorrules` for Cursor IDE (on by default in `multi-tool`/`full` mode)
- **New**: Automatic stale file cleanup — after each run, pka removes its own generated files that are no longer applicable to the current mode (identified by the `<!-- pka-generated -->` marker or `_pkaGenerated` field); manually authored files are never touched
- **New**: Configuration conflict warnings — detects and reports contradictory options (e.g. `--compact-omit` without compact mode, `--since` with `--no-git`) with a suggested resolution before the run starts
- **New**: `--force` flag — allows overwriting non-pka-generated context files when using `--install` or any agent mode
- **New**: `.claude/` directory scanning — reads `.claude/settings.json` and `.claude/commands/` to document MCP servers, permissions, hooks, env keys, and custom slash commands in `CLAUDE.md`
- **New**: Install guard — generated context files are marked `<!-- pka-generated -->` so re-runs safely overwrite pka output without stomping manually authored files
- **New**: Compact mode (`--compact`, `--compact-tokens <n>`) — splits `CLAUDE.md` into token-budget-aware chunks for local/token-limited models (Ollama, etc.)
- **New**: Compact omit mode (`--compact-omit`) — single-file alternative that drops lowest-priority sections to fit the budget instead of chunking
- **New**: `--compact-keep <sections>` — pin specific sections so they are never dropped in omit mode
- **New**: `--compact-preview` — dry-run that prints a table of section sizes and omit/chunk plan without writing files
- **New**: `--xml` flag — generates `CODEBASE.xml` in Anthropic `<documents>` format for models that prefer structured XML context
- **New**: `--hierarchical` flag — generates a `CLAUDE.md` in each subdirectory, automatically describing the files and imports local to that directory
- **New**: `--scaffold-commands` flag — scaffolds `.claude/commands/*.md` stubs from detected npm scripts for use as Claude Code slash commands
- **New**: `--watch` flag — re-runs analysis automatically whenever source files change (500ms debounce)
- **New**: `--since <git-ref>` flag — highlights files changed since a branch, tag, or commit SHA in `CLAUDE.md`
- **New**: Context budget warning — alerts when `CLAUDE.md` exceeds 80k tokens (info) or 150k tokens (warning), with a suggestion to use `--compact`
- **New**: Orphan/dead file detection — identifies JS/TS files that nothing imports and are not entry points
- **New**: Custom developer notes — embed a persistent `## Developer Notes` section in `CLAUDE.md` via `PKA_INSTRUCTIONS.md` or the `instructions` field in `pka.config.json`
- **New**: `CODEBASE.txt` — entire codebase concatenated into one uploadable file (upload 1 file instead of 50+)
- **New**: `.gitignore` parsing — automatically excludes gitignored files from output
- **New**: `pka.config.json` — persist CLI options at the project root so bare `npx davaux-pka` just works
- **New**: `--install` flag — in `flatten` mode, copies `CLAUDE.md` from `outputDir` to the project root
- **New**: `.gitignore` auto-update — `outputDir` is automatically added to `.gitignore` on every `flatten`/`full` run; opt out with `--no-gitignore` or `noGitignore: true` in config
- **New**: `--diff` mode — shows what changed (new, modified, deleted files) since the last run
- **New**: Circular dependency detection — warns when JS/TS imports form a cycle
- **New**: TODO/FIXME/HACK/NOTE/BUG/OPTIMIZE annotation extraction with file and line numbers
- **New**: Environment variable documentation — parses `.env.example` into a structured required/optional table
- **New**: Monorepo/workspace detection — npm, yarn, pnpm, Lerna, Turborepo, Nx
- **New**: Binary file detection — skips binary files that would corrupt output
- **New**: Parallel file reading with concurrency limit — significantly faster on large projects
- **New**: Tech stack detection — auto-identifies React, Vue, Next.js, TypeScript, Vite, Tailwind, Prisma, SurrealDB, Playwright, and 40+ other packages
- **New**: Git metadata collection — branch, last commit, author, recent history
- **New**: Import graph analysis — maps which JS/TS files import which others
- **New**: Symbol extraction — exported functions, classes, types, and constants per file
- **New**: Entry point detection — identifies `index`, `main`, `app`, `server` files and `package.json` main/module fields
- **New**: Token count estimate in `PROJECT_MAP.md`
- **New**: Expanded language support — Python, Go, Rust, Ruby, Java, PHP, Swift, Kotlin, Dart, Lua, GraphQL, Prisma, Terraform, shell scripts, TOML, INI, JSONC, MDX
- **Fix**: TypeScript ESM imports (`.js` extension resolving to `.ts` files) are now correctly resolved in the import graph and orphan file detection
- **Fix**: Output directory is now automatically excluded from file scanning on every run, preventing feedback loops when re-running in the same project
- **Fix**: CLI defaults to the current directory when no path argument is given — `davaux-pka --cc` works without an explicit `.`
- **Fix**: File headers now use correct comment syntax per file type
- **Fix**: Path separators are now consistent across all platforms (Windows compatibility)
- **Improved**: `project-index.json` includes stack, git, import graph, per-file symbol data, content hashes, and diff summary
- **Improved**: `PROJECT_MAP.md` includes git history, entry points, import graph, symbols, circular deps, annotations, env vars, and workspace info
- **Updated**: License changed from MIT to GPLv3 to ensure that improvements to this tool remain open source and freely available to the community, while still allowing commercial use and modification under the terms of the GPL.

#### 0.9.1

- **Added**: `.sql` and `.surql` to allowed file types

#### 0.9.0

- Initial release

<sup>[↑ Back to ToC](#table-of-contents)</sup>

---

## 🚀 Why Use This Tool?

### The Problem

When working with AI agents on complex projects, you often face:

- **File name conflicts** when uploading multiple files with similar names
- **Lost context** about project structure and file relationships
- **Overwhelming uploads** without clear organization
- **Difficulty referencing** specific files in conversations
- **No clear mapping** between original structure and uploaded files
- **Tool fragmentation** — different agents read different context files

### The Solution

Project Knowledge Analyzer solves these problems by:

- **🎯 Eliminating naming conflicts** with unique hash-prefixed filenames
- **📋 Preserving complete context** with detailed project mapping
- **🗂️ Organizing files by type** for easy navigation
- **📖 Generating comprehensive documentation** that any AI agent can reference
- **🔗 Creating clear relationships** between original and flattened files
- **🤖 Producing context files** for every major AI tool in one run

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## ✨ Key Features

### Smart Analysis

- **Recursive project scanning** with intelligent exclusion patterns
- **Tech stack detection** — frameworks, build tools, databases, test runners
- **Import graph analysis** — see which files depend on which
- **Symbol extraction** — exported functions, classes, types per file
- **Entry point detection** — identifies where execution starts
- **Git metadata** — branch, commits, author, recent history
- **Token count estimate** — know your context budget before uploading
- **Size limits** to prevent overwhelming uploads

### Intelligent Flattening

- **Unique hash prefixes** prevent naming conflicts
- **Readable filenames** maintain context
- **Type-aware metadata headers** using correct syntax per file type
- **Preserved file relationships** through comprehensive mapping

### AI Agent Optimization

- **`CLAUDE.md`** — drop-in project context for Claude Code, auto-installed at project root
- **`AGENTS.md`** — same context formatted for OpenAI Codex, Devin, and similar agent runtimes
- **`.github/copilot-instructions.md`** — GitHub Copilot workspace instructions
- **`.cursorrules`** — Cursor IDE project context
- **`PROJECT_MAP.md`** — visual tree, file index, import graph, symbol map, git history
- **`project-index.json`** — programmatic access with full metadata
- **`CODEBASE.xml`** — Anthropic `<documents>` XML format for models that prefer structured context
- **Hierarchical `CLAUDE.md`** — per-directory context files written directly into the source tree
- **Slash command stubs** — scaffold `.claude/commands/` from your npm scripts
- **`.gitignore` auto-update** — output directory automatically added on every `flatten`/`full` run

### Local Model Support

- **Compact chunk mode** — splits output into token-budget files (`CLAUDE.md`, `CLAUDE-imports.md`, `CLAUDE-symbols.md`, `CLAUDE-annotations.md`)
- **Compact omit mode** — single file that drops lowest-priority sections to fit a token budget
- **`--compact-keep`** — pin sections that must never be dropped
- **`--compact-preview`** — see section sizes and the omit/chunk plan before writing any files

### Developer Experience

- **`--watch` mode** — auto-regenerates on file changes with 500ms debounce
- **`--since <ref>`** — highlights changed files for code review sessions
- **Context budget warnings** — alerts when output approaches model context limits
- **Orphan file detection** — surfaces unreferenced JS/TS files automatically
- **Developer Notes** — persistent custom instructions via `PKA_INSTRUCTIONS.md`
- **Configuration conflict warnings** — catches contradictory options before they produce unexpected output

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🛠️ Installation

### Global Installation (Recommended)

```bash
npm install -g @davaux/pka
```

### Local Installation

```bash
npm install @davaux/pka
```

### Direct Usage (No Installation)

```bash
npx davaux-pka .
```

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 📖 Usage

### Basic Usage

```bash
# Analyze current directory (global install)
davaux-pka .

# Analyze specific project
npx davaux-pka ./my-awesome-project

# With custom output directory
npx davaux-pka ./src --output-dir ./ai-knowledge
```

### Modes

Every run starts by picking a mode. The mode defines what gets generated — options are applied only when they're relevant to that mode.

```bash
npx davaux-pka .                          # flatten mode (default)
npx davaux-pka . --mode flatten           # explicit flatten
npx davaux-pka . --mode claude-code       # CLAUDE.md at project root only  (alias: --cc)
npx davaux-pka . --mode multi-tool        # all four agent files at project root
npx davaux-pka . --mode full              # flatten output + all four agent files
```

| Mode          | Generates                                                              | Output location                                   |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| `flatten`     | Flattened files + `CODEBASE.txt` + `PROJECT_MAP.md` + `CLAUDE.md`      | `outputDir`                                       |
| `claude-code` | `CLAUDE.md` only                                                       | project root                                      |
| `multi-tool`  | `CLAUDE.md` + `AGENTS.md` + `copilot-instructions.md` + `.cursorrules` | project root                                      |
| `full`        | Everything from `flatten` + everything from `multi-tool`               | flatten → `outputDir`, agent files → project root |

### Options by Mode

Not every option applies to every mode. Inapplicable options are silently ignored.

| CLI flag                    | Config key         | `flatten` | `claude-code` | `multi-tool` | `full`  |
| --------------------------- | ------------------ | :-------: | :-----------: | :----------: | :-----: |
| **Flatten / full**          |                    |           |               |              |         |
| `--output-dir <dir>`        | `outputDir`        |     ✓     |       —       |      —       |    ✓    |
| `--no-flatten`              | `noFlatten`        |     ✓     |       —       |      —       |    ✓    |
| `--no-concat`               | `noConcat`         |     ✓     |       —       |      —       |    ✓    |
| `--no-gitignore`            | `noGitignore`      |     ✓     |       —       |      —       |    ✓    |
| `--install`                 | `install`          |     ✓     |       —       |      —       |    —    |
| `--xml`                     | `xml`              |     ✓     |       —       |      —       |    ✓    |
| **Agent files**             |                    |           |               |              |         |
| `--agents-md`               | `agentsMd`         |     —     |    opt-in     |   opt-out    | opt-out |
| `--copilot`                 | `copilot`          |     —     |    opt-in     |   opt-out    | opt-out |
| `--cursor-rules`            | `cursorRules`      |     —     |    opt-in     |   opt-out    | opt-out |
| `--hierarchical`            | `hierarchical`     |     —     |       ✓       |      ✓       |    ✓    |
| `--scaffold-commands`       | `scaffoldCommands` |     —     |       ✓       |      ✓       |    ✓    |
| **Compact (CLAUDE.md)**     |                    |           |               |              |         |
| `--compact`                 | `compact`          |     ✓     |       ✓       |      ✓       |    ✓    |
| `--compact-tokens <n>`      | `compactTokens`    |     ✓     |       ✓       |      ✓       |    ✓    |
| `--compact-omit`            | `compactOmit`      |     ✓     |       ✓       |      ✓       |    ✓    |
| `--compact-keep <sections>` | `compactKeep`      |     ✓     |       ✓       |      ✓       |    ✓    |
| `--compact-preview`         | `compactPreview`   |     ✓     |       ✓       |      ✓       |    ✓    |
| **Universal**               |                    |           |               |              |         |
| `--no-context`              | `noContext`        |     ✓     |       ✓       |      ✓       |    ✓    |
| `--no-git`                  | `noGit`            |     ✓     |       ✓       |      ✓       |    ✓    |
| `--since <ref>`             | `since`            |     ✓     |       ✓       |      ✓       |    ✓    |
| `--diff`                    | `diff`             |     ✓     |       ✓       |      ✓       |    ✓    |
| `--watch`                   | `watch`            |     ✓     |       ✓       |      ✓       |    ✓    |
| `--force`                   | `force`            |     ✓     |       ✓       |      ✓       |    ✓    |
| `--include-ext <exts>`      | `includeExt`       |     ✓     |       ✓       |      ✓       |    ✓    |
| `--exclude-dir <patterns>`  | `excludeDir`       |     ✓     |       ✓       |      ✓       |    ✓    |
| `--max-file-size <bytes>`   | `maxFileSize`      |     ✓     |       ✓       |      ✓       |    ✓    |

**Agent file opt-in / opt-out rules:**

- In `multi-tool` and `full` modes, all three agent files are **on by default** — set any to `false` in `pka.config.json` to exclude it
- In `claude-code` mode, agent files are **off by default** — pass the flag explicitly to add one

```bash
# claude-code: CLAUDE.md only; add specific agents individually
npx davaux-pka . --mode claude-code --agents-md    # + AGENTS.md
npx davaux-pka . --mode claude-code --copilot      # + copilot-instructions.md
npx davaux-pka . --mode claude-code --cursor-rules # + .cursorrules

# multi-tool: all four on; opt out via config
# pka.config.json: { "mode": "multi-tool", "copilot": false }
```

### Advanced Options

```bash
# ── Flatten / full mode ─────────────────────────────────────────────────────
npx davaux-pka . --no-flatten                      # skip individual flattened files
npx davaux-pka . --no-concat                       # skip CODEBASE.txt
npx davaux-pka . --no-gitignore                    # skip auto-adding outputDir to .gitignore
npx davaux-pka . --install                         # also copy CLAUDE.md to project root
npx davaux-pka . --xml                             # also generate CODEBASE.xml
npx davaux-pka . --output-dir ./ai-knowledge       # custom output directory

# ── Agent mode extras (claude-code, multi-tool, full) ───────────────────────
npx davaux-pka . --mode claude-code --hierarchical     # CLAUDE.md in each subdirectory
npx davaux-pka . --mode claude-code --scaffold-commands # scaffold .claude/commands/ stubs

# ── Universal options (all modes) ───────────────────────────────────────────
npx davaux-pka . --no-context                      # skip CLAUDE.md generation
npx davaux-pka . --no-git                          # skip git metadata (faster)
npx davaux-pka . --include-ext ".py,.rb,.lua"      # add extra file extensions
npx davaux-pka . --exclude-dir "test,vendor"       # exclude additional directories
npx davaux-pka . --max-file-size 2097152           # increase file size limit to 2 MB
npx davaux-pka . --since main                      # highlight files changed since main
npx davaux-pka . --diff                            # show what changed since last run
npx davaux-pka . --force                           # overwrite non-pka-generated files
npx davaux-pka . --watch                           # auto-regenerate on file changes

# ── Compact mode (when CLAUDE.md is generated) ──────────────────────────────
npx davaux-pka . --compact                         # chunk mode, 8,192 token budget
npx davaux-pka . --compact-tokens 4096             # custom budget per chunk
npx davaux-pka . --compact-tokens 4096 --compact-omit  # omit mode — single file
npx davaux-pka . --compact --compact-keep "imports,symbols"  # pin sections
npx davaux-pka . --compact-preview                 # preview without writing files

# Show help
npx davaux-pka --help
```

### Config File

Place a `pka.config.json` in your project root to persist options — no need to pass flags every time. CLI flags always override config file values.

**Generating a config file:**

Use the `init` command to generate a `pka.config.json` pre-filled with every available setting at its runtime default:

```bash
# Generate with defaults (flatten mode)
davaux-pka init

# Generate with your preferred settings pre-applied
davaux-pka init --mode claude-code --compact
davaux-pka init --mode multi-tool --output-dir ./.pka

# Re-generate (overwrite an existing config)
davaux-pka init --force
```

Every available setting is written to the file — including ones you didn't pass — so you can see the full option surface and edit from a known baseline. Values you provide via flags are written as-is; everything else reflects the default that pka would use if you ran the analysis right now.

**Minimal examples by mode:**

```json
{ "mode": "flatten", "outputDir": "./ai-knowledge" }
```

```json
{ "mode": "claude-code" }
```

```json
{ "mode": "multi-tool", "copilot": false }
```

```json
{ "mode": "full", "outputDir": "./.pka", "copilot": false, "compact": true }
```

**Full config reference:**

```json
{
  "configVersion": 1,
  "mode": "flatten",
  "outputDir": "./project-knowledge",
  "maxFileSize": 1048576,
  "includeExt": [".py", ".rb"],
  "excludeDir": ["test", "fixtures"],
  "instructions": "Custom notes embedded in CLAUDE.md as Developer Notes",

  "noGit": false,
  "noContext": false,
  "since": null,
  "diff": false,
  "force": false,
  "watch": false,

  "noFlatten": false,
  "noConcat": false,
  "noGitignore": false,
  "install": false,
  "xml": false,

  "agentsMd": null,
  "copilot": null,
  "cursorRules": null,
  "hierarchical": false,
  "scaffoldCommands": false,

  "compact": false,
  "compactTokens": 0,
  "compactOmit": false,
  "compactKeep": [],
  "compactPreview": false
}
```

**Key field notes:**

| Field | Notes |
| --- | --- |
| `configVersion` | Written by `init`; used to detect when a config is older than the current release and may need migration. Do not remove it. |
| `agentsMd` / `copilot` / `cursorRules` | `null` = follow mode default (on in `multi-tool`/`full`, off in `claude-code`). Set `false` to always exclude; `true` to always include regardless of mode. |
| `compactTokens` | `0` means not set — compact mode uses the default 8,192 token budget when `compact: true`. Set a number to override. |
| `instructions` | Inline developer notes appended to `CLAUDE.md` as a `## Developer Notes` section. `PKA_INSTRUCTIONS.md` at the project root takes precedence over this field. |

**Config versioning and migration:**

`davaux-pka init` stamps a `configVersion` into every generated config. When a new version of pka introduces new settings, running `init` on a project that already has a config will detect the older `configVersion` and add the new settings with their defaults — your existing values are preserved. If the config is already at the current version, `init` is a no-op (use `--force` to regenerate from scratch).

Set an agent file to `false` to exclude it from `multi-tool`/`full` mode even when those modes are active:

```json
{ "mode": "multi-tool", "copilot": false }
```

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 📁 Output Structure

Output location and contents depend on the mode:

**`flatten` mode** → files written to `outputDir` (default: `./project-knowledge/`):

```
project-knowledge/
├── CODEBASE.txt              # Entire codebase in one file — easiest to upload to Claude
├── CODEBASE.xml              # Same content in Anthropic <documents> XML format (--xml)
├── CLAUDE.md                 # AI context file (stack, commands, structure, git)
├── CLAUDE-imports.md         # Import graph chunk — compact mode only (--compact)
├── CLAUDE-symbols.md         # Exported symbols chunk — compact mode only (--compact)
├── CLAUDE-annotations.md     # Code annotations chunk — compact mode only (--compact)
├── PROJECT_MAP.md            # Full docs — tree, index, import graph, symbols, annotations
├── project-index.json        # Programmatic index with stack, git, imports, symbols, diff
├── a1b2c3d4_src_app.ts      # Flattened source files with correct metadata headers
├── e5f6g7h8_config.json     # JSON files copied as-is (no header — JSON has no comments)
└── i9j0k1l2_README.md       # Markdown files with YAML frontmatter metadata header
```

**`claude-code` / `multi-tool` / `full` modes** → agent files written directly to project root:

```
CLAUDE.md                                  # Claude Code / Claude AI  (all agent modes)
AGENTS.md                                  # OpenAI Codex, Devin, etc. (multi-tool, full, or --agents-md)
.github/copilot-instructions.md            # GitHub Copilot           (multi-tool, full, or --copilot)
.cursorrules                               # Cursor IDE               (multi-tool, full, or --cursor-rules)
```

**`full` mode** produces both trees simultaneously — flatten output in `outputDir`, agent files at the project root.

### Metadata Headers by File Type

Each flattened file gets a metadata header using the **correct syntax for its language**:

```javascript
// JavaScript / TypeScript / CSS
/**
 * Original Path: src/components/UserProfile.tsx
 * File Type: module
 * Size: 2.15 KB
 * Last Modified: 2025-01-15T10:30:45.123Z
 * Hash: a1b2c3d4
 * Exports: UserProfile, useUserData
 */
```

```yaml
# YAML / Python / Shell / TOML / dotfiles
# Original Path: config/database.yml
# File Type: config
# Size: 512 B
```

```markdown
---
original_path: "docs/architecture.md"
file_type: "documentation"
size: "4.1 KB"
last_modified: "2025-01-15T10:30:45.123Z"
hash: "b2c3d4e5"
---
```

```html
<!-- HTML / Vue / Svelte -->
<!--
  Original Path: src/views/Home.vue
  File Type: component
-->
```

```sql
-- SQL / SurrealQL
-- Original Path: migrations/001_init.sql
-- File Type: database
```

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🤖 Using with Claude AI

### 1. Generate Knowledge Files

```bash
npx davaux-pka ./my-react-app
```

### 2. Upload to Claude AI Projects

**Easiest:** Upload just `CODEBASE.txt` — it contains every source file in one document.

**For full context:** Upload `CODEBASE.txt` + `CLAUDE.md` + `PROJECT_MAP.md`. Claude gets the codebase, project overview, and structural map.

**With flattened files:** Upload the individual flattened files if you want to reference specific files by their hashed names.

### 3. Reference Files in Conversation

```
"Can you analyze the UserProfile component?
It's in file a1b2c3d4_src_components_UserProfile.tsx"
```

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🤖 Using with Local Agents

### Option A — claude-code mode (fastest)

```bash
npx davaux-pka . --mode claude-code   # or: --cc
```

Generates **only** `CLAUDE.md` and installs it directly at your project root. No flattened files, no `CODEBASE.txt`, no `PROJECT_MAP.md` — just the context file your agent reads.

### Option B — full mode

```bash
npx davaux-pka . --mode full
```

Generates all four agent files at the project root **and** the full flatten output (`PROJECT_MAP.md`, `CODEBASE.txt`, flattened files) in `outputDir` in one pass. Best when you need both uploadable files for Claude AI projects and local agent context.

### Option C — flatten with install

```bash
npx davaux-pka . --install
```

Generates all flatten output into `project-knowledge/` and copies `CLAUDE.md` to your project root. Claude Code automatically reads `CLAUDE.md` at the project root on every session.

### Staying up to date

```bash
# Fastest refresh — only regenerates CLAUDE.md
npx davaux-pka . --mode claude-code

# All four agent files refreshed
npx davaux-pka . --mode multi-tool

# See what changed first, then refresh
npx davaux-pka . --diff --install
```

### Install guard and automatic cleanup

pka marks every file it generates so it can manage its own output safely without touching anything you've written by hand.

**Ownership markers:**

| File type                                          | Marker                                     |
| -------------------------------------------------- | ------------------------------------------ |
| Markdown / text (`.md`, `.cursorrules`, `.xml`, …) | `<!-- pka-generated -->` on the first line |
| `project-index.json`                               | `"_pkaGenerated": true` as the first field |

On every run, pka checks for the marker before overwriting an existing file:

- **Marked** — safe to overwrite; it's pka's own output
- **Not marked** — skipped with a warning, protecting manually authored files
- **`--force`** — overrides the guard and overwrites regardless

```bash
# Force overwrite a manually authored CLAUDE.md
npx davaux-pka . --mode claude-code --force
```

To "adopt" a pka-generated file and prevent future overwrites, simply remove the marker from the first line.

**Automatic stale file cleanup:**

When you switch modes, pka automatically removes generated files that are no longer applicable to the current mode — as long as they still carry the ownership marker. Files you've modified (and whose marker you've removed) are left untouched.

For example, switching from `multi-tool` to `claude-code` removes the now-unused `AGENTS.md`, `.github/copilot-instructions.md`, and `.cursorrules`:

```
🧹 Removed stale: AGENTS.md
🧹 Removed stale: .github/copilot-instructions.md
🧹 Removed stale: .cursorrules
🧹 Cleaned up 3 stale pka-generated file(s)
```

Similarly, switching from `flatten` to an agent mode removes the stale `CLAUDE.md`, `PROJECT_MAP.md`, `CODEBASE.txt`, and `project-index.json` from `outputDir`. Hash-named flattened source files are not auto-deleted (too many to track safely) — pka prints a notice instead:

```
💡 "project-knowledge" contains files from a prior flatten run — remove it if no longer needed
```

### `.gitignore` auto-update

In `flatten` and `full` modes, pka automatically adds the output directory to your `.gitignore` on every run — keeping generated files out of version control without any manual steps. The check is idempotent and handles all common gitignore formats (`project-knowledge`, `project-knowledge/`, `/project-knowledge/`).

To opt out, pass `--no-gitignore` on the CLI or set `noGitignore: true` in your config file.

### `.claude/` directory awareness

If your project has a `.claude/` directory (Claude Code's local config folder), pka reads it and includes an **AI Assistant Configuration** section in `CLAUDE.md` covering:

- **MCP servers** — name, command, and arguments from `settings.json`
- **Permissions** — allowed and denied tool patterns
- **Hooks** — event names and handler counts
- **Environment keys** — env vars exposed to the agent
- **Custom slash commands** — names and descriptions from `.claude/commands/*.md`

This gives Claude Code an immediate picture of its own tool access and available shortcuts.

### Hierarchical CLAUDE.md

For larger projects, Claude Code reads `CLAUDE.md` at each directory level it navigates to. Use `--hierarchical` to generate one per directory, written directly into the source tree:

```bash
npx davaux-pka . --hierarchical
```

Each directory's `CLAUDE.md` lists the files in that directory, their types, exported symbols, and local import relationships — giving Claude Code focused context as it navigates your project.

### Slash command stubs

Scaffold `.claude/commands/` files from your npm scripts so they appear as slash commands in Claude Code:

```bash
npx davaux-pka . --scaffold-commands
```

This creates stubs like `/project:dev`, `/project:build`, `/project:test` pointing at the corresponding `npm run` commands. Existing custom command files are never overwritten.

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🌐 Multi-Tool Agent Support

One run, every agent. pka generates context files for all major AI tools simultaneously — they all receive the same project knowledge from the same analysis pass:

```bash
# All four context files at project root
npx davaux-pka . --mode multi-tool

# All four + flatten output in outputDir
npx davaux-pka . --mode full

# Claude Code mode + specific agents added
npx davaux-pka . --mode claude-code --agents-md    # CLAUDE.md + AGENTS.md
npx davaux-pka . --mode claude-code --copilot      # CLAUDE.md + copilot-instructions
```

In `multi-tool` and `full` modes, all three agent files are generated by default. Exclude any with `false` in `pka.config.json`:

```json
{ "mode": "multi-tool", "copilot": false }
```

All generated files use the same install guard (`<!-- pka-generated -->`) and respect `--force`. Re-running updates every file atomically.

| File                              | Mode(s) that generate it                                            | Read by                                                                      |
| --------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `CLAUDE.md`                       | all agent modes                                                     | Claude Code, Claude AI                                                       |
| `AGENTS.md`                       | `multi-tool`, `full` (default on); `claude-code` + `--agents-md`    | OpenAI Codex, Devin, and agent runtimes that follow the AGENTS.md convention |
| `.github/copilot-instructions.md` | `multi-tool`, `full` (default on); `claude-code` + `--copilot`      | GitHub Copilot                                                               |
| `.cursorrules`                    | `multi-tool`, `full` (default on); `claude-code` + `--cursor-rules` | Cursor IDE                                                                   |

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 👁️ Watch Mode

Keep context files continuously up to date while you develop:

```bash
npx davaux-pka . --watch                         # flatten mode on every change
npx davaux-pka . --mode claude-code --watch      # only CLAUDE.md — fastest
npx davaux-pka . --mode multi-tool --watch       # all four agent files re-generated on change
```

After the initial run, pka watches for file changes with a 500ms debounce and re-runs automatically. Changes to the output directory itself are ignored to avoid infinite loops. Press `Ctrl+C` to stop.

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 📅 Changes Since a Git Ref

Generate focused context for code reviews or PR sessions by highlighting only the files that changed:

```bash
npx davaux-pka . --since main        # Files changed since main branch
npx davaux-pka . --since v2.0.0      # Files changed since a tag
npx davaux-pka . --since HEAD~5      # Files changed in the last 5 commits
npx davaux-pka . --since abc1234     # Files changed since a specific commit
```

Adds a **Changes Since** section to `CLAUDE.md` listing the affected files with their types, so the agent immediately knows what's relevant to the current task.

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 📋 Developer Notes (Custom Instructions)

Embed project-specific guidance that survives every re-run — coding conventions, architectural constraints, things your agent should always know:

**Option A — `PKA_INSTRUCTIONS.md`** at your project root (recommended):

```markdown
Always use the repository pattern for database access.
Never import directly from `src/db/` — use the service layer.
All API responses must go through the `ApiResponse` wrapper type.
```

**Option B — `instructions` field in `pka.config.json`**:

```json
{
  "instructions": "Use SurrealDB for all storage. Prefer Hono over Express."
}
```

The content appears as a `## Developer Notes` section near the top of `CLAUDE.md`, in the core section that is never dropped by compact mode.

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🔍 Orphan File Detection

pka flags JS/TS files that nothing imports and that aren't recognized entry points — potential dead code worth reviewing:

```
## ⚠️ Potentially Unused Files (2)

These JS/TS files are not imported by anything and are not recognized entry points.

- `src/utils/legacy-format.ts`
- `src/helpers/old-auth.ts`
```

This surfaces in `CLAUDE.md` automatically whenever orphans are found — no flag needed. TypeScript ESM imports written with `.js` extensions (e.g. `import { Foo } from "./Foo.js"` that resolve to `Foo.ts`) are correctly resolved and do not generate false positives.

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 📊 Context Budget Warnings

When `CLAUDE.md` gets large, pka warns before you hit model context limits:

```
💡 CLAUDE.md is ~82,000 tokens — getting large. Use --compact for token-limited models.
⚠️  CLAUDE.md is ~155,000 tokens — likely too large for a single context window. Consider --compact.
```

Thresholds: **80k tokens** (info) and **150k tokens** (warning). No flag needed — runs automatically after every analysis.

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🤖 Using with Local Models (Ollama, LM Studio, etc.)

Local models often have context windows of 4k–32k tokens — too small for a full `CLAUDE.md` on a real project. Compact mode solves this without losing information.

### Chunk mode (default — lossless)

Splits the output into multiple files, each within the token budget:

```bash
# Default: 8,192 tokens per chunk
npx davaux-pka . --compact

# Custom budget for a smaller model
npx davaux-pka . --compact-tokens 4096
```

This generates:

- `CLAUDE.md` — core context (overview, stack, commands, structure, git summary)
- `CLAUDE-imports.md` — module import graph
- `CLAUDE-symbols.md` — exported functions/classes/types per file
- `CLAUDE-annotations.md` — TODO/FIXME/HACK annotations

Load whichever chunks your model needs for the current task.

### Omit mode (single file)

Drops lowest-priority sections until the whole file fits the budget:

```bash
npx davaux-pka . --compact-tokens 4096 --compact-omit
```

Drop priority (first to go → last to go):  
`annotations` → `orphans` → `git-history` → `dependencies` → `symbols` → `workspaces` → `env` → `since` → `imports` → `claude-config`

### Protect what matters with `--compact-keep`

```bash
# Never drop imports or symbols, even under pressure
npx davaux-pka . --compact-omit --compact-keep "imports,symbols"
```

### Preview before committing

```bash
# Chunk mode preview — see how output splits across files
npx davaux-pka . --compact-preview

# Omit mode preview — see what gets dropped at your budget
npx davaux-pka . --compact-tokens 4096 --compact-omit --compact-preview
```

Chunk mode output:

```
📊 Compact preview (chunk mode): 8,192 token budget

  File                    Tokens   Status
  ─────────────────────────────────────────
  CLAUDE.md (core)         3,200   ✓ fits
  CLAUDE-imports.md        2,100   ✓ fits
  CLAUDE-symbols.md        4,800   ✓ fits
  CLAUDE-annotations.md      680   ✓ fits
  ─────────────────────────────────────────
  Total: ~10,780 tokens across 4 file(s)
```

Omit mode output:

```
📊 Compact preview (omit mode): 4,096 token budget

  Section           Tokens   Status
  ───────────────────────────────────
  Core (always)      1,240   ✓ always kept
  claude-config        340   ✓ kept
  env                  230   ✓ kept
  workspaces           150   ✓ kept
  imports            2,100   ✓ kept
  dependencies         890   ✗ dropped
  git-history          420   ✗ dropped
  annotations          680   ✗ dropped
  ───────────────────────────────────
  Kept: ~4,060 / 4,096 tokens  ✓
```

### XML format

Some models respond better to structured XML context in the Anthropic `<documents>` format:

```bash
npx davaux-pka . --xml
```

Generates `CODEBASE.xml` alongside the usual output files.

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 📊 What's in CLAUDE.md

The generated `CLAUDE.md` includes everything an AI agent needs to understand your project at a glance:

- **Project overview** — name, version, description
- **Tech stack** — auto-detected language, framework, build tool, styling, testing, database
- **Commands** — key npm scripts (dev, build, test, lint, etc.)
- **Project structure** — ASCII directory tree
- **Entry points** — where execution starts
- **Files by type** — grouped list of all analyzed files
- **Dependencies** — runtime and dev dependency lists
- **Git info** — branch, last commit, recent history, remote URL
- **Monorepo/workspace info** — detected sub-packages and tooling
- **Environment variables** — required/optional vars from `.env.example`
- **Circular dependency warnings** — import cycles that may cause issues
- **Import graph** — module dependency relationships
- **Exported symbols** — functions, classes, and types per file
- **AI Assistant Configuration** — MCP servers, permissions, hooks, env keys, and custom slash commands from `.claude/` (when present)
- **Developer Notes** — persistent custom instructions from `PKA_INSTRUCTIONS.md` or `pka.config.json`
- **Orphan files** — JS/TS files not imported by anything and not entry points (when found)
- **Changes since ref** — files changed since a branch/tag/commit, when `--since` is used

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🔍 Detected Stack Coverage

| Category           | Detected Packages                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Frameworks**     | React, Vue, Angular, Svelte, SvelteKit, Next.js, Nuxt, Gatsby, Remix, Astro, SolidJS, Preact, Qwik          |
| **Backend**        | Express, Fastify, NestJS, Koa, Hono, Elysia                                                                 |
| **Mobile/Desktop** | React Native, Expo, Electron, Tauri                                                                         |
| **Build Tools**    | Vite, Webpack, Rollup, Parcel, esbuild, tsup, Turborepo, Nx                                                 |
| **Styling**        | Tailwind CSS, Styled Components, Emotion, Material UI, Chakra UI, Ant Design, DaisyUI, UnoCSS               |
| **Testing**        | Jest, Vitest, Mocha, Testing Library, Cypress, Playwright, Puppeteer, AVA                                   |
| **Databases**      | PostgreSQL, MySQL, SQLite, MongoDB, Redis, Prisma, Drizzle ORM, TypeORM, Sequelize, SurrealDB, Knex, Kysely |
| **Languages**      | TypeScript, Python, Go, Rust, Ruby, Java, PHP, Swift, Kotlin, Dart, Lua                                     |

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🔧 Configuration

### Default Settings

```javascript
{
  maxFileSize: 1048576,           // 1MB per file
  outputDir: './project-knowledge',
  excludePatterns: [
    /node_modules/, /\.git/, /dist/, /build/,
    /coverage/, /\.cache/, /\.vscode/, /\.idea/,
    /\.env$/, /\.log$/, /\.tmp$/
  ],
  includeExtensions: [
    // JavaScript / TypeScript
    '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
    // Web
    '.html', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
    // Data / Config
    '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.xml',
    // Documentation
    '.md', '.mdx', '.txt',
    // Backend languages
    '.py', '.rb', '.go', '.rs', '.java', '.php', '.swift', '.kt', '.dart', '.lua',
    // Shell
    '.sh', '.bash', '.zsh',
    // Database / Schema
    '.sql', '.surql', '.graphql', '.gql', '.prisma',
    // Infrastructure
    '.tf', '.tfvars',
    // Dotfiles
    '.gitignore', '.npmignore', '.dockerignore', '.editorconfig', '.env.example'
  ]
}
```

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🎯 Perfect For

### Modern Web Development

- **React / Vue / Angular / Svelte** applications
- **Node.js / Express / Fastify** backends
- **TypeScript** projects
- **Monorepo** structures with Turborepo or Nx
- **Full-stack** frameworks (Next.js, Nuxt, Remix, SvelteKit)

### AI-Assisted Development

- **Code reviews** with any AI agent
- **Documentation generation**
- **Architecture analysis**
- **Refactoring projects**
- **Learning new codebases**
- **Teams using multiple AI tools** — generate context for Claude, Copilot, Cursor, and Codex in one run
- **Local models** (Ollama, LM Studio) via compact mode for token-limited contexts

### Team Collaboration

- **Onboarding new developers**
- **Code knowledge transfer**
- **Project documentation**
- **Architecture discussions**

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit your changes** (`git commit -m 'Add amazing feature'`)
4. **Push to the branch** (`git push origin feature/amazing-feature`)
5. **Open a Pull Request**

### Development Setup

```bash
git clone https://github.com/davauxjs/project-knowledge-analyzer.git
cd project-knowledge-analyzer
npm install
```

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 📄 License

GPLv3 License — see the [LICENSE](LICENSE) file for details.

<sup>[↑ Back to ToC](#table-of-contents)</sup>

## 🔗 Links

- [GitHub Repository](https://github.com/davauxjs/project-knowledge-analyzer)
- [npm Package](https://www.npmjs.com/package/@davaux/pka)
- [Report Issues](https://github.com/davauxjs/project-knowledge-analyzer/issues)
- [Feature Requests](https://github.com/davauxjs/project-knowledge-analyzer/discussions)

<sup>[↑ Back to ToC](#table-of-contents)</sup>

---
