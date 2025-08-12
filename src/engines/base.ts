import { Browser, BrowserContext, Page } from "playwright";
import {
  SearchResponse,
  SearchResult,
  CommandOptions,
  EngineState,
} from "../types.js";
import logger from "../logger.js";
import * as fs from "fs/promises";
import * as path from "path";

// 搜索引擎配置接口
export interface SearchEngineConfig {
  id: string; // 搜索引擎的唯一标识符
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

// 导出EngineState以供其他模块使用
export type { EngineState };

// 搜索结果解析器接口
export interface ResultParser {
  parseResults(page: Page, limit: number): Promise<SearchResult[]>;
}

// 基础搜索引擎抽象类
export abstract class BaseSearchEngine {
  protected config: SearchEngineConfig;
  protected options: CommandOptions;
  protected engineState: EngineState; // 新增：存储当前引擎的状态

  constructor(
    config: SearchEngineConfig,
    options: CommandOptions = {},
    engineState: EngineState = {}
  ) {
    this.config = config;
    this.options = options;
    this.engineState = engineState;
  }

  // 更新：根据引擎配置获取代理
  protected getProxy(): string | undefined {
    const engineId = this.config.id;
    // 命令行传入的代理优先级更高
    if (this.options.engineProxy && this.options.engineProxy[engineId]) {
      return this.options.engineProxy[engineId];
    }
    // 其次是保存的状态中的代理
    if (this.engineState.proxy) {
      return this.engineState.proxy;
    }
    // 最后是全局代理
    return this.options.proxy;
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
  }
}
