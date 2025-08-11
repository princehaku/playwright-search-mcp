import { Browser, Page } from "playwright";
import { SearchResponse, SearchResult, CommandOptions } from "../types.js";
import { BaseSearchEngine, SearchEngineConfig } from "./base.js";
import { ChromiumBrowserManager } from "./chromium-manager.js";
import { FingerprintConfig } from "./browser-manager.js";
import logger from "../logger.js";
import fs from "fs";

// Google搜索引擎配置
const GOOGLE_CONFIG: SearchEngineConfig = {
  name: "Google",
  baseUrl: "https://www.google.com",
  searchPath: "/search?q=",
  selectors: {
    resultContainer: "div[data-sokoban-container]", // 使用更稳定的外层容器
    title: "h3",
    link: "a",
    snippet: "div[data-sncf='1']",
  },
  headers: {
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  },
  antiBot: true,
  customDelay: {
    min: 1000,
    max: 3000,
  },
};

// 全新的智能搜索结果解析器
class GoogleResultParser {
  async parseResults(page: Page, limit: number): Promise<SearchResult[]> {
    logger.info("启动Google智能解析器...");
    
    try {
      // 等待页面加载完成
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      logger.info("页面网络稳定，开始执行页面评估...");

      const results = await page.evaluate((limit) => {
        const extractedResults: SearchResult[] = [];
        const links = Array.from(document.querySelectorAll('a'));

        for (const link of links) {
          if (extractedResults.length >= limit) break;

          const h3 = link.querySelector('h3');
          if (h3 && h3.textContent) {
            const href = link.href;
            const title = h3.textContent;
            
            // 查找摘要：通常是链接父元素的下一个兄弟元素中的文本
            let snippet = '';
            const parent = link.parentElement;
            if (parent) {
                // 向上追溯几层，找到一个更有可能包含摘要的容器
                let container = parent.closest('div[data-sokoban-container], div.g, div.s, [role="main"] > div > div');
                if (container) {
                    const snippetNode = container.querySelector('div[data-sncf="1"], .s, .VwiC3b');
                    if(snippetNode) {
                        snippet = (snippetNode as HTMLElement).innerText;
                    }
                }
            }

            // 过滤掉无效或非搜索结果的链接
            if (href && title && !href.startsWith('javascript:') && href.includes('http')) {
              extractedResults.push({
                title: title.trim(),
                link: href,
                snippet: snippet.trim(),
              });
            }
          }
        }
        return extractedResults;
      }, limit);

      logger.info(`智能解析器提取到 ${results.length} 个结果`);

      if (results.length === 0) {
        logger.warn("智能解析器未提取到任何结果，将截图用于调试。");
        await page.screenshot({ path: 'google-screenshot.png', fullPage: true });
        logger.info("调试截图已保存到 google-screenshot.png");
      }
      
      return results;

    } catch (e) {
      logger.error({ error: e }, "智能解析时发生严重错误");
      await page.screenshot({ path: 'google-error-screenshot.png', fullPage: true });
      logger.info("错误截图已保存到 google-error-screenshot.png");
      return [];
    }
  }
}

// Google搜索引擎实现 - 其他部分保持不变
export class GoogleSearchEngine extends BaseSearchEngine {
  private browserManager: ChromiumBrowserManager;
  private resultParser: GoogleResultParser;

  constructor(options: CommandOptions = {}) {
    super(GOOGLE_CONFIG, options);
    this.browserManager = new ChromiumBrowserManager(options);
    this.resultParser = new GoogleResultParser();
  }

  async performSearch(
    query: string,
    headless: boolean,
    existingBrowser?: Browser
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    let browser: Browser | undefined = existingBrowser;
    let browserWasProvided = !!existingBrowser;

    try {
      if (!browser) {
        browser = await this.browserManager.createBrowser();
        logger.info("创建了新的浏览器实例");
      } else {
        logger.info("使用已存在的浏览器实例");
      }

      // 创建浏览器上下文
      const fingerprint = await this.getFingerprint();
      const context = await this.browserManager.createContext(browser, fingerprint);
      
      // 创建新页面
      const page = await context.newPage();
      
      // 设置页面头信息
      await this.setupPageHeaders(page);
      
      // 导航到搜索页面
      await this.navigateToSearchPage(page, query);
      
      // 处理反机器人检测
      await this.handleAntiBot(page);
      
      // 解析器现在自己处理等待，移除这里的冗余等待
      // await this.waitForPageLoad(page);
      
      // 解析搜索结果
      const results = await this.resultParser.parseResults(page, this.options.limit || 10);
      
      // 保存状态和指纹
      await this.browserManager.saveStateAndFingerprint(
        context,
        fingerprint,
        this.options.noSaveState
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      logger.info({
        query,
        resultsCount: results.length,
        duration,
        engine: "Google",
      }, "Google搜索完成");

      return {
        query,
        results,
        totalResults: results.length,
        searchTime: duration,
        engine: "Google",
      };

    } catch (error) {
      logger.error({ error, query }, "Google搜索失败");
      throw error;
    } finally {
      if (!browserWasProvided && browser) {
        await browser.close();
      }
    }
  }

  private async getFingerprint(): Promise<FingerprintConfig> {
    // 这里可以实现更复杂的指纹生成逻辑
    return this.browserManager.getHostMachineConfig(this.options.locale);
  }
}
