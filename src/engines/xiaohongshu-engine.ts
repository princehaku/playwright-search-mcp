import { Browser, Page } from "playwright";
import { SearchResponse, SearchResult, CommandOptions } from "../types.js";
import { BaseSearchEngine, SearchEngineConfig } from "./base.js";
import { ChromiumBrowserManager } from "./chromium-manager.js";
import { FingerprintConfig } from "./browser-manager.js";
import logger from "../logger.js";

// 小红书搜索引擎配置
const XHS_CONFIG: SearchEngineConfig = {
  id: "xhs",
  name: "小红书",
  baseUrl: "https://www.xiaohongshu.com",
  searchPath: "/search_result?keyword=",
  selectors: {
    resultContainer: "section.note-item",
    title: "a.title",
    link: 'a[href^="/explore/"]',
    snippet: ".author .name",
  },
  headers: {
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  },
  antiBot: true,
  customDelay: {
    min: 2500,
    max: 6000,
  },
};

// 小红书搜索结果解析器
class XiaohongshuResultParser {
  async parseResults(page: Page, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    try {
      // 等待搜索结果加载
      await page.waitForSelector(XHS_CONFIG.selectors.resultContainer, {
        timeout: 20000,
      });

      // 获取所有搜索结果
      const resultElements = await page.$$(XHS_CONFIG.selectors.resultContainer);
      
      for (let i = 0; i < Math.min(resultElements.length, limit); i++) {
        const element = resultElements[i];
        
        try {
          // 提取标题和链接
          const titleElement = await element.$(XHS_CONFIG.selectors.title);
          const linkElement = await element.$(XHS_CONFIG.selectors.link);
          
          if (!titleElement || !linkElement) continue;
          
          const title = await titleElement.textContent();
          const href = await linkElement.getAttribute("href");
          
          if (!title || !href) continue;
          
          // 验证链接
          if (!this.isValidXiaohongshuLink(href)) continue;

          const link = href.startsWith("/") ? `${XHS_CONFIG.baseUrl}${href}` : href;
          
          // 提取摘要
          const snippetElement = await element.$(XHS_CONFIG.selectors.snippet);
          const snippet = snippetElement ? await snippetElement.textContent() : "";
          
          results.push({
            title: this.cleanText(title),
            link: link,
            snippet: this.cleanText(snippet),
          });
        } catch (e) {
          logger.warn({ error: e }, "解析小红书搜索结果元素失败");
        }
      }
    } catch (e) {
      logger.warn({ error: e }, "等待小红书搜索结果超时");
    }
    
    return results;
  }

  private isValidXiaohongshuLink(href: string): boolean {
    // 小红书搜索结果链接通常以 /explore/ 开头
    return href.startsWith("/explore/") || 
           href.startsWith("http") || 
           href.includes("xiaohongshu.com");
  }

  private cleanText(text?: string | null): string {
    return (text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}

// 小红书搜索引擎实现
export class XiaohongshuSearchEngine extends BaseSearchEngine {
  private browserManager: ChromiumBrowserManager;
  private resultParser: XiaohongshuResultParser;

  constructor(options: CommandOptions = {}) {
    super(XHS_CONFIG, options);
    this.browserManager = new ChromiumBrowserManager(options);
    this.resultParser = new XiaohongshuResultParser();
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
      const proxy = this.getProxy();
      const context = await this.browserManager.createContext(
        browser,
        fingerprint,
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
        engine: "小红书",
      }, "小红书搜索完成");

      return {
        query,
        results,
        totalResults: results.length,
        searchTime: duration,
        engine: "小红书",
      };

    } catch (error) {
      logger.error({ error, query }, "小红书搜索失败");
      throw error;
    } finally {
      if (!browserWasProvided && browser) {
        await browser.close();
      }
    }
  }

  protected async navigateToSearchPage(
    page: Page,
    query: string
  ): Promise<void> {
    const searchUrl = this.buildSearchUrl(query);
    logger.info({ url: searchUrl }, `正在导航到${this.config.name}搜索页面`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  }

  protected async handleAntiBot(page: Page): Promise<void> {
    try {
      const loginPopupSelector1 = 'div:text("登录后查看搜索结果")';
      const loginPopupSelector2 =
        'div:text-matches("可用\\\\s*小红书\\\\s*或\\\\s*微信\\\\s*扫码")';

      // Wait for either of the selectors to be visible
      await Promise.any([
        page.waitForSelector(loginPopupSelector1, {
          state: "visible",
          timeout: 5000,
        }),
        page.waitForSelector(loginPopupSelector2, {
          state: "visible",
          timeout: 5000,
        }),
      ]);

      logger.warn("检测到小红书登录弹窗，搜索可能无法继续。");
    } catch (error) {
      // If neither selector is found within the timeout, proceed.
      logger.info("未检测到小红书登录弹窗，执行通用反爬虫措施。");
      await super.handleAntiBot(page);
    }
  }

  private async getFingerprint(): Promise<FingerprintConfig> {
    return this.browserManager.getHostMachineConfig(this.options.locale);
  }
}
