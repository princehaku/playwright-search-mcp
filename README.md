# Playwright Search MCP Tool

A Playwright-based Node.js tool that bypasses search engine anti-scraping mechanisms to execute searches and extract results from **any search engine**. It can be used directly as a command-line tool or as a Model Context Protocol (MCP) server to provide real-time search capabilities to AI assistants like Claude.

[![Star History Chart](https://api.star-history.com/svg?repos=princehaku/playwright-search-mcp&type=Date)](https://star-history.com/#princehaku/playwright-search-mcp&Date)

[中文文档](README.zh-CN.md)

## Supported Search Engines

This tool is designed to work with **any search engine** and has been tested with:

- **Google** - Global search engine with advanced anti-bot detection
- **Baidu (百度)** - China's largest search engine, supporting Chinese language searches
- **Zhihu (知乎)** - Chinese Q&A platform with search functionality
- **Xiaohongshu (小红书)** - Chinese lifestyle and social media platform with search functionality
- **And many more...** - The tool's architecture allows easy adaptation to any search engine

### Search Engine Specific Features

- **Google**: Advanced fingerprint management and state restoration for complex anti-bot systems
- **Baidu**: Optimized for Chinese language processing and Baidu's specific page structure
- **Zhihu**: Specialized handling for Q&A content and community-driven search results
- **Xiaohongshu**: Optimized for lifestyle content and social media search results
- **Universal**: Configurable selectors and parsers for any search engine's page structure

## Key Features

- **Universal Search Engine Support**: Works with any search engine, not limited to Google
- **Local SERP API Alternative**: No need to rely on paid search engine results API services, all searches are executed locally
- **Advanced Anti-Bot Detection Bypass Techniques**:
  - Intelligent browser fingerprint management that simulates real user behavior
  - Automatic saving and restoration of browser state to reduce verification frequency
  - Smart headless/headed mode switching, automatically switching to headed mode when verification is needed
  - Randomization of device and locale settings to reduce detection risk
- **Raw HTML Retrieval**: Ability to fetch the raw HTML of search result pages (with CSS and JavaScript removed) for analysis and debugging when search engine page structures change
- **Page Screenshot**: Automatically captures and saves a full-page screenshot when saving HTML content
- **MCP Server Integration**: Provides real-time search capabilities to AI assistants like Claude without requiring additional API keys
- **Completely Open Source and Free**: All code is open source with no usage restrictions, freely customizable and extensible
- **Multi-Language Support**: Built-in support for Chinese, English, and other languages across different search engines

## Technical Features

- Developed with TypeScript, providing type safety and better development experience
- Browser automation based on Playwright, supporting multiple browser engines
- **Multi-Search Engine Architecture**: Configurable selectors and parsers for different search engines
- **Language-Aware Processing**: Built-in support for Chinese, English, and other languages
- Command-line parameter support for search keywords
- MCP server support for AI assistant integration
- Returns search results with title, link, and snippet
- Option to retrieve raw HTML of search result pages for analysis
- JSON format output
- Support for both headless and headed modes (for debugging)
- Detailed logging output
- Robust error handling
- Browser state saving and restoration to effectively avoid anti-bot detection
- **Cross-Platform Compatibility**: Works on Windows, macOS, and Linux

## Installation

```bash
# Install from source
git clone https://github.com/princehaku/playwright-search-mcp.git
cd playwright-search-mcp
# Install dependencies
npm install
# Or using yarn
yarn
# Or using pnpm
pnpm install

# Compile TypeScript code
npm run build
# Or using yarn
yarn build
# Or using pnpm
pnpm build

# Link package globally (required for MCP functionality)
npm link
# Or using yarn
yarn link
# Or using pnpm
pnpm link
```

### Windows Environment Notes

This tool has been specially adapted for Windows environments:

1. `.cmd` files are provided to ensure command-line tools work properly in Windows Command Prompt and PowerShell
2. Log files are stored in the system temporary directory instead of the Unix/Linux `/tmp` directory
3. Windows-specific process signal handling has been added to ensure proper server shutdown
4. Cross-platform file path handling is used to support Windows path separators

## Usage

### Command Line Tool

```bash
# Search on Google (default)
playwright-search "search keywords"

# Search on Baidu
playwright-search --engine baidu "搜索关键词"

# Search on Zhihu
playwright-search --engine zhihu "知乎搜索关键词"

# Search on Xiaohongshu
playwright-search --engine xhs "小红书搜索关键词"

# Search on Bing
playwright-search --engine bing "search keywords"

# Using command line options
playwright-search --limit 5 --timeout 60000 --no-headless "search keywords"

# Or using npx
npx playwright-search-mcp "search keywords"

# Run in development mode
pnpm dev "search keywords"

# Run in debug mode (showing browser interface)
pnpm debug "search keywords"

# Get raw HTML of search result page
playwright-search "search keywords" --get-html

# Get HTML and save to file
playwright-search "search keywords" --get-html --save-html

# Get HTML and save to specific file
playwright-search "search keywords" --get-html --save-html --html-output "./output.html"
```

#### Command Line Options

- `-e, --engine <engine>`: Search engine to use (google, baidu, zhihu, xhs, bing, duckduckgo, yahoo) (default: google)
- `-l, --limit <number>`: Result count limit (default: 10)
- `-t, --timeout <number>`: Timeout in milliseconds (default: 60000)
- `--no-headless`: Show browser interface (for debugging)
- `--remote-debugging-port <number>`: Enable remote debugging port (default: 9222)
- `--state-file <path>`: Browser state file path (default: ./browser-state.json) - **All search engines share the same state and fingerprint files**
- `--no-save-state`: Don't save browser state
- `--get-html`: Retrieve raw HTML of search result page instead of parsing results
- `--save-html`: Save HTML to file (used with --get-html)
- `--html-output <path>`: Specify HTML output file path (used with --get-html and --save-html)
- `-V, --version`: Display version number
- `-h, --help`: Display help information

#### Output Example

```json
{
  "query": "deepseek",
  "results": [
    {
      "title": "DeepSeek",
      "link": "https://www.deepseek.com/",
      "snippet": "DeepSeek-R1 is now live and open source, rivaling OpenAI's Model o1. Available on web, app, and API. Click for details. Into ..."
    },
    {
      "title": "DeepSeek",
      "link": "https://www.deepseek.com/",
      "snippet": "DeepSeek-R1 is now live and open source, rivaling OpenAI's Model o1. Available on web, app, and API. Click for details. Into ..."
    },
    {
      "title": "deepseek-ai/DeepSeek-V3",
      "link": "https://github.com/deepseek-ai/DeepSeek-V3",
      "snippet": "We present DeepSeek-V3, a strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token."
    }
    // More results...
  ]
}
```

#### HTML Output Example

When using the `--get-html` option, the output will include information about the HTML content:

```json
{
  "query": "playwright automation",
  "url": "https://www.google.com/",
  "originalHtmlLength": 1291733,
  "cleanedHtmlLength": 456789,
  "htmlPreview": "<!DOCTYPE html><html itemscope=\"\" itemtype=\"http://schema.org/SearchResultsPage\" lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><meta content=\"dark light\" name=\"color-scheme\"><meta content=\"origin\" name=\"referrer\">..."
}
```

If you also use the `--save-html` option, the output will include the path where the HTML was saved:

```json
{
  "query": "playwright automation",
  "url": "https://www.google.com/",
  "originalHtmlLength": 1292241,
  "cleanedHtmlLength": 458976,
          "savedPath": "./playwright-search-html/playwright_automation-2025-04-06T03-30-06-852Z.html",
        "screenshotPath": "./playwright-search-html/playwright_automation-2025-04-06T03-30-06-852Z.png",
  "htmlPreview": "<!DOCTYPE html><html itemscope=\"\" itemtype=\"http://schema.org/SearchResultsPage\" lang=\"zh-CN\">..."
}
```

### MCP Server

This project provides Model Context Protocol (MCP) server functionality, allowing AI assistants like Claude to directly use Google search capabilities. MCP is an open protocol that enables AI assistants to safely access external tools and data.

```bash
# Build the project
pnpm build
```

#### Integration with Claude Desktop

1. Edit the Claude Desktop configuration file:
   - Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
     - Usually located at `C:\Users\username\AppData\Roaming\Claude\claude_desktop_config.json`
     - You can access it directly by entering `%APPDATA%\Claude` in Windows Explorer address bar

2. Add server configuration and restart Claude

```json
{
  "mcpServers": {
    "playwright-search": {
      "command": "npx",
      "args": ["playwright-search-mcp"]
    }
  }
}
```

For Windows environments, you can also use the following configurations:

1. Using cmd.exe with npx:

```json
{
  "mcpServers": {
    "playwright-search": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "playwright-search-mcp"]
    }
  }
}
```

2. Using node with full path (recommended if you encounter issues with the above method):

```json
{
  "mcpServers": {
    "playwright-search": {
      "command": "node",
      "args": ["C:/path/to/your/playwright-search-mcp/dist/src/mcp-server.js"]
    }
  }
}
```

Note: For the second method, you must replace `C:/path/to/your/playwright-search-mcp` with the actual full path to where you installed the playwright-search-mcp package.

After integration, you can directly use search functionality in Claude, such as "search for the latest AI research".

## Search Engine Specific Usage

### Google Search
Google is the default search engine and provides the most comprehensive results:

```bash
# Basic Google search
playwright-search "artificial intelligence"

# Google search with Chinese keywords
playwright-search "人工智能"

# Google search with specific options
playwright-search --limit 20 --engine google "machine learning"
```

**Features:**
- Advanced anti-bot detection bypass
- Comprehensive search results
- Support for multiple languages
- Rich metadata extraction

### Baidu Search (百度搜索)
Baidu is China's largest search engine, optimized for Chinese content:

```bash
# Baidu search in Chinese
playwright-search --engine baidu "人工智能"

# Baidu search with English keywords
playwright-search --engine baidu "machine learning"

# Baidu search with specific options
playwright-search --engine baidu --limit 15 "深度学习"
```

**Features:**
- Optimized for Chinese language processing
- Access to Chinese-specific content and services
- Baidu Baike integration
- News and academic search support

### Zhihu Search (知乎搜索)
Zhihu is a Chinese Q&A platform with high-quality community content:

```bash
# Zhihu search for questions and answers
playwright-search --engine zhihu "如何学习编程"

# Zhihu search for specific topics
playwright-search --engine zhihu "Python入门"

# Zhihu search with English keywords
playwright-search --engine zhihu "programming tutorial"
```

**Features:**
- Community-driven Q&A content
- High-quality expert answers
- Topic-based content organization
- Rich multimedia content support

### Bing Search
Microsoft's search engine with good international coverage:

```bash
# Bing search
playwright-search --engine bing "web development"

# Bing search with specific options
playwright-search --engine bing --limit 25 "AI tools"
```

**Features:**
- Good international content coverage
- Microsoft ecosystem integration
- Visual search capabilities
- News and image search support

### DuckDuckGo Search
Privacy-focused search engine:

```bash
# DuckDuckGo search
playwright-search --engine duckduckgo "privacy tools"

# DuckDuckGo search with specific options
playwright-search --engine duckduckgo --limit 10 "anonymous browsing"
```

**Features:**
- Privacy-focused (no tracking)
- Instant answers
- Bang commands support
- Clean, ad-free interface

### Custom Search Engine Configuration
You can easily add support for new search engines by creating custom selectors and parsers:

```typescript
// Example: Adding a custom search engine
const customEngine = {
  name: 'my-search-engine',
  searchUrl: 'https://mysearchengine.com/search?q={query}',
  selectors: {
    results: '.search-result',
    title: '.result-title',
    link: '.result-link',
    snippet: '.result-snippet'
  }
};
```

## Project Structure

```
playwright-search-mcp/
├── package.json          # Project configuration and dependencies
├── tsconfig.json         # TypeScript configuration
├── src/
│   ├── index.ts          # Entry file (command line parsing and main logic)
│   ├── search.ts         # Search functionality implementation (Playwright browser automation)
│   ├── mcp-server.ts     # MCP server implementation
│   └── types.ts          # Type definitions (interfaces and type declarations)
├── dist/                 # Compiled JavaScript files
├── bin/                  # Executable files
│   └── playwright-search     # Command line entry script
├── README.md             # Project documentation
└── .gitignore            # Git ignore file
```

## Technology Stack

- **TypeScript**: Development language, providing type safety and better development experience
- **Node.js**: Runtime environment for executing JavaScript/TypeScript code
- **Playwright**: For browser automation, supporting multiple browsers
- **Commander**: For parsing command line arguments and generating help information
- **Model Context Protocol (MCP)**: Open protocol for AI assistant integration
- **MCP SDK**: Development toolkit for implementing MCP servers
- **Zod**: Schema definition library for validation and type safety
- **pnpm**: Efficient package management tool, saving disk space and installation time

## Development Guide

All commands can be run in the project root directory:

```bash
# Install dependencies
pnpm install

# Install Playwright browsers
pnpm run postinstall

# Compile TypeScript code
pnpm build

# Clean compiled output
pnpm clean
```

### CLI Development

```bash
# Run in development mode
pnpm dev "search keywords"

# Run in debug mode (showing browser interface)
pnpm debug "search keywords"

# Run compiled code
pnpm start "search keywords"

# Test search functionality
pnpm test
```

### MCP Server Development

```bash
# Run MCP server in development mode
pnpm mcp

# Run compiled MCP server
pnpm mcp:build
```

## Error Handling

The tool has built-in robust error handling mechanisms:

- Friendly error messages when browser startup fails
- Automatic error status return for network connection issues
- Detailed logs for search result parsing failures
- Graceful exit and useful information return in timeout situations

## Notes

### General Notes

- This tool is for learning and research purposes only
- Please comply with Google's terms of service and policies
- Do not send requests too frequently to avoid being blocked by Google
- Some regions may require a proxy to access Google
- Playwright needs to install browsers, which will be automatically downloaded on first use

### State Files

- State files contain browser cookies and storage data, please keep them secure
- **All search engines share the same state and fingerprint files**, providing consistent browser identity across different search engines
- Using state files can effectively avoid anti-bot detection and improve search success rate across all supported search engines

### MCP Server

- MCP server requires Node.js v16 or higher
- When using the MCP server, please ensure Claude Desktop is updated to the latest version
- When configuring Claude Desktop, use absolute paths to the MCP server file

### Windows-Specific Notes

- In Windows environments, you may need administrator privileges to install Playwright browsers for the first time
- If you encounter permission issues, try running Command Prompt or PowerShell as administrator
- Windows Firewall may block Playwright browser network connections; allow access when prompted
- Browser state and fingerprint files are saved by default in the user's home directory as `browser-state.json` and `browser-state-fingerprint.json`
- Log files are stored in the system temporary directory under the `playwright-search-logs` folder

## Multi-Search Engine Advantages

### Why Use Multiple Search Engines?

1. **Content Diversity**: Different search engines index different content, providing more comprehensive results
2. **Language Optimization**: Some engines are better optimized for specific languages (e.g., Baidu for Chinese)
3. **Regional Coverage**: Access to region-specific content and services
4. **Anti-Bot Resilience**: If one engine blocks requests, others remain available
5. **Specialized Content**: Some engines focus on specific types of content (e.g., Zhihu for Q&A)

### Use Cases

- **Research**: Compare results across multiple engines for comprehensive information
- **Localization**: Use region-specific engines for local content and services
- **Backup Strategy**: Maintain multiple search options when one engine is unavailable
- **Content Discovery**: Find content that might be missed by using only one search engine
- **Language Learning**: Access content in different languages through appropriate engines

### Performance Considerations

- Each search engine may have different response times
- Some engines may require different anti-bot strategies
- Browser state management is consistent across all engines
- Rate limiting and blocking policies differ across platforms

## Comparison with Commercial SERP APIs

Compared to paid search engine results API services (such as SerpAPI), this project offers the following advantages:

- **Completely Free**: No API call fees
- **Local Execution**: All searches are executed locally, no dependency on third-party services
- **Privacy Protection**: Search queries are not recorded by third parties
- **Customizability**: Fully open source, can be modified and extended as needed
- **No Usage Limits**: Not subject to API call count or frequency limitations
- **MCP Integration**: Native support for integration with AI assistants like Claude
