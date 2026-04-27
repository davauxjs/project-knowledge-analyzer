#!/usr/bin/env node

import * as fs from "node:fs/promises";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

const DEFAULT_EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /dist/,
  /build/,
  /coverage/,
  /\.nyc_output/,
  /\.cache/,
  /\.vscode/,
  /\.idea/,
  /\.DS_Store/,
  /\.env$/,
  /\.log$/,
  /\.pid$/,
  /\.tmp$/,
  /\.temp$/,
];

const DEFAULT_INCLUDE_EXTENSIONS = [
  ".js", ".mjs", ".cjs",
  ".ts", ".mts", ".cts",
  ".jsx", ".tsx",
  ".json", ".jsonc",
  ".md", ".mdx",
  ".txt",
  ".html", ".htm",
  ".css", ".scss", ".sass", ".less",
  ".vue", ".svelte",
  ".yml", ".yaml",
  ".xml",
  ".toml", ".ini",
  ".env.example",
  ".gitignore", ".npmignore", ".dockerignore",
  ".sql", ".surql",
  ".sh", ".bash", ".zsh",
  ".py", ".pyw",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".php",
  ".swift",
  ".kt", ".kts",
  ".dart",
  ".lua",
  ".graphql", ".gql",
  ".prisma",
  ".tf", ".tfvars",
  ".editorconfig", ".prettierrc", ".eslintrc",
];

const ANNOTATION_TAGS = ["TODO", "FIXME", "HACK", "NOTE", "XXX", "BUG", "OPTIMIZE"];

const CONFIG_VERSION = 1;

// Sections dropped first when --compact-omit is active (index 0 = highest priority to drop)
const COMPACT_OMIT_PRIORITY = [
  "annotations", "orphans", "git-history", "dependencies", "symbols",
  "workspaces", "env", "since", "imports", "claude-config",
];

// Token thresholds for context budget warnings
const BUDGET_WARN_TOKENS  = 80_000;   // 💡 getting large
const BUDGET_ERROR_TOKENS = 150_000;  // ⚠️  approaching Claude context limits

class ProjectAnalyzer {
  constructor(options = {}) {
    const mode = options.mode || "flatten";
    const compactTokens = options.compactTokens || 0;
    const compactEnabled = compactTokens > 0 || options.compact || false;

    // Mode-derived capability flags
    const flattenMode = mode === "flatten" || mode === "full"; // writes flattened output to outputDir
    const agentMode = mode !== "flatten";                      // writes agent files to project root

    // Agent file defaults differ by mode:
    //   multi-tool / full → all enabled unless explicitly false
    //   claude-code       → off unless explicitly true
    const multiToolMode = mode === "multi-tool" || mode === "full";
    const resolveAgentFile = (flag) => {
      if (!agentMode) return false;
      return multiToolMode ? flag !== false : flag === true;
    };

    this.options = {
      mode,
      maxFileSize: options.maxFileSize || 1024 * 1024,
      excludePatterns: options.excludePatterns || DEFAULT_EXCLUDE_PATTERNS,
      includeExtensions: options.includeExtensions || DEFAULT_INCLUDE_EXTENSIONS,
      outputDir: options.outputDir || "./project-knowledge",
      includeGitInfo: options.includeGitInfo !== false,
      generateContext: options.generateContext !== false,
      generateConcat: flattenMode && options.generateConcat !== false,
      skipFlatten: !flattenMode || options.skipFlatten || false,
      flattenMode,
      agentMode,
      install: flattenMode && (options.install || false),
      gitignore: flattenMode && !options.noGitignore,
      force: options.force || false,
      compact: compactEnabled,
      compactTokens: compactEnabled ? (compactTokens || 8192) : 0,
      compactOmit: options.compactOmit || false,
      compactKeep: Array.isArray(options.compactKeep) ? options.compactKeep : [],
      compactPreview: options.compactPreview || false,
      hierarchical: agentMode && (options.hierarchical || false),
      scaffoldCommands: agentMode && (options.scaffoldCommands || false),
      xml: flattenMode && (options.xml || false),
      watch: options.watch || false,
      since: options.since || null,
      agentsMd: resolveAgentFile(options.agentsMd),
      copilot: resolveAgentFile(options.copilot),
      cursorRules: resolveAgentFile(options.cursorRules),
      diff: options.diff || false,
    };
    // Always exclude the output directory from scanning to prevent feedback loops
    if (!path.isAbsolute(this.options.outputDir)) {
      const outDirRel = this.options.outputDir
        .replace(/^\.\//, "")
        .replace(/\\/g, "/")
        .replace(/\/$/, "");
      this.options.excludePatterns = [
        ...this.options.excludePatterns,
        new RegExp(`^${outDirRel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$)`),
      ];
    }

    this.fileMap = new Map();
    this.packageJson = null;
    this.gitInfo = null;
    this.stack = null;
    this.importGraph = new Map();
    this.circularDeps = [];
    this.annotations = [];
    this.envVars = [];
    this.workspaces = [];
    this.previousIndex = null;
    this.gitignorePatterns = [];
    this.claudeConfig = null;
    this.orphanFiles = [];
    this.sinceFiles = [];
    this.instructions = "";
    this._docs = null;
    this.stats = {
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      totalSize: 0,
      errors: [],
    };
  }

  // ─── Core ────────────────────────────────────────────────────────────────────

  async analyze(projectPath) {
    const absolutePath = path.resolve(projectPath);
    console.log(`🔍 Analyzing project: ${absolutePath}`);

    if (this.options.flattenMode) {
      await this.ensureOutputDir();
    }

    await Promise.all([
      this.collectGitInfo(absolutePath),
      this.parsePackageJson(absolutePath),
      this.parseGitignore(absolutePath),
      this.parseEnvExample(absolutePath),
      this.detectWorkspaces(absolutePath),
      this.scanClaudeDir(absolutePath),
      this.loadInstructions(absolutePath),
      this.options.diff ? this.loadPreviousIndex() : Promise.resolve(),
    ]);

    if (this.options.since) {
      this.sinceFiles = await this.collectChangedFiles(absolutePath);
    }

    const allFiles = await this.collectAllFiles(absolutePath);
    await this.processAllFiles(allFiles);

    this.buildImportGraph();
    this.detectCircularImports();
    this.detectStack();
    this.extractAnnotations();
    this.orphanFiles = this.detectOrphanFiles();

    if (!this.options.skipFlatten) {
      await this.generateFlattenedFiles();
    }
    if (this.options.generateConcat) {
      await this.generateConcatenatedFile();
    }
    await this.generateDocumentation(absolutePath);
    await this.checkContextBudget(absolutePath);

    // In flatten mode, --install copies CLAUDE.md from outputDir to project root
    if (this.options.install && this.options.generateContext) {
      const dest = path.join(absolutePath, "CLAUDE.md");
      const canInstall = await this.checkInstallGuard(dest);
      if (canInstall) {
        await fs.copyFile(path.join(this.options.outputDir, "CLAUDE.md"), dest);
        console.log(`📌 Installed CLAUDE.md → ${dest}`);
        if (this.options.compact && !this.options.compactOmit) {
          for (const chunk of ["CLAUDE-imports.md", "CLAUDE-symbols.md", "CLAUDE-annotations.md"]) {
            const src = path.join(this.options.outputDir, chunk);
            try {
              await fs.access(src);
              await fs.copyFile(src, path.join(absolutePath, chunk));
              console.log(`📌 Installed ${chunk} → ${path.join(absolutePath, chunk)}`);
            } catch {}
          }
        }
      } else {
        console.log(`⚠️  Skipped install: ${dest} exists and was not generated by pka.`);
        console.log(`   Run with --force to overwrite it.`);
      }
    }
    if (this.options.gitignore) {
      await this.updateGitignore(absolutePath);
    }

    if (this.options.xml) {
      await this.generateXmlFile();
    }
    if (this.options.hierarchical) {
      await this.generateHierarchicalClaudeMds(absolutePath);
    }
    if (this.options.scaffoldCommands) {
      await this.generateCommandStubs(absolutePath);
    }
    if (this.options.agentsMd || this.options.copilot || this.options.cursorRules) {
      await this.generateAgentFiles(absolutePath);
    }

    await this.cleanupStaleFiles(absolutePath);
    this.printSummary();
  }

  async ensureOutputDir() {
    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create output directory: ${error.message}`);
    }
  }

  async cleanupStaleFiles(projectPath) {
    // Every file pka may ever place at the project root
    const ROOT_CANDIDATES = [
      "CLAUDE.md",
      "AGENTS.md",
      "CLAUDE-imports.md",
      "CLAUDE-symbols.md",
      "CLAUDE-annotations.md",
      "CLAUDE-since.md",
      path.join(".github", "copilot-instructions.md"),
      ".cursorrules",
    ];

    // Every known named file pka may place in outputDir (excludes hash-named flattened files)
    const OUTPUTDIR_CANDIDATES = [
      "CLAUDE.md",
      "PROJECT_MAP.md",
      "CODEBASE.txt",
      "CODEBASE.xml",
      "project-index.json",
      "CLAUDE-imports.md",
      "CLAUDE-symbols.md",
      "CLAUDE-annotations.md",
      "CLAUDE-since.md",
    ];

    // Derive which root files this run actually generated
    const expectedRoot = new Set();
    if (this.options.agentMode && this.options.generateContext) {
      expectedRoot.add("CLAUDE.md");
      if (this.options.compact && !this.options.compactOmit) {
        expectedRoot.add("CLAUDE-imports.md");
        expectedRoot.add("CLAUDE-symbols.md");
        expectedRoot.add("CLAUDE-annotations.md");
        if (this.options.since) expectedRoot.add("CLAUDE-since.md");
      }
    }
    if (this.options.agentsMd) expectedRoot.add("AGENTS.md");
    if (this.options.copilot) expectedRoot.add(path.join(".github", "copilot-instructions.md"));
    if (this.options.cursorRules) expectedRoot.add(".cursorrules");

    // Derive which outputDir files this run actually generated
    const expectedOut = new Set();
    if (this.options.flattenMode && !this.options.agentMode) {
      // pure flatten mode — CLAUDE.md lives in outputDir
      if (this.options.generateContext) {
        expectedOut.add("CLAUDE.md");
        if (this.options.compact && !this.options.compactOmit) {
          expectedOut.add("CLAUDE-imports.md");
          expectedOut.add("CLAUDE-symbols.md");
          expectedOut.add("CLAUDE-annotations.md");
          if (this.options.since) expectedOut.add("CLAUDE-since.md");
        }
      }
    }
    if (this.options.flattenMode) {
      expectedOut.add("PROJECT_MAP.md");
      expectedOut.add("project-index.json");
      if (this.options.generateConcat) expectedOut.add("CODEBASE.txt");
      if (this.options.xml) expectedOut.add("CODEBASE.xml");
    }

    const isPkaOwned = (content, filePath) => {
      if (filePath.endsWith(".json")) {
        try { return JSON.parse(content)._pkaGenerated === true; } catch { return false; }
      }
      return content.includes("<!-- pka-generated -->");
    };

    const remove = async (fullPath, label) => {
      try {
        const content = await fs.readFile(fullPath, "utf8");
        if (isPkaOwned(content, fullPath)) {
          await fs.unlink(fullPath);
          console.log(`🧹 Removed stale: ${label}`);
          return true;
        }
      } catch { /* file doesn't exist or unreadable */ }
      return false;
    };

    let cleaned = 0;

    for (const rel of ROOT_CANDIDATES) {
      if (!expectedRoot.has(rel)) {
        if (await remove(path.join(projectPath, rel), rel)) cleaned++;
      }
    }

    for (const rel of OUTPUTDIR_CANDIDATES) {
      if (!expectedOut.has(rel)) {
        if (await remove(path.join(this.options.outputDir, rel), path.join(this.options.outputDir, rel))) cleaned++;
      }
    }

    if (cleaned > 0) console.log(`🧹 Cleaned up ${cleaned} stale pka-generated file(s)`);

    // If this run didn't write to outputDir, warn if it still has content (e.g. flattened files)
    if (!this.options.flattenMode) {
      try {
        const entries = await fs.readdir(path.resolve(this.options.outputDir));
        if (entries.length > 0) {
          console.log(`💡 "${this.options.outputDir}" contains files from a prior flatten run — remove it if no longer needed`);
        }
      } catch { /* directory doesn't exist */ }
    }
  }

  // ─── Metadata Collection ─────────────────────────────────────────────────────

  async collectGitInfo(projectPath) {
    if (!this.options.includeGitInfo) return;
    const run = (cmd) => {
      try {
        return execSync(cmd, {
          cwd: projectPath,
          stdio: ["pipe", "pipe", "pipe"],
        })
          .toString()
          .trim();
      } catch {
        return "";
      }
    };

    const branch = run("git rev-parse --abbrev-ref HEAD");
    if (!branch) return;

    this.gitInfo = {
      branch,
      lastCommit: run("git log -1 --format=%H"),
      lastCommitMessage: run("git log -1 --format=%s"),
      lastCommitDate: run("git log -1 --format=%ci"),
      lastCommitAuthor: run("git log -1 --format=%an"),
      recentCommits: run("git log --oneline -10"),
      remoteUrl: run("git remote get-url origin"),
    };
  }

  async parsePackageJson(projectPath) {
    try {
      const content = await fs.readFile(
        path.join(projectPath, "package.json"),
        "utf8",
      );
      this.packageJson = JSON.parse(content);
    } catch {
      // No package.json or invalid JSON
    }
  }

  async parseGitignore(projectPath) {
    try {
      const content = await fs.readFile(
        path.join(projectPath, ".gitignore"),
        "utf8",
      );
      this.gitignorePatterns = content
        .split("\n")
        .map((line) => this.gitignoreLineToRegex(line.trim()))
        .filter(Boolean);
    } catch {
      // No .gitignore
    }
  }

  gitignoreLineToRegex(line) {
    if (!line || line.startsWith("#") || line.startsWith("!")) return null;

    const anchored = line.startsWith("/");
    if (anchored) line = line.slice(1);
    if (line.endsWith("/")) line = line.slice(0, -1);
    if (!line) return null;

    let regex = "";
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === "*" && line[i + 1] === "*") {
        regex += ".*";
        i += 2;
        if (line[i] === "/") i++;
      } else if (ch === "*") {
        regex += "[^/]*";
        i++;
      } else if (ch === "?") {
        regex += "[^/]";
        i++;
      } else {
        regex += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        i++;
      }
    }

    return anchored
      ? new RegExp(`^${regex}(/|$)`)
      : new RegExp(`(^|/)${regex}(/|$)`);
  }

  async parseEnvExample(projectPath) {
    try {
      const content = await fs.readFile(
        path.join(projectPath, ".env.example"),
        "utf8",
      );
      const vars = [];
      let lastComment = "";

      for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (!line) { lastComment = ""; continue; }
        if (line.startsWith("#")) {
          lastComment = line.slice(1).trim();
          continue;
        }
        const eqIdx = line.indexOf("=");
        if (eqIdx !== -1) {
          const name = line.slice(0, eqIdx).trim();
          const value = line.slice(eqIdx + 1).trim();
          vars.push({ name, hasDefault: value !== "", description: lastComment });
          lastComment = "";
        }
      }

      this.envVars = vars;
    } catch {
      // No .env.example
    }
  }

  async detectWorkspaces(projectPath) {
    const workspaces = [];

    if (this.packageJson?.workspaces) {
      const patterns = Array.isArray(this.packageJson.workspaces)
        ? this.packageJson.workspaces
        : this.packageJson.workspaces.packages || [];
      if (patterns.length)
        workspaces.push({ type: "npm/yarn workspaces", patterns });
    }

    try {
      const raw = await fs.readFile(
        path.join(projectPath, "pnpm-workspace.yaml"),
        "utf8",
      );
      const matches = raw.match(/^\s+-\s+['"]?([^'"#\n]+?)['"]?\s*$/gm) || [];
      const patterns = matches.map((l) =>
        l.replace(/^\s+-\s+['"]?|['"]?\s*$/g, "").trim(),
      );
      if (patterns.length) workspaces.push({ type: "pnpm", patterns });
    } catch {}

    try {
      const lerna = JSON.parse(
        await fs.readFile(path.join(projectPath, "lerna.json"), "utf8"),
      );
      if (lerna.packages)
        workspaces.push({ type: "Lerna", patterns: lerna.packages });
    } catch {}

    for (const [tool, file] of [["Turborepo", "turbo.json"], ["Nx", "nx.json"]]) {
      try {
        await fs.access(path.join(projectPath, file));
        workspaces.push({ type: tool, patterns: [`(see ${file})`] });
      } catch {}
    }

    this.workspaces = workspaces;
  }

  async loadPreviousIndex() {
    try {
      const content = await fs.readFile(
        path.join(this.options.outputDir, "project-index.json"),
        "utf8",
      );
      const index = JSON.parse(content);
      this.previousIndex = {
        generatedAt: index.generatedAt,
        files: new Map(index.files.map((f) => [f.originalPath, f])),
      };
    } catch {
      // No previous index
    }
  }

  async loadInstructions(projectPath) {
    // PKA_INSTRUCTIONS.md takes precedence over pka.config.json instructions field
    try {
      this.instructions = await fs.readFile(path.join(projectPath, "PKA_INSTRUCTIONS.md"), "utf8");
      return;
    } catch {}
    // Fall back to inline instructions string in pka.config.json
    try {
      const cfg = JSON.parse(await fs.readFile(path.join(projectPath, "pka.config.json"), "utf8"));
      if (cfg.instructions) this.instructions = cfg.instructions;
    } catch {}
  }

  async collectChangedFiles(projectPath) {
    try {
      const out = execSync(`git diff --name-only ${this.options.since}`, {
        cwd: projectPath,
        stdio: ["pipe", "pipe", "pipe"],
      }).toString().trim();
      return out ? out.split("\n").map((f) => f.trim()).filter(Boolean) : [];
    } catch {
      console.warn(`⚠️  Could not resolve git ref "${this.options.since}" — --since skipped`);
      return [];
    }
  }

  detectOrphanFiles() {
    const jsExts = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);
    const imported = new Set();
    for (const [, imps] of this.importGraph) {
      for (const imp of imps) imported.add(imp);
    }
    const entryPoints = new Set(this.detectEntryPoints());
    const orphans = [];
    for (const [filePath, info] of this.fileMap) {
      if (!jsExts.has(info.extension)) continue;
      if (imported.has(filePath)) continue;
      if (entryPoints.has(filePath)) continue;
      orphans.push(filePath);
    }
    return orphans.sort();
  }

  async checkContextBudget(projectPath) {
    if (!this.options.generateContext) return;
    try {
      const outBase = this.options.agentMode ? projectPath : this.options.outputDir;
      const content = await fs.readFile(path.join(outBase, "CLAUDE.md"), "utf8");
      const tokens = this.estimateTokens(content.length);
      if (tokens >= BUDGET_ERROR_TOKENS) {
        console.warn(`⚠️  CLAUDE.md is ~${tokens.toLocaleString()} tokens — likely too large for a single context window. Consider --compact.`);
      } else if (tokens >= BUDGET_WARN_TOKENS) {
        console.log(`💡 CLAUDE.md is ~${tokens.toLocaleString()} tokens — getting large. Use --compact for token-limited models.`);
      }
    } catch {}
  }

  async scanClaudeDir(projectPath) {
    const claudeDir = path.join(projectPath, ".claude");
    const result = { settings: null, localSettings: null, commands: [] };

    try {
      result.settings = JSON.parse(
        await fs.readFile(path.join(claudeDir, "settings.json"), "utf8"),
      );
    } catch {}

    try {
      result.localSettings = JSON.parse(
        await fs.readFile(path.join(claudeDir, "settings.local.json"), "utf8"),
      );
    } catch {}

    try {
      const entries = await fs.readdir(path.join(claudeDir, "commands"), {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const content = await fs.readFile(
          path.join(claudeDir, "commands", entry.name),
          "utf8",
        );
        const commandName = entry.name.replace(/\.md$/, "");
        const firstLine = content
          .split("\n")
          .find((l) => l.trim() && !l.startsWith("---"));
        result.commands.push({
          name: commandName,
          description: firstLine?.replace(/^#+\s*/, "").trim() || "",
        });
      }
    } catch {}

    const hasContent =
      result.settings || result.localSettings || result.commands.length > 0;
    if (hasContent) this.claudeConfig = result;
  }

  async updateGitignore(projectPath) {
    const outDir = path.relative(projectPath, path.resolve(this.options.outputDir));
    if (!outDir || outDir.startsWith("..")) return; // outputDir is outside project — skip

    const entry = outDir.replace(/\\/g, "/"); // normalize for .gitignore
    const gitignorePath = path.join(projectPath, ".gitignore");

    let existing = "";
    try {
      existing = await fs.readFile(gitignorePath, "utf8");
    } catch {
      // No .gitignore yet — will be created by appendFile
    }

    // Normalize each line for comparison: strip leading slash and trailing slash
    const normalize = (s) => s.trim().replace(/^\//, "").replace(/\/$/, "");
    const normalizedEntry = normalize(entry);
    const alreadyPresent = existing
      .split("\n")
      .some((line) => normalize(line) === normalizedEntry);

    if (alreadyPresent) return;

    const addition = `\n# Project Knowledge Analyzer output\n${entry}/\n`;
    await fs.appendFile(gitignorePath, addition, "utf8");
    console.log(`📝 Added ${entry}/ to .gitignore`);
  }

  async checkInstallGuard(dest) {
    try {
      const existing = await fs.readFile(dest, "utf8");
      // Our generated files always contain this marker
      if (existing.includes("<!-- pka-generated -->")) return true;
      // User-written — require --force
      return this.options.force;
    } catch {
      return true; // File doesn't exist yet
    }
  }

  // ─── Stack Detection ──────────────────────────────────────────────────────────

  detectStack() {
    const stack = {
      language: [],
      frameworks: [],
      testing: [],
      build: [],
      styling: [],
      database: [],
    };

    for (const [, info] of this.fileMap) {
      const lang = {
        ".ts": "TypeScript", ".tsx": "TypeScript",
        ".mts": "TypeScript", ".cts": "TypeScript",
        ".py": "Python", ".pyw": "Python",
        ".go": "Go", ".rs": "Rust", ".java": "Java",
        ".rb": "Ruby", ".php": "PHP", ".swift": "Swift",
        ".kt": "Kotlin", ".kts": "Kotlin",
        ".dart": "Dart", ".lua": "Lua",
      }[info.extension];
      if (lang && !stack.language.includes(lang)) stack.language.push(lang);
    }
    if (!stack.language.length) stack.language.push("JavaScript");

    if (this.packageJson) {
      const allDeps = {
        ...this.packageJson.dependencies,
        ...this.packageJson.devDependencies,
        ...this.packageJson.peerDependencies,
      };

      const check = (map, target) => {
        for (const [dep, label] of Object.entries(map)) {
          if (allDeps[dep] && !target.includes(label)) target.push(label);
        }
      };

      check({
        react: "React", vue: "Vue.js", "@angular/core": "Angular",
        svelte: "Svelte", "@sveltejs/kit": "SvelteKit",
        next: "Next.js", nuxt: "Nuxt.js", gatsby: "Gatsby",
        "@remix-run/react": "Remix", astro: "Astro",
        "solid-js": "SolidJS", preact: "Preact", qwik: "Qwik",
        express: "Express.js", fastify: "Fastify", "@nestjs/core": "NestJS",
        koa: "Koa", hono: "Hono", elysia: "Elysia",
        electron: "Electron", "@tauri-apps/api": "Tauri",
        expo: "Expo", "react-native": "React Native",
      }, stack.frameworks);

      check({
        jest: "Jest", vitest: "Vitest", mocha: "Mocha",
        "@testing-library/react": "Testing Library",
        cypress: "Cypress", "@playwright/test": "Playwright",
        puppeteer: "Puppeteer", ava: "AVA",
      }, stack.testing);

      check({
        vite: "Vite", webpack: "Webpack", rollup: "Rollup",
        parcel: "Parcel", esbuild: "esbuild", tsup: "tsup",
        turbo: "Turborepo", nx: "Nx",
      }, stack.build);

      check({
        tailwindcss: "Tailwind CSS", "@tailwindcss/vite": "Tailwind CSS",
        "styled-components": "Styled Components", "@emotion/react": "Emotion",
        bootstrap: "Bootstrap", antd: "Ant Design",
        "@mui/material": "Material UI", "@chakra-ui/react": "Chakra UI",
        daisyui: "DaisyUI", unocss: "UnoCSS",
      }, stack.styling);

      check({
        mongoose: "MongoDB (Mongoose)", mongodb: "MongoDB",
        pg: "PostgreSQL", mysql2: "MySQL",
        "better-sqlite3": "SQLite", sqlite3: "SQLite",
        "@prisma/client": "Prisma", "drizzle-orm": "Drizzle ORM",
        typeorm: "TypeORM", sequelize: "Sequelize",
        redis: "Redis", ioredis: "Redis (ioredis)",
        "@surrealdb/node": "SurrealDB", surrealdb: "SurrealDB",
        knex: "Knex.js", kysely: "Kysely",
      }, stack.database);

      if (allDeps.typescript && !stack.language.includes("TypeScript")) {
        stack.language.push("TypeScript");
        const jsIdx = stack.language.indexOf("JavaScript");
        if (jsIdx !== -1) stack.language.splice(jsIdx, 1);
      }

      for (const key of Object.keys(stack)) {
        stack[key] = [...new Set(stack[key])];
      }
    }

    this.stack = stack;
  }

  // ─── File Collection & Processing ────────────────────────────────────────────

  async collectAllFiles(dirPath, relativePath = "") {
    const files = [];
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const subdirTasks = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path
          .join(relativePath, entry.name)
          .replace(/\\/g, "/");

        if (this.shouldExclude(relPath)) {
          this.stats.skippedFiles++;
          continue;
        }

        if (entry.isDirectory()) {
          subdirTasks.push(this.collectAllFiles(fullPath, relPath));
        } else if (entry.isFile()) {
          files.push({ fullPath, relativePath: relPath });
        }
      }

      const nested = await Promise.all(subdirTasks);
      for (const batch of nested) files.push(...batch);
    } catch (error) {
      this.stats.errors.push(`Error scanning ${dirPath}: ${error.message}`);
    }
    return files;
  }

  async processAllFiles(files) {
    const CONCURRENCY = 20;
    const showProgress = files.length > 30;

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map((f) => this.processFile(f.fullPath, f.relativePath)),
      );

      if (showProgress) {
        const done = Math.min(i + CONCURRENCY, files.length);
        process.stdout.write(
          `\r  📄 ${done}/${files.length} files scanned...`,
        );
      }
    }

    if (showProgress) {
      process.stdout.write(
        `\r  📄 ${files.length}/${files.length} files scanned.   \n`,
      );
    }
  }

  shouldExclude(relativePath) {
    if (this.options.excludePatterns.some((p) => p.test(relativePath)))
      return true;
    if (this.gitignorePatterns.some((p) => p.test(relativePath))) return true;
    return false;
  }

  async processFile(fullPath, relativePath) {
    try {
      this.stats.totalFiles++;

      const stats = await fs.stat(fullPath);
      this.stats.totalSize += stats.size;

      if (stats.size > this.options.maxFileSize) {
        this.stats.skippedFiles++;
        this.stats.errors.push(
          `File too large (${this.formatBytes(stats.size)}): ${relativePath}`,
        );
        return;
      }

      const ext = path.extname(relativePath).toLowerCase();
      if (
        !this.options.includeExtensions.includes(ext) &&
        !this.isSpecialFile(relativePath)
      ) {
        this.stats.skippedFiles++;
        return;
      }

      if (await this.isBinaryFile(fullPath)) {
        this.stats.skippedFiles++;
        return;
      }

      const content = await fs.readFile(fullPath, "utf8");
      const pathHash = crypto
        .createHash("md5")
        .update(relativePath)
        .digest("hex")
        .substring(0, 8);
      const contentHash = crypto
        .createHash("md5")
        .update(content)
        .digest("hex")
        .substring(0, 8);
      const flatName = this.generateFlatName(relativePath, pathHash);
      const symbols = this.extractSymbols(content, ext);

      this.fileMap.set(relativePath, {
        originalPath: relativePath,
        flatName,
        fullPath,
        content,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        extension: ext,
        hash: pathHash,
        contentHash,
        lastModified: stats.mtime,
        type: this.getFileType(relativePath, content),
        symbols,
      });

      this.stats.processedFiles++;
    } catch (error) {
      this.stats.errors.push(
        `Error processing ${relativePath}: ${error.message}`,
      );
    }
  }

  async isBinaryFile(fullPath) {
    try {
      const handle = await fs.open(fullPath, "r");
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await handle.read(buffer, 0, 512, 0);
      await handle.close();
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  isSpecialFile(relativePath) {
    const basename = path.basename(relativePath);
    return [
      ".gitignore", ".npmignore", ".dockerignore",
      ".editorconfig", ".prettierrc", ".eslintrc",
      "Dockerfile", "Makefile", "Procfile",
    ].includes(basename);
  }

  // ─── Analysis ────────────────────────────────────────────────────────────────

  buildImportGraph() {
    const importRe = [
      /import\s+(?:[\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const [filePath, fileInfo] of this.fileMap) {
      if (
        ![".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"].includes(
          fileInfo.extension,
        )
      )
        continue;

      const imports = new Set();
      for (const re of importRe) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(fileInfo.content)) !== null) {
          const imp = m[1];
          if (!imp.startsWith(".")) continue;
          const dir = path.posix.dirname(filePath);
          const resolved = path.posix.join(dir, imp);
          const actual = this.resolveImport(resolved);
          if (actual) imports.add(actual);
        }
      }

      if (imports.size > 0) this.importGraph.set(filePath, [...imports]);
    }
  }

  resolveImport(importPath) {
    if (this.fileMap.has(importPath)) return importPath;
    // TypeScript ESM: imports written as .js/.mjs/.cjs may resolve to .ts/.mts/.cts
    const jsToTs = [[".js", ".ts"], [".js", ".tsx"], [".mjs", ".mts"], [".cjs", ".cts"]];
    for (const [jsExt, tsExt] of jsToTs) {
      if (importPath.endsWith(jsExt)) {
        const tsPath = importPath.slice(0, -jsExt.length) + tsExt;
        if (this.fileMap.has(tsPath)) return tsPath;
      }
    }
    const tryExts = [
      ".js", ".ts", ".jsx", ".tsx", ".mjs", ".mts",
      "/index.js", "/index.ts", "/index.tsx",
    ];
    for (const ext of tryExts) {
      if (this.fileMap.has(importPath + ext)) return importPath + ext;
    }
    return null;
  }

  extractSymbols(content, ext) {
    if (
      ![".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"].includes(
        ext,
      )
    )
      return [];

    const symbols = [];
    const patterns = [
      /export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+(\w+)/g,
      /export\s+(?:const|let|var)\s+(\w+)/g,
      /export\s+(?:type|interface|enum)\s+(\w+)/g,
    ];
    const namedRe = /export\s*\{\s*([^}]+)\}/g;

    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) symbols.push(m[1]);
    }

    namedRe.lastIndex = 0;
    let m;
    while ((m = namedRe.exec(content)) !== null) {
      const names = m[1]
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/).pop().trim());
      symbols.push(...names.filter(Boolean));
    }

    return [...new Set(symbols)].filter(Boolean);
  }

  detectCircularImports() {
    const visited = new Set();
    const inStack = new Set();
    const cycles = [];

    const dfs = (node, stack) => {
      if (inStack.has(node)) {
        const start = stack.indexOf(node);
        cycles.push([...stack.slice(start), node]);
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      stack.push(node);
      for (const imp of this.importGraph.get(node) || []) dfs(imp, stack);
      stack.pop();
      inStack.delete(node);
    };

    for (const node of this.importGraph.keys()) {
      if (!visited.has(node)) dfs(node, []);
    }

    this.circularDeps = cycles;
  }

  extractAnnotations() {
    const tagPattern = ANNOTATION_TAGS.join("|");
    const re = new RegExp(
      `(?:\\/\\/|#|--|\\*)\\s*(${tagPattern})[:\\s]+(.+)`,
      "gi",
    );

    for (const [filePath, fileInfo] of this.fileMap) {
      const lines = fileInfo.content.split("\n");
      lines.forEach((line, idx) => {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (m) {
          this.annotations.push({
            file: filePath,
            line: idx + 1,
            type: m[1].toUpperCase(),
            text: m[2].trim(),
          });
        }
      });
    }
  }

  detectEntryPoints() {
    const entryNames = ["index", "main", "app", "server", "client", "entry"];
    const entryDirs = ["", "src", "lib", "app"];
    const found = [];

    for (const [filePath, info] of this.fileMap) {
      const base = path.posix
        .basename(filePath, info.extension)
        .toLowerCase();
      const dir = path.posix.dirname(filePath).toLowerCase();
      const topDir = dir === "." ? "" : dir.split("/")[0];
      if (entryNames.includes(base) && entryDirs.includes(topDir))
        found.push(filePath);
    }

    const extra = [];
    if (this.packageJson?.main) extra.push(this.packageJson.main);
    if (this.packageJson?.module) extra.push(this.packageJson.module);

    return [...new Set([...extra, ...found])];
  }

  computeDiff() {
    if (!this.previousIndex) return null;

    const prev = this.previousIndex.files;
    const newFiles = [];
    const modifiedFiles = [];
    const deletedFiles = [];

    for (const [filePath, info] of this.fileMap) {
      if (!prev.has(filePath)) {
        newFiles.push(filePath);
      } else if (prev.get(filePath).contentHash !== info.contentHash) {
        modifiedFiles.push(filePath);
      }
    }

    for (const [filePath] of prev) {
      if (!this.fileMap.has(filePath)) deletedFiles.push(filePath);
    }

    return {
      since: this.previousIndex.generatedAt,
      newFiles,
      modifiedFiles,
      deletedFiles,
      unchanged: this.fileMap.size - newFiles.length - modifiedFiles.length,
    };
  }

  // ─── Output Generation ───────────────────────────────────────────────────────

  async generateFlattenedFiles() {
    console.log("📁 Generating flattened files...");
    await Promise.all(
      Array.from(this.fileMap.values()).map(async (fileInfo) => {
        const outputPath = path.join(this.options.outputDir, fileInfo.flatName);
        const header = this.generateFileHeader(fileInfo);
        const content = header ? header + fileInfo.content : fileInfo.content;
        await fs.writeFile(outputPath, content, "utf8");
      }),
    );
  }

  async generateConcatenatedFile() {
    console.log("📦 Generating concatenated codebase file...");

    const sorted = Array.from(this.fileMap.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    const totalChars = sorted.reduce((n, [, f]) => n + f.content.length, 0);
    const sep = "=".repeat(80);

    const header = [
      `PROJECT CODEBASE`,
      `Generated: ${new Date().toISOString()}`,
      `Project: ${this.packageJson?.name || "unknown"}`,
      `Files: ${sorted.length} | Estimated Tokens: ~${this.estimateTokens(totalChars).toLocaleString()}`,
      "",
      "This file contains all project source files concatenated for AI context.",
      "Each file is separated by a header line showing its path, type, and size.",
    ].join("\n");

    const parts = [`${sep}\n${header}\n${sep}\n`];

    for (const [, fileInfo] of sorted) {
      const meta = [
        `FILE: ${fileInfo.originalPath}`,
        `TYPE: ${fileInfo.type} | SIZE: ${this.formatBytes(fileInfo.size)}`,
        fileInfo.symbols?.length
          ? `EXPORTS: ${fileInfo.symbols.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      parts.push(`\n${sep}\n${meta}\n${sep}\n\n${fileInfo.content}\n`);
    }

    await fs.writeFile(
      path.join(this.options.outputDir, "CODEBASE.txt"),
      parts.join(""),
      "utf8",
    );
  }

  async generateDocumentation(projectPath) {
    console.log("📚 Generating documentation...");

    // CLAUDE.md goes to project root in agent modes; to outputDir in flatten mode
    const claudeMdBase = this.options.agentMode ? projectPath : this.options.outputDir;

    const entryPoints = this.detectEntryPoints();
    const diff = this.options.diff ? this.computeDiff() : null;

    const docs = {
      projectMap: this.generateProjectMap(),
      fileIndex: this.generateFileIndex(),
      typeMap: this.generateTypeMap(),
      entryPoints,
      importGraph: this.buildImportGraphMarkdown(),
      symbolMap: this.buildSymbolMapMarkdown(),
      circularDeps: this.buildCircularDepsMarkdown(),
      annotations: this.buildAnnotationsMarkdown(),
      envVars: this.buildEnvVarsMarkdown(),
      workspaces: this.buildWorkspacesMarkdown(),
      claudeConfig: this.buildClaudeConfigMarkdown(),
      gitHistory: this.buildGitHistoryMarkdown(),
      dependencies: this.buildDependenciesMarkdown(),
      orphans: this.buildOrphanFilesMarkdown(),
      since: this.buildSinceMarkdown(),
      instructions: this.buildInstructionsMarkdown(),
      diff: this.buildDiffMarkdown(diff),
    };

    const writes = [];

    if (this.options.generateContext) {
      if (this.options.compactPreview) {
        this.printCompactPreview(docs, projectPath);
      }
      if (this.options.compact && !this.options.compactOmit) {
        const chunks = this.buildClaudeMdChunked(docs, projectPath);
        for (const [name, content] of Object.entries(chunks)) {
          writes.push(fs.writeFile(path.join(claudeMdBase, name), content, "utf8"));
        }
      } else if (this.options.compact && this.options.compactOmit) {
        writes.push(
          fs.writeFile(
            path.join(claudeMdBase, "CLAUDE.md"),
            this.buildClaudeMdOmit(docs, projectPath),
            "utf8",
          ),
        );
      } else {
        writes.push(
          fs.writeFile(
            path.join(claudeMdBase, "CLAUDE.md"),
            this.buildClaudeMd(docs, projectPath),
            "utf8",
          ),
        );
      }
    }

    if (this.options.flattenMode) {
      writes.push(
        fs.writeFile(
          path.join(this.options.outputDir, "PROJECT_MAP.md"),
          this.buildProjectMapDoc(docs, projectPath),
          "utf8",
        ),
        fs.writeFile(
          path.join(this.options.outputDir, "project-index.json"),
          JSON.stringify(this.buildJsonIndex(entryPoints, diff), null, 2),
          "utf8",
        ),
      );
    }

    await Promise.all(writes);
    this._docs = docs; // retained for generateAgentFiles after this method returns
  }

  buildJsonIndex(entryPoints, diff) {
    return {
      _pkaGenerated: true,
      generatedAt: new Date().toISOString(),
      project: this.packageJson
        ? {
            name: this.packageJson.name,
            version: this.packageJson.version,
            description: this.packageJson.description,
          }
        : null,
      stack: this.stack,
      git: this.gitInfo,
      workspaces: this.workspaces,
      envVars: this.envVars,
      circularDeps: this.circularDeps,
      annotationCounts: ANNOTATION_TAGS.reduce((acc, tag) => {
        acc[tag] = this.annotations.filter((a) => a.type === tag).length;
        return acc;
      }, {}),
      diff: diff
        ? {
            since: diff.since,
            new: diff.newFiles.length,
            modified: diff.modifiedFiles.length,
            deleted: diff.deletedFiles.length,
            unchanged: diff.unchanged,
          }
        : null,
      stats: this.stats,
      entryPoints,
      importGraph: Object.fromEntries(this.importGraph),
      files: Array.from(this.fileMap.entries()).map(([filePath, info]) => ({
        originalPath: filePath,
        flatName: info.flatName,
        type: info.type,
        size: info.size,
        mtimeMs: info.mtimeMs,
        hash: info.hash,
        contentHash: info.contentHash,
        symbols: info.symbols,
        imports: this.importGraph.get(filePath) || [],
      })),
    };
  }

  // ─── File Header ─────────────────────────────────────────────────────────────

  generateFileHeader(fileInfo) {
    const style = this.getCommentStyle(fileInfo.extension);
    if (style === "none") return null;

    const meta = [
      `Original Path: ${fileInfo.originalPath}`,
      `File Type: ${fileInfo.type}`,
      `Size: ${this.formatBytes(fileInfo.size)}`,
      `Last Modified: ${fileInfo.lastModified.toISOString()}`,
      `Hash: ${fileInfo.hash}`,
    ];
    if (fileInfo.symbols?.length > 0) {
      meta.push(`Exports: ${fileInfo.symbols.join(", ")}`);
    }

    switch (style) {
      case "block":
        return `/**\n${meta.map((m) => ` * ${m}`).join("\n")}\n */\n\n`;
      case "slash":
        return `${meta.map((m) => `// ${m}`).join("\n")}\n\n`;
      case "html":
        return `<!--\n${meta.map((m) => `  ${m}`).join("\n")}\n-->\n\n`;
      case "sql":
        return `${meta.map((m) => `-- ${m}`).join("\n")}\n\n`;
      case "hash":
        return `${meta.map((m) => `# ${m}`).join("\n")}\n\n`;
      case "frontmatter": {
        const fmLines = meta.map((m) => {
          const colonIdx = m.indexOf(": ");
          const key = m.slice(0, colonIdx).toLowerCase().replace(/\s+/g, "_");
          const val = m.slice(colonIdx + 2);
          return `${key}: "${val}"`;
        });
        return `---\n${fmLines.join("\n")}\n---\n\n`;
      }
      default:
        return null;
    }
  }

  getCommentStyle(ext) {
    if (
      [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".css", ".scss", ".sass", ".less"].includes(ext)
    )
      return "block";
    if (
      [".go", ".rs", ".java", ".swift", ".kt", ".kts", ".dart", ".php", ".cpp", ".c", ".h", ".prisma"].includes(ext)
    )
      return "slash";
    if ([".html", ".htm", ".vue", ".svelte", ".xml"].includes(ext))
      return "html";
    if ([".sql", ".surql"].includes(ext)) return "sql";
    if ([".md", ".mdx"].includes(ext)) return "frontmatter";
    if ([".json", ".jsonc"].includes(ext)) return "none";
    return "hash";
  }

  // ─── Index Builders ──────────────────────────────────────────────────────────

  generateProjectMap() {
    const tree = {};
    for (const [originalPath] of this.fileMap) {
      const parts = originalPath.split("/");
      let current = tree;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          current[part] = { _file: true, _path: originalPath };
        } else {
          if (!current[part]) current[part] = {};
          current = current[part];
        }
      }
    }
    return tree;
  }

  generateFileIndex() {
    const index = [];
    for (const [originalPath, fileInfo] of this.fileMap) {
      index.push({
        original: originalPath,
        flattened: fileInfo.flatName,
        type: fileInfo.type,
        size: this.formatBytes(fileInfo.size),
        extension: fileInfo.extension,
        symbols:
          fileInfo.symbols?.length > 0 ? fileInfo.symbols.join(", ") : "",
      });
    }
    return index.sort((a, b) => a.original.localeCompare(b.original));
  }

  generateTypeMap() {
    const typeMap = {};
    for (const [, fileInfo] of this.fileMap) {
      if (!typeMap[fileInfo.type]) typeMap[fileInfo.type] = [];
      typeMap[fileInfo.type].push({
        original: fileInfo.originalPath,
        flattened: fileInfo.flatName,
        symbols: fileInfo.symbols,
      });
    }
    return typeMap;
  }

  // ─── Markdown Builders ───────────────────────────────────────────────────────

  buildImportGraphMarkdown() {
    if (this.importGraph.size === 0) return "";
    const lines = ["## Import Graph\n"];
    for (const [file, imports] of this.importGraph) {
      lines.push(`**${file}** imports:`);
      for (const imp of imports) lines.push(`  - \`${imp}\``);
      lines.push("");
    }
    return lines.join("\n");
  }

  buildSymbolMapMarkdown() {
    const lines = ["## Exported Symbols\n"];
    let hasSymbols = false;
    for (const [filePath, fileInfo] of this.fileMap) {
      if (fileInfo.symbols?.length > 0) {
        hasSymbols = true;
        lines.push(`**\`${filePath}\`**`);
        lines.push(fileInfo.symbols.map((s) => `\`${s}\``).join(", "));
        lines.push("");
      }
    }
    return hasSymbols ? lines.join("\n") : "";
  }

  buildCircularDepsMarkdown() {
    if (this.circularDeps.length === 0) return "";
    const lines = [
      `## ⚠️ Circular Dependencies (${this.circularDeps.length})\n`,
    ];
    for (const cycle of this.circularDeps) {
      lines.push(`- ${cycle.map((f) => `\`${f}\``).join(" → ")}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  buildAnnotationsMarkdown() {
    if (this.annotations.length === 0) return "";

    const byType = {};
    for (const a of this.annotations) {
      if (!byType[a.type]) byType[a.type] = [];
      byType[a.type].push(a);
    }

    const lines = [`## Code Annotations (${this.annotations.length} total)\n`];
    for (const [type, items] of Object.entries(byType)) {
      lines.push(`### ${type} (${items.length})`);
      for (const a of items) {
        lines.push(`- \`${a.file}:${a.line}\` — ${a.text}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  buildEnvVarsMarkdown() {
    if (this.envVars.length === 0) return "";
    const lines = [
      `## Environment Variables (${this.envVars.length} required)\n`,
      "| Variable | Required | Description |",
      "|----------|----------|-------------|",
    ];
    for (const v of this.envVars) {
      const req = v.hasDefault ? "Optional" : "**Required**";
      lines.push(`| \`${v.name}\` | ${req} | ${v.description || ""} |`);
    }
    lines.push("");
    return lines.join("\n");
  }

  buildWorkspacesMarkdown() {
    if (this.workspaces.length === 0) return "";
    const lines = ["## Monorepo / Workspaces\n"];
    for (const ws of this.workspaces) {
      lines.push(`### ${ws.type}`);
      for (const p of ws.patterns) lines.push(`- \`${p}\``);
      lines.push("");
    }
    return lines.join("\n");
  }

  buildClaudeConfigMarkdown() {
    if (!this.claudeConfig) return "";

    // Merge settings — local overrides project for display
    const merged = {
      ...this.claudeConfig.settings,
      ...this.claudeConfig.localSettings,
    };
    const { commands } = this.claudeConfig;

    const mcpServers = Object.keys(merged?.mcpServers || {});
    const allowed = merged?.permissions?.allow || [];
    const denied = merged?.permissions?.deny || [];
    const hooks = Object.entries(merged?.hooks || {}).filter(
      ([, handlers]) => handlers?.length,
    );
    const envKeys = Object.keys(merged?.env || {});

    if (!mcpServers.length && !allowed.length && !denied.length &&
        !hooks.length && !commands.length && !envKeys.length) return "";

    const lines = ["## AI Assistant Configuration\n"];

    if (mcpServers.length) {
      lines.push("### MCP Servers");
      for (const name of mcpServers) {
        const cfg = merged.mcpServers[name];
        const desc = cfg?.command
          ? `\`${cfg.command}${cfg.args?.length ? " " + cfg.args.join(" ") : ""}\``
          : "";
        lines.push(`- **${name}**${desc ? ` — ${desc}` : ""}`);
      }
      lines.push("");
    }

    if (allowed.length || denied.length) {
      lines.push("### Permissions");
      if (allowed.length)
        lines.push(`**Allowed**: ${allowed.map((p) => `\`${p}\``).join(", ")}`);
      if (denied.length)
        lines.push(`**Denied**: ${denied.map((p) => `\`${p}\``).join(", ")}`);
      lines.push("");
    }

    if (hooks.length) {
      lines.push("### Hooks");
      for (const [event, handlers] of hooks) {
        lines.push(`- **${event}**: ${handlers.length} handler(s)`);
      }
      lines.push("");
    }

    if (envKeys.length) {
      lines.push("### Environment (set by pka.config.json)");
      for (const key of envKeys) lines.push(`- \`${key}\``);
      lines.push("");
    }

    if (commands.length) {
      lines.push("### Custom Slash Commands");
      for (const cmd of commands) {
        lines.push(
          `- \`/project:${cmd.name}\`${cmd.description ? ` — ${cmd.description}` : ""}`,
        );
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  buildGitHistoryMarkdown() {
    if (!this.gitInfo?.recentCommits) return "";
    return `### Recent Commits\n\`\`\`\n${this.gitInfo.recentCommits}\n\`\`\`\n`;
  }

  buildDependenciesMarkdown() {
    const pkg = this.packageJson;
    if (!pkg) return "";
    const deps = pkg.dependencies ? Object.keys(pkg.dependencies) : [];
    const devDeps = pkg.devDependencies ? Object.keys(pkg.devDependencies) : [];
    if (!deps.length && !devDeps.length) return "";
    const lines = ["## Dependencies\n"];
    if (deps.length) lines.push(`### Runtime\n${deps.join(", ")}`);
    if (devDeps.length) lines.push(`\n### Development\n${devDeps.join(", ")}`);
    lines.push("");
    return lines.join("\n");
  }

  buildInstructionsMarkdown() {
    if (!this.instructions) return "";
    return `## Developer Notes\n\n${this.instructions.trim()}\n`;
  }

  buildOrphanFilesMarkdown() {
    if (this.orphanFiles.length === 0) return "";
    const lines = [
      `## ⚠️ Potentially Unused Files (${this.orphanFiles.length})\n`,
      `_These JS/TS files are not imported by anything and are not recognized entry points._\n`,
    ];
    for (const f of this.orphanFiles) lines.push(`- \`${f}\``);
    lines.push("");
    return lines.join("\n");
  }

  buildSinceMarkdown() {
    if (!this.options.since || this.sinceFiles.length === 0) return "";
    const lines = [`## Changes Since \`${this.options.since}\` (${this.sinceFiles.length} file${this.sinceFiles.length === 1 ? "" : "s"})\n`];
    for (const f of this.sinceFiles) {
      const info = this.fileMap.get(f);
      lines.push(`- \`${f}\`${info ? ` (${info.type})` : ""}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  buildDiffMarkdown(diff) {
    if (!diff) return "";
    const lines = [
      `## Changes Since Last Run\n`,
      `_Compared to index generated at ${diff.since}_\n`,
    ];
    if (diff.newFiles.length) {
      lines.push(`### New Files (${diff.newFiles.length})`);
      diff.newFiles.forEach((f) => lines.push(`- \`${f}\``));
      lines.push("");
    }
    if (diff.modifiedFiles.length) {
      lines.push(`### Modified Files (${diff.modifiedFiles.length})`);
      diff.modifiedFiles.forEach((f) => lines.push(`- \`${f}\``));
      lines.push("");
    }
    if (diff.deletedFiles.length) {
      lines.push(`### Deleted Files (${diff.deletedFiles.length})`);
      diff.deletedFiles.forEach((f) => lines.push(`- \`${f}\``));
      lines.push("");
    }
    lines.push(
      `_${diff.unchanged} files unchanged._\n`,
    );
    return lines.join("\n");
  }

  buildClaudeMd(docs, projectPath, { fullContent = false } = {}) {
    const pkg = this.packageJson;
    const stack = this.stack;
    const git = this.gitInfo;
    const projectName = pkg?.name || path.basename(projectPath);

    const stackLines = [
      stack?.language?.length && `- **Language**: ${stack.language.join(", ")}`,
      stack?.frameworks?.length && `- **Framework**: ${stack.frameworks.join(", ")}`,
      stack?.build?.length && `- **Build Tool**: ${stack.build.join(", ")}`,
      stack?.styling?.length && `- **Styling**: ${stack.styling.join(", ")}`,
      stack?.testing?.length && `- **Testing**: ${stack.testing.join(", ")}`,
      stack?.database?.length && `- **Database**: ${stack.database.join(", ")}`,
    ].filter(Boolean);

    const scripts = pkg?.scripts || {};
    const importantScripts = [
      "dev", "start", "build", "test", "lint",
      "format", "preview", "typecheck", "check",
    ];
    const commandLines = Object.entries(scripts)
      .filter(([k]) => importantScripts.includes(k))
      .map(([k, v]) => `- \`npm run ${k}\` — ${v}`);

    const gitSummary = git
      ? `\n## Git\n- **Branch**: ${git.branch}\n- **Last Commit**: ${git.lastCommitMessage}\n- **Author**: ${git.lastCommitAuthor}\n- **Date**: ${git.lastCommitDate}\n${git.remoteUrl ? `- **Remote**: ${git.remoteUrl}` : ""}\n`
      : "";

    const entrySection = docs.entryPoints.length
      ? docs.entryPoints.map((e) => `- \`${e}\``).join("\n")
      : "- Not detected automatically";

    // fullContent = true overrides chunk mode so agent files always include all sections
    const chunkMode = !fullContent && this.options.compact && !this.options.compactOmit;
    // Always express outputDir relative to project root so paths are actionable from CLAUDE.md
    const outDir = path.relative(projectPath, path.resolve(this.options.outputDir)) || ".";

    let fileMappingSection = "";
    if (this.options.flattenMode) {
      let footerLinks;
      if (chunkMode) {
        footerLinks = [
          `See \`${outDir}/CLAUDE-imports.md\` for the module import graph.`,
          `See \`${outDir}/CLAUDE-symbols.md\` for exported symbols per file.`,
          `See \`${outDir}/CLAUDE-annotations.md\` for code annotations (TODO/FIXME/etc).`,
        ].join("\n");
      } else {
        const links = [
          `See \`${outDir}/PROJECT_MAP.md\` for the full flattened-name → original-path index.`,
        ];
        if (this.options.generateConcat) {
          links.push(`See \`${outDir}/CODEBASE.txt\` for all files concatenated into a single uploadable file.`);
        }
        links.push(`See \`${outDir}/project-index.json\` for programmatic access.`);
        footerLinks = links.join("\n");
      }
      fileMappingSection = `## File Mapping\n\n${footerLinks}\n`;
    }

    return `<!-- pka-generated -->
# ${projectName}

> Generated by Project Knowledge Analyzer on ${new Date().toISOString()}

## Overview

${pkg?.description || "No description provided."}
${pkg?.version ? `\n**Version**: ${pkg.version}` : ""}

## Tech Stack

${stackLines.length ? stackLines.join("\n") : "- Stack not detected (no package.json found)"}

## Commands

${commandLines.length ? commandLines.join("\n") : "- No npm scripts detected"}

## Project Structure

\`\`\`
${this.renderTree(docs.projectMap)}
\`\`\`

## Entry Points

${entrySection}

## Files by Type

${Object.entries(docs.typeMap)
  .map(([type, files]) => {
    const preview = files.slice(0, 15).map((f) => `- \`${f.original}\``).join("\n");
    const overflow = files.length > 15 ? `\n- ...and ${files.length - 15} more` : "";
    return `### ${type.charAt(0).toUpperCase() + type.slice(1)} (${files.length})\n${preview}${overflow}`;
  })
  .join("\n\n")}
${docs.instructions}
${gitSummary}
${docs.gitHistory}
${docs.dependencies}
${docs.workspaces}
${docs.envVars}
${docs.circularDeps}
${docs.orphans}
${docs.claudeConfig}
${chunkMode ? "" : docs.since}
${chunkMode ? "" : docs.importGraph}
${chunkMode ? "" : docs.symbolMap}
${chunkMode ? "" : docs.annotations}
${fileMappingSection}`;
  }

  buildClaudeMdChunked(docs, projectPath) {
    const budget = this.options.compactTokens;
    const chunks = {};

    const coreContent = this.buildClaudeMd(docs, projectPath);
    const coreTokens = this.estimateTokens(coreContent.length);
    if (coreTokens > budget) {
      process.stderr.write(
        `⚠️  CLAUDE.md (~${coreTokens.toLocaleString()} tokens) exceeds compact budget (${budget.toLocaleString()}). Consider raising --compact-tokens.\n`,
      );
    }
    chunks["CLAUDE.md"] = coreContent;

    const projectName = this.packageJson?.name || path.basename(projectPath);
    const supplementary = [
      { file: "CLAUDE-imports.md", title: "Import Graph", content: docs.importGraph },
      { file: "CLAUDE-symbols.md", title: "Exported Symbols", content: docs.symbolMap },
      { file: "CLAUDE-annotations.md", title: "Code Annotations", content: docs.annotations },
      { file: "CLAUDE-since.md", title: `Changes Since \`${this.options.since}\``, content: docs.since },
    ];

    for (const { file, title, content } of supplementary) {
      if (!content?.trim()) continue;
      const tokens = this.estimateTokens(content.length);
      if (tokens > budget) {
        process.stderr.write(
          `⚠️  ${file} (~${tokens.toLocaleString()} tokens) exceeds compact budget (${budget.toLocaleString()}).\n`,
        );
      }
      chunks[file] = `<!-- pka-generated -->
# ${projectName} — ${title}

> Supplementary context for \`${projectName}\`. See \`CLAUDE.md\` for the main project overview.

${content}`;
    }

    return chunks;
  }

  buildClaudeMdOmit(docs, projectPath) {
    const budget = this.options.compactTokens;
    const keep = new Set(this.options.compactKeep);

    const sectionDocKeys = {
      "annotations": "annotations",
      "orphans": "orphans",
      "git-history": "gitHistory",
      "dependencies": "dependencies",
      "symbols": "symbolMap",
      "workspaces": "workspaces",
      "env": "envVars",
      "since": "since",
      "imports": "importGraph",
      "claude-config": "claudeConfig",
    };

    const mutableDocs = { ...docs };

    // Initial size estimate
    let totalChars = this.buildClaudeMd(mutableDocs, projectPath).length;

    // Drop lowest-priority sections until we fit
    for (const sectionName of COMPACT_OMIT_PRIORITY) {
      if (totalChars <= budget * 4) break;
      if (keep.has(sectionName)) continue;
      const key = sectionDocKeys[sectionName];
      if (mutableDocs[key]) {
        totalChars -= mutableDocs[key].length;
        mutableDocs[key] = "";
        console.log(`  🗜️  Compact: omitting "${sectionName}" to fit within ${budget.toLocaleString()} tokens`);
      }
    }

    const finalTokens = this.estimateTokens(totalChars);
    if (finalTokens > budget) {
      console.warn(
        `⚠️  CLAUDE.md (~${finalTokens.toLocaleString()} tokens) still exceeds compact budget (${budget.toLocaleString()}) after all omissions`,
      );
    }

    return this.buildClaudeMd(mutableDocs, projectPath);
  }

  printCompactPreview(docs, projectPath) {
    const budget = this.options.compactTokens;
    const omitMode = this.options.compactOmit;
    const keep = new Set(this.options.compactKeep);
    const mode = omitMode ? "omit" : "chunk";

    console.log(`\n📊 Compact preview (${mode} mode): ${budget.toLocaleString()} token budget\n`);

    if (omitMode) {
      // Core = everything minus the omit-able sections
      const sectionDocKeys = {
        "annotations": "annotations", "orphans": "orphans", "git-history": "gitHistory",
        "dependencies": "dependencies", "symbols": "symbolMap", "workspaces": "workspaces",
        "env": "envVars", "since": "since", "imports": "importGraph", "claude-config": "claudeConfig",
      };
      const coreDoc = { ...docs };
      for (const key of Object.values(sectionDocKeys)) coreDoc[key] = "";
      const coreTokens = this.estimateTokens(this.buildClaudeMd(coreDoc, projectPath).length);

      const rows = [
        { name: "core", label: "Core (always)", tokens: coreTokens, always: true },
        ...COMPACT_OMIT_PRIORITY.slice().reverse().map((name) => ({
          name,
          label: name,
          tokens: this.estimateTokens((docs[sectionDocKeys[name]] || "").length),
        })).filter((r) => r.tokens > 0),
      ];

      // Simulate omit algorithm to determine what's dropped
      let runningTotal = rows.reduce((n, r) => n + r.tokens, 0);
      const dropped = new Set();
      for (const name of COMPACT_OMIT_PRIORITY) {
        if (runningTotal <= budget) break;
        if (keep.has(name)) continue;
        const row = rows.find((r) => r.name === name);
        if (row && row.tokens > 0) {
          runningTotal -= row.tokens;
          dropped.add(name);
        }
      }

      const maxLabel = Math.max(...rows.map((r) => r.label.length));
      console.log(`  ${"Section".padEnd(maxLabel + 2)} ${"Tokens".padStart(8)}   Status`);
      console.log(`  ${"─".repeat(maxLabel + 22)}`);
      for (const r of rows) {
        if (r.tokens === 0 && !r.always) continue;
        const pinned = keep.has(r.name) ? " [pinned]" : "";
        const status = r.always
          ? "✓ always kept"
          : dropped.has(r.name)
          ? "✗ dropped"
          : `✓ kept${pinned}`;
        console.log(`  ${r.label.padEnd(maxLabel + 2)} ${r.tokens.toLocaleString().padStart(8)}   ${status}`);
      }
      console.log(`  ${"─".repeat(maxLabel + 22)}`);
      console.log(`  Kept: ~${runningTotal.toLocaleString()} / ${budget.toLocaleString()} tokens  ${runningTotal <= budget ? "✓" : "⚠️  over budget"}`);
    } else {
      // Chunk mode
      const coreDoc = { ...docs, importGraph: "", symbolMap: "", annotations: "" };
      const coreTokens = this.estimateTokens(this.buildClaudeMd(coreDoc, projectPath).length);
      const rows = [
        { label: "CLAUDE.md (core)", tokens: coreTokens },
        { label: "CLAUDE-imports.md", tokens: this.estimateTokens((docs.importGraph || "").length) },
        { label: "CLAUDE-symbols.md", tokens: this.estimateTokens((docs.symbolMap || "").length) },
        { label: "CLAUDE-annotations.md", tokens: this.estimateTokens((docs.annotations || "").length) },
      ].filter((r) => r.tokens > 0);

      const maxLabel = Math.max(...rows.map((r) => r.label.length));
      console.log(`  ${"File".padEnd(maxLabel + 2)} ${"Tokens".padStart(8)}   Status`);
      console.log(`  ${"─".repeat(maxLabel + 22)}`);
      for (const r of rows) {
        const status = r.tokens <= budget ? "✓ fits" : `⚠️  over budget`;
        console.log(`  ${r.label.padEnd(maxLabel + 2)} ${r.tokens.toLocaleString().padStart(8)}   ${status}`);
      }
      const total = rows.reduce((n, r) => n + r.tokens, 0);
      console.log(`  ${"─".repeat(maxLabel + 22)}`);
      console.log(`  Total: ~${total.toLocaleString()} tokens across ${rows.length} file(s)`);
    }

    console.log("");
  }

  buildProjectMapDoc(docs, projectPath) {
    const pkg = this.packageJson;
    const git = this.gitInfo;
    const stack = this.stack;
    const projectName = pkg?.name || path.basename(projectPath);
    const stackLabel =
      [...(stack?.language || []), ...(stack?.frameworks || [])].join(" + ") ||
      "Unknown";

    const totalContentSize = Array.from(this.fileMap.values()).reduce(
      (n, f) => n + f.content.length,
      0,
    );

    const gitSection = git
      ? `\n## Git Info\n- **Branch**: ${git.branch}\n- **Last Commit**: ${git.lastCommitMessage} (${git.lastCommitDate})\n- **Author**: ${git.lastCommitAuthor}\n\n### Recent History\n\`\`\`\n${git.recentCommits}\n\`\`\`\n`
      : "";

    return `<!-- pka-generated -->
# Project Knowledge Map: ${projectName}

Generated: ${new Date().toISOString()}
${pkg?.version ? `Version: ${pkg.version}` : ""}
Stack: ${stackLabel}

## Statistics
- **Total Files Scanned**: ${this.stats.totalFiles}
- **Files Processed**: ${this.stats.processedFiles}
- **Files Skipped**: ${this.stats.skippedFiles}
- **Total Source Size**: ${this.formatBytes(this.stats.totalSize)}
- **Estimated Tokens**: ~${this.estimateTokens(totalContentSize).toLocaleString()}
- **Errors**: ${this.stats.errors.length}
${gitSection}
${docs.diff}
${docs.workspaces}
## Project Structure
\`\`\`
${this.renderTree(docs.projectMap)}
\`\`\`

## Entry Points
${docs.entryPoints.length ? docs.entryPoints.map((e) => `- \`${e}\``).join("\n") : "- None detected"}

${docs.circularDeps}
${docs.envVars}
${docs.annotations}
## File Index
| Original Path | Flattened Name | Type | Size | Exports |
|---------------|----------------|------|------|---------|
${docs.fileIndex
  .map(
    (f) =>
      `| \`${f.original}\` | \`${f.flattened}\` | ${f.type} | ${f.size} | ${f.symbols || ""} |`,
  )
  .join("\n")}

## Files by Type
${Object.entries(docs.typeMap)
  .map(
    ([type, files]) => `
### ${type.charAt(0).toUpperCase() + type.slice(1)} (${files.length})
${files.map((f) => `- \`${f.flattened}\` ← \`${f.original}\`${f.symbols?.length ? ` *(${f.symbols.join(", ")})*` : ""}`).join("\n")}`,
  )
  .join("\n")}

${docs.importGraph}
${docs.symbolMap}
${this.stats.errors.length > 0 ? `## Errors\n${this.stats.errors.map((e) => `- ${e}`).join("\n")}\n` : ""}
## Usage

### Claude AI Projects
1. Upload \`CODEBASE.txt\` as a single file — it contains your entire codebase
2. Or upload individual flattened files with \`CLAUDE.md\` and \`PROJECT_MAP.md\`
3. \`CLAUDE.md\` gives Claude an instant project overview
4. \`PROJECT_MAP.md\` maps flattened filenames back to original paths

### Local Agent Mode (Claude Code, Cursor, Copilot, etc.)
- Place \`CLAUDE.md\` at your project root: \`npx davaux-pka . --local\`
- Add context files for other agents: \`npx davaux-pka . --local --multi-tool\`
- Re-run with \`--diff\` to see what changed since the last analysis

### File Naming Convention
\`{8-char-hash}_{path-with-underscores}{extension}\`
Example: \`src/components/Button.tsx\` → \`${this.generateFlatName("src/components/Button.tsx", "abc12345")}\`
`;
  }

  // ─── XML / Hierarchical / Command Stubs ──────────────────────────────────────

  async generateXmlFile() {
    console.log("📄 Generating XML codebase file...");
    const sorted = Array.from(this.fileMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    const projectName = this.packageJson?.name || "project";

    const escape = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const lines = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<!-- pka-generated | Project: ${projectName} | Generated: ${new Date().toISOString()} -->`,
      `<documents>`,
    ];

    let index = 1;
    for (const [, f] of sorted) {
      lines.push(`  <document index="${index}">`);
      lines.push(`    <source>${escape(f.originalPath)}</source>`);
      if (f.type) lines.push(`    <type>${f.type}</type>`);
      if (f.symbols?.length) lines.push(`    <exports>${escape(f.symbols.join(", "))}</exports>`);
      lines.push(`    <document_content>`);
      lines.push(escape(f.content));
      lines.push(`    </document_content>`);
      lines.push(`  </document>`);
      index++;
    }

    lines.push(`</documents>`);
    await fs.writeFile(path.join(this.options.outputDir, "CODEBASE.xml"), lines.join("\n"), "utf8");
  }

  async generateHierarchicalClaudeMds(projectPath) {
    const byDir = new Map();
    for (const [, info] of this.fileMap) {
      const dir = path.posix.dirname(info.originalPath);
      if (dir === ".") continue;
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(info);
    }

    if (byDir.size === 0) return;

    const projectName = this.packageJson?.name || path.basename(projectPath);
    let written = 0;

    for (const [dir, files] of byDir) {
      const content = this.buildDirectoryClaude(dir, files, projectName);
      const destDir = path.join(projectPath, dir);
      const destFile = path.join(destDir, "CLAUDE.md");
      try {
        await fs.mkdir(destDir, { recursive: true });
        const canInstall = await this.checkInstallGuard(destFile);
        if (canInstall) {
          await fs.writeFile(destFile, content, "utf8");
          written++;
        }
      } catch (e) {
        this.stats.errors.push(`Hierarchical CLAUDE.md failed for ${dir}: ${e.message}`);
      }
    }

    console.log(`📁 Generated hierarchical CLAUDE.md for ${written} director${written === 1 ? "y" : "ies"}`);
  }

  buildDirectoryClaude(dir, files, projectName) {
    const sorted = files.slice().sort((a, b) => a.originalPath.localeCompare(b.originalPath));
    const lines = [
      `<!-- pka-generated -->`,
      `# ${projectName} — \`${dir}/\``,
      ``,
      `## Files`,
      ``,
    ];

    for (const f of sorted) {
      const base = path.posix.basename(f.originalPath);
      const symbolsStr = f.symbols?.length ? ` — exports: ${f.symbols.join(", ")}` : "";
      lines.push(`- **${base}** (${f.type})${symbolsStr}`);
    }

    const relevantImports = [];
    for (const f of sorted) {
      const imps = this.importGraph.get(f.originalPath);
      if (imps?.length) {
        const base = path.posix.basename(f.originalPath);
        relevantImports.push(`- \`${base}\` → ${imps.map((i) => `\`${i}\``).join(", ")}`);
      }
    }

    if (relevantImports.length) {
      lines.push("", "## Imports", "");
      lines.push(...relevantImports);
    }

    return lines.join("\n") + "\n";
  }

  async generateCommandStubs(projectPath) {
    const scripts = this.packageJson?.scripts || {};
    const targetScripts = [
      "dev", "start", "build", "test", "lint", "format",
      "preview", "typecheck", "check", "deploy", "db", "migrate", "seed",
    ];
    const toScaffold = Object.entries(scripts).filter(([k]) => targetScripts.includes(k));

    if (!toScaffold.length) {
      console.log("💡 No npm scripts found for slash command scaffolding");
      return;
    }

    const commandsDir = path.join(projectPath, ".claude", "commands");

    await fs.mkdir(commandsDir, { recursive: true });

    let created = 0;
    for (const [name, script] of toScaffold) {
      const destFile = path.join(commandsDir, `${name}.md`);
      try {
        await fs.access(destFile);
        continue; // Already exists — don't overwrite custom commands
      } catch {}

      const content = `Run the \`${name}\` npm script for this project.

\`\`\`bash
npm run ${name}
\`\`\`

Script definition: \`${script}\`
`;
      await fs.writeFile(destFile, content, "utf8");
      created++;
    }

    if (created > 0) {
      console.log(`⚡ Scaffolded ${created} slash command stub(s) → ${commandsDir}`);
    } else {
      console.log("💡 Slash command stubs already exist, none created");
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  renderTree(tree, prefix = "") {
    const entries = Object.entries(tree);
    let result = "";
    entries.forEach(([name, value], index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const nextPrefix = prefix + (isLast ? "    " : "│   ");
      if (value._file) {
        result += `${prefix}${connector}${name}\n`;
      } else {
        result += `${prefix}${connector}${name}/\n`;
        result += this.renderTree(value, nextPrefix);
      }
    });
    return result;
  }

  generateFlatName(relativePath, hash) {
    const safeName = relativePath
      .replace(/[/\\]/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    return `${hash}_${safeName}`;
  }

  getFileType(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();
    if (
      [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"].includes(ext)
    ) {
      if (content.includes("export") || content.includes("import"))
        return "module";
      if (content.includes("class ")) return "class";
      if (content.includes("function ")) return "function";
      return "script";
    }
    if ([".json", ".jsonc"].includes(ext)) return "config";
    if ([".md", ".mdx"].includes(ext)) return "documentation";
    if ([".html", ".htm"].includes(ext)) return "template";
    if ([".css", ".scss", ".sass", ".less"].includes(ext)) return "stylesheet";
    if ([".yml", ".yaml", ".toml", ".ini"].includes(ext)) return "config";
    if ([".vue", ".svelte"].includes(ext)) return "component";
    if ([".sql", ".surql"].includes(ext)) return "database";
    if ([".sh", ".bash", ".zsh"].includes(ext)) return "shell";
    if ([".py", ".pyw", ".rb", ".lua"].includes(ext)) return "script";
    if (
      [".go", ".rs", ".java", ".php", ".swift", ".kt", ".kts", ".dart"].includes(ext)
    )
      return "source";
    if ([".graphql", ".gql"].includes(ext)) return "schema";
    if (ext === ".prisma") return "schema";
    if ([".tf", ".tfvars"].includes(ext)) return "infrastructure";
    return "other";
  }

  estimateTokens(charCount) {
    return Math.round(charCount / 4);
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  async generateAgentFiles(projectPath) {
    if (!this._docs) return; // nothing generated (--no-context was set)

    // Always build the full content regardless of compact/chunk mode — cloud agents
    // (Copilot, Codex, etc.) have no token restrictions, so they should always get
    // the complete context rather than a chunked or truncated version.
    const content = this.buildClaudeMd(this._docs, projectPath, { fullContent: true });

    if (this.options.agentsMd) {
      const dest = path.join(projectPath, "AGENTS.md");
      const canWrite = await this.checkInstallGuard(dest);
      if (canWrite) {
        await fs.writeFile(dest, content, "utf8");
        console.log(`📌 Installed AGENTS.md → ${dest}`);
      } else {
        console.log(`⚠️  Skipped AGENTS.md: exists and was not generated by pka. Use --force to overwrite.`);
      }
    }

    if (this.options.copilot) {
      const ghDir = path.join(projectPath, ".github");
      await fs.mkdir(ghDir, { recursive: true });
      const dest = path.join(ghDir, "copilot-instructions.md");
      const canWrite = await this.checkInstallGuard(dest);
      if (canWrite) {
        await fs.writeFile(dest, content, "utf8");
        console.log(`📌 Installed .github/copilot-instructions.md → ${dest}`);
      } else {
        console.log(`⚠️  Skipped copilot-instructions.md: exists and was not generated by pka. Use --force to overwrite.`);
      }
    }

    if (this.options.cursorRules) {
      const dest = path.join(projectPath, ".cursorrules");
      const canWrite = await this.checkInstallGuard(dest);
      if (canWrite) {
        await fs.writeFile(dest, content, "utf8");
        console.log(`📌 Installed .cursorrules → ${dest}`);
      } else {
        console.log(`⚠️  Skipped .cursorrules: exists and was not generated by pka. Use --force to overwrite.`);
      }
    }
  }

  printSummary() {
    const stackLabel = [
      ...(this.stack?.language || []),
      ...(this.stack?.frameworks || []),
    ].join(", ");

    if (this.options.agentMode) {
      const modeLabels = { "claude-code": "Claude Code", "multi-tool": "Multi-tool", "full": "Full" };
      console.log(`\n✅ ${modeLabels[this.options.mode] || "Agent"} setup complete!`);
      if (stackLabel) console.log(`   Stack: ${stackLabel}`);
      if (this.gitInfo) console.log(`   Branch: ${this.gitInfo.branch}`);
      console.log(`   ${this.stats.processedFiles} files analyzed`);
      if (this.options.generateContext) console.log(`   📄 CLAUDE.md installed`);
      if (this.options.agentsMd) console.log(`   📄 AGENTS.md installed`);
      if (this.options.copilot) console.log(`   📄 .github/copilot-instructions.md installed`);
      if (this.options.cursorRules) console.log(`   📄 .cursorrules installed`);
      if (this.circularDeps.length)
        console.log(`   ⚠️  ${this.circularDeps.length} circular dependency cycle(s) detected`);
      if (this.stats.errors.length)
        console.log(`   ⚠️  ${this.stats.errors.length} errors encountered`);
      if (this.options.flattenMode) {
        console.log(`\n📁 Flatten output: ${this.options.outputDir}/`);
        if (!this.options.skipFlatten) console.log(`   ├── [flattened source files]`);
        if (this.options.generateConcat) console.log(`   ├── CODEBASE.txt`);
        if (this.options.xml) console.log(`   ├── CODEBASE.xml`);
        console.log(`   ├── PROJECT_MAP.md`);
        console.log(`   └── project-index.json`);
      }
      return;
    }

    console.log("\n✅ Analysis Complete!");
    console.log(`📊 Processed ${this.stats.processedFiles} files`);
    console.log(`⏭️  Skipped ${this.stats.skippedFiles} files`);

    if (stackLabel) console.log(`🔧 Stack: ${stackLabel}`);
    if (this.gitInfo) console.log(`🌿 Branch: ${this.gitInfo.branch}`);
    if (this.workspaces.length)
      console.log(`📦 Monorepo: ${this.workspaces.map((w) => w.type).join(", ")}`);
    if (this.importGraph.size > 0)
      console.log(`🔗 Import graph: ${this.importGraph.size} files mapped`);
    if (this.circularDeps.length > 0)
      console.log(`⚠️  Circular dependencies: ${this.circularDeps.length} cycle(s) detected`);
    if (this.annotations.length > 0)
      console.log(`📝 Annotations: ${this.annotations.length} (${ANNOTATION_TAGS.filter((t) => this.annotations.some((a) => a.type === t)).join(", ")})`);
    if (this.orphanFiles.length > 0)
      console.log(`🔍 Orphan files: ${this.orphanFiles.length} JS/TS file(s) not imported by anything`);
    if (this.sinceFiles.length > 0)
      console.log(`📅 Since ${this.options.since}: ${this.sinceFiles.length} file(s) changed`);
    if (this.instructions)
      console.log(`📋 Developer notes: loaded from ${this.instructions.length > 0 ? "PKA_INSTRUCTIONS.md / pka.config.json" : "config"}`);
    if (this.envVars.length > 0)
      console.log(`🔑 Env vars: ${this.envVars.length} documented from .env.example`);
    if (this.gitignorePatterns.length > 0)
      console.log(`🚫 .gitignore: ${this.gitignorePatterns.length} exclusion patterns applied`);
    if (this.claudeConfig) {
      const parts = [];
      const mcp = Object.keys(this.claudeConfig.settings?.mcpServers || {});
      if (mcp.length) parts.push(`${mcp.length} MCP server(s)`);
      if (this.claudeConfig.commands.length)
        parts.push(`${this.claudeConfig.commands.length} slash command(s)`);
      if (parts.length)
        console.log(`🔌 .claude/: ${parts.join(", ")} detected`);
    }

    console.log(`\n📁 Output: ${this.options.outputDir}/`);
    if (!this.options.skipFlatten)
      console.log(`   ├── [flattened source files]`);
    if (this.options.generateConcat)
      console.log(`   ├── CODEBASE.txt`);
    if (this.options.xml)
      console.log(`   ├── CODEBASE.xml`);
    if (this.options.generateContext) {
      if (this.options.compact && !this.options.compactOmit) {
        console.log(`   ├── CLAUDE.md  (compact chunk — ~${this.options.compactTokens.toLocaleString()} token budget)`);
        console.log(`   ├── CLAUDE-imports.md`);
        console.log(`   ├── CLAUDE-symbols.md`);
        console.log(`   ├── CLAUDE-annotations.md`);
      } else if (this.options.compact && this.options.compactOmit) {
        console.log(`   ├── CLAUDE.md  (compact omit — ~${this.options.compactTokens.toLocaleString()} token budget)`);
      } else {
        console.log(`   ├── CLAUDE.md`);
      }
    }
    console.log(`   ├── PROJECT_MAP.md`);
    console.log(`   └── project-index.json`);

    if (this.stats.errors.length > 0)
      console.log(`\n⚠️  ${this.stats.errors.length} errors encountered`);
  }
}

// ─── Config File ─────────────────────────────────────────────────────────────

async function loadConfig(projectPath) {
  try {
    const content = await fs.readFile(
      path.join(path.resolve(projectPath), "pka.config.json"),
      "utf8",
    );
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// ─── Init Command ─────────────────────────────────────────────────────────────

async function initCommand(args) {
  let projectPath = ".";
  let argStart = 0;
  if (args.length > 0 && !args[0].startsWith("--")) {
    projectPath = args[0];
    argStart = 1;
  }

  const configPath = path.join(path.resolve(projectPath), "pka.config.json");

  // Parse flags — same surface as main CLI so the generated config reflects a real invocation
  const opts = {};
  let extraExts = [];
  let extraExclusions = [];

  for (let i = argStart; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case "--output-dir": opts.outputDir = value; i++; break;
      case "--max-file-size": opts.maxFileSize = parseInt(value); i++; break;
      case "--include-ext": extraExts = [...extraExts, ...value.split(",").map((e) => e.trim())]; i++; break;
      case "--exclude-dir": extraExclusions = [...extraExclusions, ...value.split(",").map((d) => d.trim())]; i++; break;
      case "--no-git": opts.noGit = true; break;
      case "--no-flatten": opts.noFlatten = true; break;
      case "--no-concat": opts.noConcat = true; break;
      case "--no-context": opts.noContext = true; break;
      case "--diff": opts.diff = true; break;
      case "--install": opts.install = true; break;
      case "--no-gitignore": opts.noGitignore = true; break;
      case "--force": opts.force = true; break;
      case "--mode": opts.mode = value; i++; break;
      case "--claude-code": case "--cc": opts.mode = "claude-code"; break;
      case "--compact": opts.compact = true; break;
      case "--compact-tokens": opts.compactTokens = parseInt(value); i++; break;
      case "--compact-omit": opts.compactOmit = true; break;
      case "--compact-keep": opts.compactKeep = value.split(",").map((s) => s.trim()); i++; break;
      case "--compact-preview": opts.compactPreview = true; opts.compact = true; break;
      case "--hierarchical": opts.hierarchical = true; break;
      case "--scaffold-commands": opts.scaffoldCommands = true; break;
      case "--xml": opts.xml = true; break;
      case "--watch": opts.watch = true; break;
      case "--since": opts.since = value; i++; break;
      case "--agents-md": opts.agentsMd = true; break;
      case "--copilot": opts.copilot = true; break;
      case "--cursor-rules": opts.cursorRules = true; break;
      case "--multi-tool": opts.mode = "multi-tool"; break;
    }
  }

  // Check for an existing config — migrate or guard
  let existing = null;
  try {
    const raw = await fs.readFile(configPath, "utf8");
    existing = JSON.parse(raw);
  } catch {}

  if (existing !== null) {
    const existingVersion = existing.configVersion || 0;

    // Future migration hook: add new settings introduced after existingVersion
    // (nothing to migrate yet; existingVersion < CONFIG_VERSION means an older schema)

    if (existingVersion >= CONFIG_VERSION && !opts.force) {
      console.log(`ℹ️  pka.config.json already exists (configVersion: ${existingVersion}). Use --force to regenerate.`);
      return;
    }
  }

  // Build a complete config reflecting every available setting.
  // Values come from flags; everything else shows its runtime default so users
  // see the full option surface and can edit from a known baseline.
  const config = {
    configVersion: CONFIG_VERSION,
    _pkaGenerated: true,
    // ── Mode ─────────────────────────────────────────────────────────────────
    // "flatten" | "claude-code" | "multi-tool" | "full"
    mode: opts.mode ?? "flatten",
    // ── Output ───────────────────────────────────────────────────────────────
    outputDir: opts.outputDir ?? "./project-knowledge",
    maxFileSize: opts.maxFileSize ?? 1048576,
    // ── Git ──────────────────────────────────────────────────────────────────
    noGit: opts.noGit ?? false,
    // ── Context generation ───────────────────────────────────────────────────
    noContext: opts.noContext ?? false,
    // ── Flatten / full mode ──────────────────────────────────────────────────
    noConcat: opts.noConcat ?? false,
    noFlatten: opts.noFlatten ?? false,
    install: opts.install ?? false,
    noGitignore: opts.noGitignore ?? false,
    xml: opts.xml ?? false,
    // ── Agent mode (claude-code, multi-tool, full) ────────────────────────────
    // null = follow mode default; true/false = explicit override
    agentsMd: opts.agentsMd ?? null,
    copilot: opts.copilot ?? null,
    cursorRules: opts.cursorRules ?? null,
    hierarchical: opts.hierarchical ?? false,
    scaffoldCommands: opts.scaffoldCommands ?? false,
    // ── Compact mode ─────────────────────────────────────────────────────────
    compact: opts.compact ?? false,
    compactTokens: opts.compactTokens ?? 0,
    compactOmit: opts.compactOmit ?? false,
    compactKeep: opts.compactKeep ?? [],
    compactPreview: opts.compactPreview ?? false,
    // ── Misc ─────────────────────────────────────────────────────────────────
    diff: opts.diff ?? false,
    force: opts.force ?? false,
    watch: opts.watch ?? false,
    since: opts.since ?? null,
    // ── Extensions / exclusions ───────────────────────────────────────────────
    includeExt: extraExts,
    excludeDir: extraExclusions,
    // ── Developer notes (appended verbatim to CLAUDE.md) ─────────────────────
    instructions: "",
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  const action = existing !== null ? "Regenerated" : "Generated";
  console.log(`✅ ${action} pka.config.json (configVersion: ${CONFIG_VERSION})`);
  console.log(`   Edit it to customize your settings — CLI flags always override config values.`);
}

// ─── Config Validation ───────────────────────────────────────────────────────

function warnConfigConflicts(options) {
  const warnings = [];

  // compactOmit without compact: silently does nothing
  if (options.compactOmit && !options.compact && !options.compactTokens) {
    warnings.push(
      "  • \"compactOmit\" (--compact-omit) has no effect without compact mode.\n" +
      "    Resolution: enabling compact mode with default 8,192 token budget."
    );
    options.compact = true;
  }

  // compactPreview without compact: same issue
  if (options.compactPreview && !options.compact && !options.compactTokens) {
    warnings.push(
      "  • \"compactPreview\" (--compact-preview) has no effect without compact mode.\n" +
      "    Resolution: enabling compact mode with default 8,192 token budget."
    );
    options.compact = true;
  }

  // compactKeep set but compact not enabled
  if (
    Array.isArray(options.compactKeep) &&
    options.compactKeep.length > 0 &&
    !options.compact &&
    !options.compactTokens
  ) {
    warnings.push(
      "  • \"compactKeep\" sections are set but compact mode is not enabled — they will be ignored."
    );
  }

  // since with noGit: git diff won't work
  if (options.since && options.includeGitInfo === false) {
    warnings.push(
      "  • \"since\" (--since) requires git, but \"noGit\" (--no-git) is set.\n" +
      "    Resolution: --since will be skipped."
    );
    options.since = null;
  }

  if (warnings.length > 0) {
    console.warn("\n⚠️  Configuration warnings:");
    for (const w of warnings) console.warn(`\n${w}`);
    console.warn("");
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "init") {
    await initCommand(args.slice(1));
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Project Knowledge Analyzer — generate AI context files for any project

Usage: node index.js <project-path> [options]
       node index.js init [project-path] [options]   # generate pka.config.json

Commands:
  init [project-path]         Generate a pka.config.json in the target directory.
                              All analysis flags are accepted; the values you pass
                              are written into the config so the file reflects a
                              real invocation rather than placeholder defaults.
                              If a config already exists at the same configVersion,
                              the command is a no-op unless --force is also passed.

Modes (mutually exclusive; default: flatten):
  --mode <mode>               Set operation mode explicitly
  --mode flatten              Flatten files + PROJECT_MAP.md + CODEBASE.txt in outputDir (default)
  --mode claude-code          CLAUDE.md installed at project root only  (alias: --cc)
  --mode multi-tool           All four agent files at project root
  --mode full                 Flatten output + all four agent files

Options (all modes):
  --output-dir <dir>          Output directory for flatten/full modes (default: ./project-knowledge)
  --max-file-size <bytes>     Maximum file size in bytes (default: 1048576)
  --include-ext <exts>        Comma-separated extra extensions (e.g. ".py,.rb")
  --exclude-dir <patterns>    Comma-separated extra exclusion patterns (e.g. "test,vendor")
  --no-git                    Skip git metadata collection
  --no-context                Skip generating CLAUDE.md
  --since <git-ref>           Highlight files changed since a git ref (branch, tag, or commit SHA)
  --diff                      Show what changed since the last run
  --force                     Overwrite existing context files even if not pka-generated
  --watch                     Re-run automatically whenever source files change

Flatten / full mode options:
  --no-flatten                Skip generating individual flattened files
  --no-concat                 Skip generating CODEBASE.txt
  --no-gitignore              Skip auto-adding the output directory to .gitignore
  --install                   Also copy CLAUDE.md to the project root
  --xml                       Also generate CODEBASE.xml in Anthropic <documents> format

Agent mode options (claude-code, multi-tool, full):
  --agents-md                 Add AGENTS.md (OpenAI Codex / Devin) — on by default in multi-tool/full
  --copilot                   Add .github/copilot-instructions.md — on by default in multi-tool/full
  --cursor-rules              Add .cursorrules — on by default in multi-tool/full
  --hierarchical              Generate CLAUDE.md in each subdirectory of the project tree
  --scaffold-commands         Scaffold .claude/commands/ stubs from npm scripts

Compact mode (applicable when CLAUDE.md is generated):
  --compact                   Enable compact mode (8,192 token budget, chunk mode)
  --compact-tokens <n>        Enable compact mode with a custom token budget per chunk
  --compact-omit              Use omit mode (single file, drops sections) instead of chunk mode
  --compact-keep <sections>   Comma-separated sections never to omit (e.g. "imports,symbols")
  --compact-preview           Show section sizes and omit/chunk plan without writing files

  --help, -h                  Show this help message

Config file (pka.config.json):
  Generate with:  node index.js init [options]
  { "mode": "multi-tool", "copilot": false }
  Set agent tool to false to exclude it from multi-tool/full: { "copilot": false }
  CLI flags override config file values.
  The "configVersion" field enables future migrations — new settings added in
  later releases will be appended when you re-run "init" on an existing config.

Examples:
  node index.js ./my-project
  node index.js .                                 # flatten mode (default)
  node index.js . --mode claude-code              # CLAUDE.md only at project root
  node index.js . --cc                            # same (alias)
  node index.js . --mode multi-tool               # all four agent files at project root
  node index.js . --mode full                     # flatten output + all four agent files
  node index.js . --mode claude-code --agents-md  # CLAUDE.md + AGENTS.md only
  node index.js . --mode full --copilot false     # full mode, skip copilot file
  node index.js . --compact                       # chunk mode, 8k token budget
  node index.js . --compact-tokens 4096 --compact-omit
  node index.js . --compact-preview
  node index.js . --mode flatten --xml            # also generate CODEBASE.xml
  node index.js . --mode claude-code --hierarchical
  node index.js . --mode claude-code --scaffold-commands
  node index.js . --watch
  node index.js . --since main
  node index.js . --output-dir ./knowledge --install
  node index.js . --include-ext ".py,.rb" --exclude-dir "test,vendor"
    `);
    return;
  }

  let projectPath = ".";
  let argStart = 0;
  if (args.length > 0 && !args[0].startsWith("--")) {
    projectPath = args[0];
    argStart = 1;
  }

  // Load config file first; CLI args override it
  const config = await loadConfig(projectPath);

  const options = {
    mode: config.mode,
    outputDir: config.outputDir,
    maxFileSize: config.maxFileSize,
    includeGitInfo: config.noGit ? false : undefined,
    generateContext: config.noContext ? false : undefined,
    generateConcat: config.noConcat ? false : undefined,
    skipFlatten: config.noFlatten || undefined,
    diff: config.diff || undefined,
    install: config.install || undefined,
    noGitignore: config.noGitignore || undefined,
    force: config.force || undefined,
    compact: config.compact || undefined,
    compactTokens: config.compactTokens || undefined,
    compactOmit: config.compactOmit || undefined,
    compactKeep: config.compactKeep || undefined,
    compactPreview: config.compactPreview || undefined,
    hierarchical: config.hierarchical || undefined,
    scaffoldCommands: config.scaffoldCommands || undefined,
    xml: config.xml || undefined,
    watch: config.watch || undefined,
    since: config.since || undefined,
    agentsMd: config.agentsMd ?? undefined,
    copilot: config.copilot ?? undefined,
    cursorRules: config.cursorRules ?? undefined,
  };

  // Extra extensions/exclusions from config
  let extraExts = config.includeExt || [];
  let extraExclusions = (config.excludeDir || []).map((d) => new RegExp(d));

  for (let i = argStart; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case "--output-dir":
        options.outputDir = value;
        i++;
        break;
      case "--max-file-size":
        options.maxFileSize = parseInt(value);
        i++;
        break;
      case "--include-ext":
        extraExts = [...extraExts, ...value.split(",").map((e) => e.trim())];
        i++;
        break;
      case "--exclude-dir":
        extraExclusions = [
          ...extraExclusions,
          ...value.split(",").map((d) => new RegExp(d.trim())),
        ];
        i++;
        break;
      case "--no-git":
        options.includeGitInfo = false;
        break;
      case "--no-flatten":
        options.skipFlatten = true;
        break;
      case "--no-concat":
        options.generateConcat = false;
        break;
      case "--no-context":
        options.generateContext = false;
        break;
      case "--diff":
        options.diff = true;
        break;
      case "--install":
        options.install = true;
        break;
      case "--no-gitignore":
        options.noGitignore = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--mode":
        options.mode = value;
        i++;
        break;
      case "--claude-code":
      case "--cc":
        options.mode = "claude-code";
        break;
      case "--compact":
        options.compact = true;
        break;
      case "--compact-tokens":
        options.compactTokens = parseInt(value);
        i++;
        break;
      case "--compact-omit":
        options.compactOmit = true;
        break;
      case "--compact-keep":
        options.compactKeep = value.split(",").map((s) => s.trim());
        i++;
        break;
      case "--compact-preview":
        options.compactPreview = true;
        options.compact = true;
        break;
      case "--hierarchical":
        options.hierarchical = true;
        break;
      case "--scaffold-commands":
        options.scaffoldCommands = true;
        break;
      case "--xml":
        options.xml = true;
        break;
      case "--watch":
        options.watch = true;
        break;
      case "--since":
        options.since = value;
        i++;
        break;
      case "--agents-md":
        options.agentsMd = true;
        break;
      case "--copilot":
        options.copilot = true;
        break;
      case "--cursor-rules":
        options.cursorRules = true;
        break;
      case "--multi-tool":
        options.mode = "multi-tool";
        break;
    }
  }

  if (extraExts.length) {
    options.includeExtensions = [...DEFAULT_INCLUDE_EXTENSIONS, ...extraExts];
  }
  if (extraExclusions.length) {
    options.excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...extraExclusions];
  }

  warnConfigConflicts(options);

  if (options.watch) {
    await watchMode(projectPath, options);
  } else {
    try {
      const analyzer = new ProjectAnalyzer(options);
      await analyzer.analyze(projectPath);
    } catch (error) {
      console.error("❌ Error:", error.message);
      process.exit(1);
    }
  }
}

async function watchMode(projectPath, options) {
  const absPath = path.resolve(projectPath);
  const outputAbsPath = path.resolve(options.outputDir || path.join(projectPath, "project-knowledge"));

  let debounceTimer = null;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const analyzer = new ProjectAnalyzer(options);
      await analyzer.analyze(projectPath);
    } catch (e) {
      console.error(`❌ ${e.message}`);
    }
    running = false;
    console.log(`\n👁️  Watching for changes... (Ctrl+C to stop)`);
  };

  await run();

  try {
    fs.watch(absPath, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const fullPath = path.join(absPath, filename);
      // Ignore output directory (would cause infinite loop) and tool-generated root files
      if (fullPath.startsWith(outputAbsPath)) return;
      if (["CLAUDE.md", "CLAUDE-imports.md", "CLAUDE-symbols.md", "CLAUDE-annotations.md", "CLAUDE-since.md"]
          .includes(path.basename(filename)) && path.dirname(fullPath) === absPath) return;
      if (/(?:^|[/\\])(?:node_modules|\.git)[/\\]/.test(filename)) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`\n🔄 ${filename} changed — regenerating...`);
        run();
      }, 500);
    });
  } catch (e) {
    console.error(`❌ Watch mode failed: ${e.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
