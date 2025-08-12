import { Browser, BrowserContext, Page } from "playwright";
import { SearchResponse, SearchResult, CommandOptions } from "../types.js";
import logger from "../logger.js";
import * as fs from "fs/promises";
import * as path from "path";

// 搜索引擎配置接口
export interface SearchEngineConfig {
  name: string;
  baseUrl: string;
  searchPath: string;
  selectors: {
    resultContainer: string;
    title: string;
    link: string;
    snippet: string;
  };
  headers?: Record<string, string>;
  userAgent?: string;
  antiBot?: boolean;
  customDelay?: {
    min: number;
    max: number;
  };
}

// 搜索结果解析器接口
export interface ResultParser {
  parseResults(page: Page, limit: number): Promise<SearchResult[]>;
}

// 基础搜索引擎抽象类
export abstract class BaseSearchEngine {
  protected config: SearchEngineConfig;
  protected options: CommandOptions;

  constructor(config: SearchEngineConfig, options: CommandOptions = {}) {
    this.config = config;
    this.options = options;
  }

  // 抽象方法：子类必须实现
  abstract performSearch(
    query: string,
    headless: boolean,
    existingBrowser?: Browser
  ): Promise<SearchResponse>;

  // 通用方法：保存HTML内容
  protected async saveHtml(page: Page, query: string): Promise<void> {
    if (this.options.saveHtml) {
      try {
        const html = await page.content();
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `${this.config.name}-${query.replace(
          /\s/g,
          "_"
        )}-${timestamp}.html`;
        const dir = "search_results";
        await fs.mkdir(dir, { recursive: true });
        const filepath = path.join(dir, filename);
        await fs.writeFile(filepath, html);
        logger.info({ filepath }, "HTML content saved.");
      } catch (e) {
        logger.error({ error: e }, "Failed to save HTML file.");
      }
    }
  }

  // 通用方法：创建浏览器上下文
  protected async createBrowserContext(
    browser: Browser,
    fingerprint?: any
  ): Promise<BrowserContext> {
    const contextOptions: any = {
      locale: this.options.locale || "zh-CN",
      timezoneId: fingerprint?.timezoneId || "Asia/Shanghai",
      colorScheme: fingerprint?.colorScheme || "light",
      reducedMotion: fingerprint?.reducedMotion || "no-preference",
      forcedColors: fingerprint?.forcedColors || "none",
    };

    if (fingerprint?.deviceName) {
      contextOptions.viewport = fingerprint.viewport;
      contextOptions.userAgent = fingerprint.userAgent;
    }

    if (this.options.proxy) {
      contextOptions.proxy = this.parseProxyConfig(this.options.proxy);
    }

    return await browser.newContext(contextOptions);
  }

  // 通用方法：导航到搜索页面
  protected async navigateToSearchPage(
    page: Page,
    query: string
  ): Promise<void> {
    const searchUrl = this.buildSearchUrl(query);
    logger.info({ url: searchUrl }, `正在导航到${this.config.name}搜索页面`);
    
    await page.goto(searchUrl, { waitUntil: "networkidle" });
    
    // 应用自定义延迟
    if (this.config.customDelay) {
      const delay = this.getRandomDelay(
        this.config.customDelay.min,
        this.config.customDelay.max
      );
      await page.waitForTimeout(delay);
    }
  }

  // 通用方法：构建搜索URL
  protected buildSearchUrl(query: string): string {
    const encodedQuery = encodeURIComponent(query);
    return `${this.config.baseUrl}${this.config.searchPath}${encodedQuery}`;
  }

  // 通用方法：设置页面头信息
  protected async setupPageHeaders(page: Page): Promise<void> {
    if (this.config.headers) {
      await page.setExtraHTTPHeaders(this.config.headers);
    }
  }

  // 通用方法：等待页面加载
  protected async waitForPageLoad(page: Page): Promise<void> {
    try {
      await page.waitForSelector(this.config.selectors.resultContainer, {
        timeout: 10000,
      });
    } catch (e) {
      logger.warn("等待搜索结果超时，继续处理");
    }
  }

  // 通用方法：解析代理配置
  protected parseProxyConfig(proxyUrl: string): any {
    try {
      const u = new URL(proxyUrl);
      const server = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`;
      const cfg: { server: string; username?: string; password?: string } = {
        server,
      };
      if (u.username) cfg.username = decodeURIComponent(u.username);
      if (u.password) cfg.password = decodeURIComponent(u.password);
      return cfg;
    } catch (e) {
      logger.warn({ proxy: proxyUrl }, "代理URL解析失败");
      return { server: proxyUrl };
    }
  }

  // 通用方法：获取随机延迟
  protected getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // 通用方法：清理文本
  protected cleanText(text?: string | null): string {
    return (text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 通用方法：验证链接
  protected isValidLink(href: string): boolean {
    try {
      const url = new URL(href, this.config.baseUrl);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  // 通用方法：创建搜索结果
  protected createSearchResult(
    title: string,
    link: string,
    snippet: string
  ): SearchResult {
    return {
      title: this.cleanText(title),
      link: this.cleanText(link),
      snippet: this.cleanText(snippet),
    };
  }

  // 通用方法：处理反机器人检测
  protected async handleAntiBot(page: Page): Promise<void> {
    if (!this.config.antiBot) return;

    // 随机鼠标移动
    await page.mouse.move(
      Math.random() * 800,
      Math.random() * 600
    );

    // 随机滚动
    await page.evaluate(() => {
      window.scrollTo(0, Math.random() * 100);
    });

    // 等待随机时间
    await page.waitForTimeout(this.getRandomDelay(1000, 3000));
  }
}
