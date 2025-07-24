# Project Knowledge Analyzer

🔍 **Transform any codebase into Claude AI-optimized Project Knowledge files**

A powerful Node.js command-line tool that analyzes your project structure, flattens complex folder hierarchies, and generates comprehensive documentation specifically designed to maximize Claude AI's understanding of your codebase.

![npm version](https://img.shields.io/npm/v/project-knowledge-analyzer)
![license](https://img.shields.io/github/license/davauxjs/project-knowledge-analyzer)
![downloads](https://img.shields.io/npm/dm/project-knowledge-analyzer)

## 🚀 Why Use This Tool?

### The Problem
When working with Claude AI on complex projects, you often face:
- **File name conflicts** when uploading multiple files with similar names
- **Lost context** about project structure and file relationships
- **Overwhelming uploads** without clear organization
- **Difficulty referencing** specific files in conversations
- **No clear mapping** between original structure and uploaded files

### The Solution
Project Knowledge Analyzer solves these problems by:
- **🎯 Eliminating naming conflicts** with unique hash-prefixed filenames
- **📋 Preserving complete context** with detailed project mapping
- **🗂️ Organizing files by type** for easy navigation
- **📖 Generating comprehensive documentation** that Claude can reference
- **🔗 Creating clear relationships** between original and flattened files

## ✨ Key Features

### Smart Analysis
- **Recursive project scanning** with intelligent exclusion patterns
- **File type detection** and categorization
- **Size limits** to prevent overwhelming uploads
- **Error handling** for robust operation
- **Configurable filtering** for different project types

### Intelligent Flattening
- **Unique hash prefixes** prevent naming conflicts
- **Readable filenames** maintain context
- **Metadata headers** in each file with original path info
- **Preserved file relationships** through comprehensive mapping

### Claude AI Optimization
- **Project structure visualization** with ASCII tree diagrams
- **File index tables** for quick reference
- **Type-based organization** (modules, configs, docs, etc.)
- **Usage instructions** specifically for Claude conversations
- **JSON index** for programmatic access

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
npx davaux-pka
```

## 📖 Usage

### Basic Usage
```bash
# Analyze current directory
npx davaux-pka .

# Analyze specific project
npx davaux-pka ./my-awesome-project

# With custom output directory
npx davaux-pka ./src --output-dir ./claude-knowledge
```

### Advanced Options
```bash
# Increase file size limit to 2MB
npx davaux-pka . --max-file-size 2097152

# Custom output directory
npx davaux-pka ./backend --output-dir ./backend-knowledge

# Show help
npx davaux-pka --help
```

## 📁 Output Structure

The tool generates a complete knowledge package:

```
project-knowledge/
├── PROJECT_MAP.md           # Main documentation file
├── project-index.json       # Programmatic file index
├── a1b2c3d4_src_app.js     # Flattened source files
├── e5f6g7h8_config_db.json # with unique prefixes
└── i9j0k1l2_docs_api.md    # and metadata headers
```

### Example Flattened File
```javascript
/*
 * Original Path: src/components/UserProfile.js
 * File Type: module
 * Size: 2.15 KB
 * Last Modified: 2025-01-15T10:30:45.123Z
 * Hash: a1b2c3d4
 */

// Your original file content here...
```

## 🎯 Perfect For

### Modern Web Development
- **React/Vue/Angular** applications
- **Node.js/Express** backends
- **TypeScript** projects
- **Monorepo** structures
- **Micro-service** architectures

### AI-Assisted Development
- **Code reviews** with Claude AI
- **Documentation generation**
- **Architecture analysis**
- **Refactoring projects**
- **Learning new codebases**

### Team Collaboration
- **Onboarding new developers**
- **Code knowledge transfer**
- **Project documentation**
- **Architecture discussions**

## 🔧 Configuration

### Default Settings
```javascript
{
  maxFileSize: 1048576,        // 1MB
  outputDir: './project-knowledge',
  excludePatterns: [
    /node_modules/, /\.git/, /dist/, /build/,
    /coverage/, /\.cache/, /\.vscode/
  ],
  includeExtensions: [
    '.js', '.ts', '.jsx', '.tsx', '.json',
    '.md', '.html', '.css', '.yml', '.yaml'
  ]
}
```

### Customization
The tool automatically detects and includes:
- **JavaScript/TypeScript** files (modules, components, configs)
- **Documentation** files (README, changelogs, guides)
- **Configuration** files (package.json, tsconfig, etc.)
- **Style** files (CSS, SCSS, LESS)
- **Template** files (HTML, Vue, Svelte)

## 🤖 Using with Claude AI

### 1. Generate Knowledge Files
```bash
npx davaux-pka ./my-react-app
```

### 2. Upload to Claude
- Upload all files from the `project-knowledge/` folder
- Include the `PROJECT_MAP.md` for context

### 3. Reference Files in Conversation
```
"Can you analyze the UserProfile component?
It's in file a1b2c3d4_src_components_UserProfile.js"
```

### 4. Use the Documentation
- Reference the PROJECT_MAP.md for structure overview
- Use the File Index to find specific files
- Check the Type Map for files by category

## 🌟 Why This Matters

### For Developers
- **Faster AI assistance** with better context
- **Clearer project understanding** for team members
- **Better documentation** as a byproduct
- **Easier code reviews** and discussions

### For AI Interactions
- **Maximum context preservation**
- **Clear file relationships**
- **Organized information structure**
- **Efficient reference system**

### For Teams
- **Standardized documentation**
- **Improved onboarding**
- **Better knowledge sharing**
- **Consistent project analysis**

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
npm test
```

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Claude AI** for inspiring smarter developer tools
- **The open source community** for continuous innovation
- **Modern web developers** who need better AI integration tools

## 🔗 Links

- [GitHub Repository](https://github.com/davauxjs/project-knowledge-analyzer)
- [npm Package](https://www.npmjs.com/package/project-knowledge-analyzer)
- [Report Issues](https://github.com/davauxjs/project-knowledge-analyzer/issues)
- [Feature Requests](https://github.com/davauxjs/project-knowledge-analyzer/discussions)

---

**Made with ❤️ for developers who want to maximize their AI-assisted development workflow**

*Stop struggling with file uploads and context loss. Start building better software with AI.*
