#!/usr/bin/env node

import * as fs from "node:fs/promises";
import path from "path";
import crypto from "crypto";

class ProjectAnalyzer {
  constructor(options = {}) {
    this.options = {
      maxFileSize: options.maxFileSize || 1024 * 1024, // 1MB default
      excludePatterns: options.excludePatterns || [
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
      ],
      includeExtensions: options.includeExtensions || [
        ".js",
        ".mjs",
        ".ts",
        ".jsx",
        ".tsx",
        ".json",
        ".md",
        ".txt",
        ".html",
        ".css",
        ".scss",
        ".sass",
        ".less",
        ".vue",
        ".svelte",
        ".yml",
        ".yaml",
        ".xml",
        ".env.example",
        ".gitignore",
        ".npmignore",
        ".sql",
        ".surql",
      ],
      outputDir: options.outputDir || "./project-knowledge",
    };
    this.fileMap = new Map();
    this.stats = {
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      totalSize: 0,
      errors: [],
    };
  }

  async analyze(projectPath) {
    const absolutePath = path.resolve(projectPath);
    console.log(`🔍 Analyzing project: ${absolutePath}`);

    // Create output directory
    await this.ensureOutputDir();

    // Scan the project
    await this.scanDirectory(absolutePath, "");

    // Generate flattened files
    await this.generateFlattenedFiles();

    // Generate documentation
    await this.generateDocumentation();

    // Generate summary
    this.printSummary();
  }

  async ensureOutputDir() {
    try {
      await fs.mkdir(this.options.outputDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create output directory: ${error.message}`);
    }
  }

  async scanDirectory(dirPath, relativePath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativeEntryPath = path.join(relativePath, entry.name);

        // Check exclusion patterns
        if (this.shouldExclude(relativeEntryPath)) {
          this.stats.skippedFiles++;
          continue;
        }

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, relativeEntryPath);
        } else if (entry.isFile()) {
          await this.processFile(fullPath, relativeEntryPath);
        }
      }
    } catch (error) {
      this.stats.errors.push(`Error scanning ${dirPath}: ${error.message}`);
    }
  }

  shouldExclude(relativePath) {
    return this.options.excludePatterns.some((pattern) =>
      pattern.test(relativePath),
    );
  }

  async processFile(fullPath, relativePath) {
    try {
      this.stats.totalFiles++;

      const stats = await fs.stat(fullPath);
      this.stats.totalSize += stats.size;

      // Check file size
      if (stats.size > this.options.maxFileSize) {
        this.stats.skippedFiles++;
        this.stats.errors.push(
          `File too large (${this.formatBytes(stats.size)}): ${relativePath}`,
        );
        return;
      }

      // Check file extension
      const ext = path.extname(relativePath);
      if (
        !this.options.includeExtensions.includes(ext) &&
        !this.isSpecialFile(relativePath)
      ) {
        this.stats.skippedFiles++;
        return;
      }

      // Read file content
      const content = await fs.readFile(fullPath, "utf8");

      // Generate unique identifier
      const hash = crypto
        .createHash("md5")
        .update(relativePath)
        .digest("hex")
        .substring(0, 8);
      const flatName = this.generateFlatName(relativePath, hash);

      this.fileMap.set(relativePath, {
        originalPath: relativePath,
        flatName: flatName,
        fullPath: fullPath,
        content: content,
        size: stats.size,
        extension: ext,
        hash: hash,
        lastModified: stats.mtime,
        type: this.getFileType(relativePath, content),
      });

      this.stats.processedFiles++;
    } catch (error) {
      this.stats.errors.push(
        `Error processing ${relativePath}: ${error.message}`,
      );
    }
  }

  isSpecialFile(relativePath) {
    const basename = path.basename(relativePath);
    const specialFiles = [
      "package.json",
      "package-lock.json",
      "yarn.lock",
      "README.md",
      "LICENSE",
      "CHANGELOG.md",
      ".gitignore",
      ".npmignore",
      ".env.example",
      "tsconfig.json",
      "jsconfig.json",
      "webpack.config.js",
      "vite.config.js",
      "rollup.config.js",
      "babel.config.js",
    ];
    return specialFiles.includes(basename);
  }

  generateFlatName(relativePath, hash) {
    // Convert path separators to underscores and add hash for uniqueness
    const safeName = relativePath
      .replace(/[/\\]/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    return `${hash}_${safeName}`;
  }

  getFileType(filePath, content) {
    const ext = path.extname(filePath);

    if ([".js", ".mjs", ".ts", ".jsx", ".tsx"].includes(ext)) {
      // Analyze JavaScript/TypeScript content
      if (content.includes("export") || content.includes("import")) {
        return "module";
      } else if (content.includes("class ")) {
        return "class";
      } else if (content.includes("function ")) {
        return "function";
      }
      return "script";
    }

    if (ext === ".json") return "config";
    if (ext === ".md") return "documentation";
    if ([".html", ".htm"].includes(ext)) return "template";
    if ([".css", ".scss", ".sass", ".less"].includes(ext)) return "stylesheet";
    if ([".yml", ".yaml"].includes(ext)) return "config";

    return "other";
  }

  async generateFlattenedFiles() {
    console.log("📁 Generating flattened files...");

    for (const [originalPath, fileInfo] of this.fileMap) {
      const outputPath = path.join(this.options.outputDir, fileInfo.flatName);

      // Add header comment with metadata
      const header = this.generateFileHeader(fileInfo);
      const content = header + fileInfo.content;

      await fs.writeFile(outputPath, content, "utf8");
    }
  }

  generateFileHeader(fileInfo) {
    const header = `/*
 * Original Path: ${fileInfo.originalPath}
 * File Type: ${fileInfo.type}
 * Size: ${this.formatBytes(fileInfo.size)}
 * Last Modified: ${fileInfo.lastModified.toISOString()}
 * Hash: ${fileInfo.hash}
 */

`;
    return header;
  }

  async generateDocumentation() {
    console.log("📚 Generating documentation...");

    const docs = {
      projectMap: this.generateProjectMap(),
      fileIndex: this.generateFileIndex(),
      typeMap: this.generateTypeMap(),
      instructions: this.generateInstructions(),
    };

    // Generate main documentation file
    const mainDoc = this.generateMainDocumentation(docs);
    await fs.writeFile(
      path.join(this.options.outputDir, "PROJECT_MAP.md"),
      mainDoc,
      "utf8",
    );

    // Generate JSON index for programmatic access
    const jsonIndex = {
      generatedAt: new Date().toISOString(),
      stats: this.stats,
      files: Array.from(this.fileMap.entries()).map(([path, info]) => ({
        originalPath: path,
        flatName: info.flatName,
        type: info.type,
        size: info.size,
        hash: info.hash,
      })),
    };

    await fs.writeFile(
      path.join(this.options.outputDir, "project-index.json"),
      JSON.stringify(jsonIndex, null, 2),
      "utf8",
    );
  }

  generateProjectMap() {
    const tree = {};

    for (const [originalPath] of this.fileMap) {
      const parts = originalPath.split(path.sep);
      let current = tree;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          // It's a file
          current[part] = { _file: true, _path: originalPath };
        } else {
          // It's a directory
          if (!current[part]) {
            current[part] = {};
          }
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
      });
    }

    return index.sort((a, b) => a.original.localeCompare(b.original));
  }

  generateTypeMap() {
    const typeMap = {};

    for (const [, fileInfo] of this.fileMap) {
      if (!typeMap[fileInfo.type]) {
        typeMap[fileInfo.type] = [];
      }
      typeMap[fileInfo.type].push({
        original: fileInfo.originalPath,
        flattened: fileInfo.flatName,
      });
    }

    return typeMap;
  }

  generateInstructions() {
    return `
## How to Use These Project Knowledge Files

### For Claude AI Context:
1. Upload all files from the ${this.options.outputDir} folder to your Claude conversation
2. Reference this PROJECT_MAP.md file to understand the project structure
3. Use the flattened filenames when asking about specific files

### File Naming Convention:
- Each file is prefixed with an 8-character hash for uniqueness
- Path separators are replaced with underscores
- Example: "src/components/Button.js" becomes "${this.generateFlatName("src/components/Button.js", "abc12345")}"

### Key Benefits:
- No path conflicts when uploading to Claude
- Easy to reference specific files by their flattened names
- Complete project context preserved
- Metadata headers in each file for reference

### Usage Tips:
- Ask Claude to "analyze the Button component" and reference the flattened filename
- Use the Type Map section to find all files of a specific type
- Reference the File Index for a complete mapping
    `;
  }

  generateMainDocumentation(docs) {
    return `# Project Knowledge Map

Generated on: ${new Date().toISOString()}

## Project Statistics
- **Total Files Scanned**: ${this.stats.totalFiles}
- **Files Processed**: ${this.stats.processedFiles}
- **Files Skipped**: ${this.stats.skippedFiles}
- **Total Size**: ${this.formatBytes(this.stats.totalSize)}
- **Errors**: ${this.stats.errors.length}

## Project Structure
\`\`\`
${this.renderTree(docs.projectMap)}
\`\`\`

## File Index
| Original Path | Flattened Name | Type | Size | Extension |
|---------------|----------------|------|------|-----------|
${docs.fileIndex.map((f) => `| ${f.original} | ${f.flattened} | ${f.type} | ${f.size} | ${f.extension} |`).join("\n")}

## Files by Type
${Object.entries(docs.typeMap)
  .map(
    ([type, files]) => `
### ${type.charAt(0).toUpperCase() + type.slice(1)} Files (${files.length})
${files.map((f) => `- \`${f.flattened}\` ← ${f.original}`).join("\n")}
`,
  )
  .join("\n")}

${
  this.stats.errors.length > 0
    ? `## Errors Encountered
${this.stats.errors.map((err) => `- ${err}`).join("\n")}
`
    : ""
}

${docs.instructions}
`;
  }

  renderTree(tree, prefix = "", isLast = true) {
    const entries = Object.entries(tree);
    let result = "";

    entries.forEach(([name, value], index) => {
      const isLastEntry = index === entries.length - 1;
      const connector = isLastEntry ? "└── " : "├── ";
      const nextPrefix = prefix + (isLastEntry ? "    " : "│   ");

      if (value._file) {
        result += `${prefix}${connector}${name}\n`;
      } else {
        result += `${prefix}${connector}${name}/\n`;
        result += this.renderTree(value, nextPrefix, isLastEntry);
      }
    });

    return result;
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  printSummary() {
    console.log("\n✅ Analysis Complete!");
    console.log(`📊 Processed ${this.stats.processedFiles} files`);
    console.log(`⏭️  Skipped ${this.stats.skippedFiles} files`);
    console.log(`📁 Output directory: ${this.options.outputDir}`);
    console.log(
      `📋 Documentation: ${path.join(this.options.outputDir, "PROJECT_MAP.md")}`,
    );

    if (this.stats.errors.length > 0) {
      console.log(`⚠️  ${this.stats.errors.length} errors encountered`);
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Project Structure Analyzer for Claude AI Project Knowledge

Usage: node project-analyzer.js <project-path> [options]

Options:
  --output-dir <dir>      Output directory (default: ./project-knowledge)
  --max-file-size <size>  Maximum file size in bytes (default: 1048576)
  --help, -h              Show this help message

Examples:
  node project-analyzer.js ./my-project
  node project-analyzer.js ../app --output-dir ./knowledge
  node project-analyzer.js . --max-file-size 2097152
    `);
    return;
  }

  const projectPath = args[0];
  const options = {};

  // Parse command line options
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case "--output-dir":
        options.outputDir = value;
        break;
      case "--max-file-size":
        options.maxFileSize = parseInt(value);
        break;
    }
  }

  try {
    const analyzer = new ProjectAnalyzer(options);
    await analyzer.analyze(projectPath);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main().catch(console.error);
