#!/usr/bin/env node

// 设置控制台编码为 UTF-8，确保中文字符正确显示
if (process.platform === 'win32') {
  // Windows 平台特殊处理
  process.env.LANG = 'zh_CN.UTF-8';
  // 尝试设置控制台代码页为 UTF-8
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch (e) {
    // 忽略错误，继续执行
  }
  
  // 设置 stdout 和 stderr 的编码
  if (process.stdout.setDefaultEncoding) {
    process.stdout.setDefaultEncoding('utf8');
  }
  if (process.stderr.setDefaultEncoding) {
    process.stderr.setDefaultEncoding('utf8');
  }
}

import { Command } from "commander";
import { search } from "./search-refactored.js";
import { CommandOptions } from "./types.js";
import packageJson from "../package.json" with { type: "json" };

// 创建命令行程序
const program = new Command();

// 配置命令行选项
program
  .name("playwright-search")
  .description("基于 Playwright 的搜索引擎 MCP 工具")
  .version(packageJson.version)
  .argument("<query>", "搜索关键词")
  .option("-l, --limit <number>", "结果数量限制", parseInt, 10)
  .option("-t, --timeout <number>", "超时时间(毫秒)", parseInt, 30000)
  .option("--no-headless", "以有头模式启动浏览器（默认使用无头模式，遇到人机验证会自动切换为有头模式）")
  .option("--user-data-dir [path]", "浏览器用户数据目录，默认在用户根目录下.playwright-search")
  .option("--no-save-state", "不保存浏览器状态")
  .option("--get-html", "获取搜索结果页面的原始HTML而不是解析结果")
  .option("--save-html", "将HTML保存到文件")
  .option("--html-output <path>", "HTML输出文件路径")
  .option("--proxy <url>", "代理服务器(示例: socks5://127.0.0.1:1080)")
  .option("-e, --engine <engine>", "搜索引擎 (google|baidu|zhihu|xhs|xiaohongshu)", "google")
  .action(async (query: string, options: CommandOptions & { getHtml?: boolean, saveHtml?: boolean, htmlOutput?: string }) => {
    try {
      // HTML获取功能暂时移除，专注核心搜索
      if (options.getHtml) {
        console.error("--get-html 功能正在重构中，请稍后使用。");
        process.exit(2);
      } else {
        // 直接使用 commander 解析后的 options
        const results = await search(query, options);
        
        // 输出结果
        console.log(JSON.stringify(results, null, 2));
      }
    } catch (error) {
      console.error("错误:", error);
      process.exit(1);
    }
  });

// 解析命令行参数
program.parse(process.argv);
