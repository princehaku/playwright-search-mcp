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
import { googleSearch, getGoogleSearchPageHtml } from "./search.js";
import { CommandOptions } from "./types.js";
import packageJson from "../package.json" with { type: "json" };

// 创建命令行程序
const program = new Command();

// 配置命令行选项
program
  .name("google-search")
  .description("基于 Playwright 的 Google 搜索 CLI 工具")
  .version(packageJson.version)
  .argument("<query>", "搜索关键词")
  .option("-l, --limit <number>", "结果数量限制", parseInt, 10)
  .option("-t, --timeout <number>", "超时时间(毫秒)", parseInt, 30000)
  .option("--no-headless", "已废弃: 现在总是先尝试无头模式，如果遇到人机验证会自动切换到有头模式")
  .option("--state-file <path>", "浏览器状态文件路径", "./browser-state.json")
  .option("--no-save-state", "不保存浏览器状态")
  .option("--get-html", "获取搜索结果页面的原始HTML而不是解析结果")
  .option("--save-html", "将HTML保存到文件")
  .option("--html-output <path>", "HTML输出文件路径")
  .option("--proxy <url>", "代理服务器(示例: socks5://127.0.0.1:1080)")
  .action(async (query: string, options: CommandOptions & { getHtml?: boolean, saveHtml?: boolean, htmlOutput?: string }) => {
    try {
      if (options.getHtml) {
        // 获取HTML
        const htmlResult = await getGoogleSearchPageHtml(
          query,
          options,
          options.saveHtml || false,
          options.htmlOutput
        );

        // 如果保存了HTML到文件，在输出中包含文件路径信息
        if (options.saveHtml && htmlResult.savedPath) {
          console.log(`HTML已保存到文件: ${htmlResult.savedPath}`);
        }

        // 输出结果（不包含完整HTML，避免控制台输出过多）
        const outputResult = {
          query: htmlResult.query,
          url: htmlResult.url,
          originalHtmlLength: htmlResult.originalHtmlLength, // 原始HTML长度（包含CSS和JavaScript）
          cleanedHtmlLength: htmlResult.html.length, // 清理后的HTML长度（不包含CSS和JavaScript）
          savedPath: htmlResult.savedPath,
          screenshotPath: htmlResult.screenshotPath, // 网页截图保存路径
          // 只输出HTML的前500个字符作为预览
          htmlPreview: htmlResult.html.substring(0, 500) + (htmlResult.html.length > 500 ? '...' : '')
        };
        
        console.log(JSON.stringify(outputResult, null, 2));
      } else {
        // 执行常规搜索
        const results = await googleSearch(query, options);
        
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
