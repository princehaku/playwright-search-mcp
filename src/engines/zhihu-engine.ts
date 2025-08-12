import { Browser, Page } from "playwright";
import { SearchResponse, SearchResult, CommandOptions } from "../types.js";
import { BaseSearchEngine, SearchEngineConfig, EngineState } from "./base.js";
import { ChromiumBrowserManager } from "./chromium-manager.js";
import { FingerprintConfig } from "./browser-manager.js";
import logger from "../logger.js";

// 知乎搜索引擎配置
const ZHIHU_CONFIG: SearchEngineConfig = {
  id: "zhihu",
  name: "知乎",
  baseUrl: "https://www.zhihu.com",
  searchPath: "/search?type=content&q=",
  selectors: {
    resultContainer: "div.Search-result",
    title: "h2.ContentItem-title a",
    link: "h2.ContentItem-title a",
    snippet: "div.ContentItem-content",
  },
  headers: {
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  },
  antiBot: true,
  customDelay: {
    min: 2000,
    max: 5000,
  },
};

// 知乎搜索结果解析器
class ZhihuResultParser {
  async parseResults(page: Page, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    try {
      // 等待搜索结果加载
      await page.waitForSelector(ZHIHU_CONFIG.selectors.resultContainer, {
        timeout: 15000,
      });

      // 获取所有搜索结果
      const resultElements = await page.$$(ZHIHU_CONFIG.selectors.resultContainer);
      
      for (let i = 0; i < Math.min(resultElements.length, limit); i++) {
        const element = resultElements[i];
        
        try {
          // 提取标题和链接
          const titleElement = await element.$(ZHIHU_CONFIG.selectors.title);
          
          if (!titleElement) continue;
          
          const title = await titleElement.textContent();
          const href = await titleElement.getAttribute("href");
          
          if (!title || !href) continue;
          
          // 验证链接
          if (!this.isValidZhihuLink(href)) continue;
          
          // 提取摘要
          const snippetElement = await element.$(ZHIHU_CONFIG.selectors.snippet);
          const snippet = snippetElement ? await snippetElement.textContent() : "";
          
          results.push({
            title: this.cleanText(title),
            link: this.cleanText(href),
            snippet: this.cleanText(snippet),
          });
        } catch (e) {
          logger.warn({ error: e }, "解析知乎搜索结果元素失败");
        }
      }
    } catch (e) {
      logger.warn({ error: e }, "等待知乎搜索结果超时");
    }
    
    return results;
  }

  private isValidZhihuLink(href: string): boolean {
    // 知乎搜索结果链接通常以 /question/ 或 /answer/ 开头
    return href.startsWith("/question/") || 
           href.startsWith("/answer/") || 
           href.startsWith("http");
  }

  private cleanText(text?: string | null): string {
    return (text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}

// 知乎搜索引擎实现
export class ZhihuSearchEngine extends BaseSearchEngine {
  private browserManager: ChromiumBrowserManager;
  private resultParser: ZhihuResultParser;

  constructor(options: CommandOptions = {}) {
    const browserManager = new ChromiumBrowserManager(options);
    const engineState = browserManager.loadEngineState(ZHIHU_CONFIG.id);
    super(ZHIHU_CONFIG, options, engineState);
    this.browserManager = browserManager;
    this.resultParser = new ZhihuResultParser();
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

      // 获取代理和指纹
      const proxy = this.getProxy();
      const fingerprint =
        this.engineState.fingerprint ||
        this.browserManager.getHostMachineConfig(this.options.locale);

      // 创建浏览器上下文
      const context = await this.browserManager.createContext(
        browser,
        { ...this.engineState, fingerprint },
        proxy
      );
      
      // 创建新页面
      const page = await context.newPage();
      
      // 设置页面头信息
      await this.setupPageHeaders(page);
      
      // 导航到搜索页面
      await this.navigateToSearchPage(page, query);
      
      // 处理反机器人检测
      await this.handleAntiBot(page);
      
      // 等待页面加载
      await this.waitForPageLoad(page);

      await this.saveHtml(page, query);
      
      // 解析搜索结果
      const results = await this.resultParser.parseResults(page, this.options.limit || 10);
      
      // 更新并保存状态
      const newEngineState: EngineState = {
        ...this.engineState,
        fingerprint,
        proxy,
      };
      await this.browserManager.saveStateAndFingerprint(
        context,
        this.config.id,
        newEngineState,
        this.options.noSaveState
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      logger.info({
        query,
        resultsCount: results.length,
        duration,
        engine: "知乎",
      }, "知乎搜索完成");

      return {
        query,
        results,
        totalResults: results.length,
        searchTime: duration,
        engine: "知乎",
      };

    } catch (error) {
      logger.error({ error, query }, "知乎搜索失败");
      throw error;
    } finally {
      if (!browserWasProvided && browser) {
        await browser.close();
      }
    }
  }

  private async getFingerprint(): Promise<FingerprintConfig> {
    return this.browserManager.getHostMachineConfig(this.options.locale);
  }
}
