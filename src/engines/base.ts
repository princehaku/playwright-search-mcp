import { Browser, BrowserContext, Page } from "playwright";
import {
  SearchResponse,
  SearchResult,
  CommandOptions,
  EngineState,
} from "../types.js";
import { BaseBrowserManager } from "./browser-manager.js";
import { UniversalResultParser } from "./universal-parser.js";
import { ConfigLoader } from "./config-loader.js";
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
  antiBot?: {
    enabled: boolean;
    detectors: string[];
    errorMessage: string;
  };
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

// 配置化的搜索引擎类
export class ConfigurableSearchEngine {
  protected page: Page;
  protected options: CommandOptions;
  protected browserManager: BaseBrowserManager;
  protected config: SearchEngineConfig;
  protected engineState: EngineState;
  protected parser: UniversalResultParser;
  protected configLoader: ConfigLoader;

  constructor(
    config: SearchEngineConfig,
    page: Page,
    options: CommandOptions,
    browserManager: BaseBrowserManager,
    engineState: EngineState = {}
  ) {
    this.config = config;
    this.page = page;
    this.options = options;
    this.browserManager = browserManager;
    this.engineState = engineState;
    this.parser = new UniversalResultParser(config);
    this.configLoader = ConfigLoader.getInstance();
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      // 设置页面头信息
      await this.setupPageHeaders(this.page);
      
      // 导航到搜索页面
      await this.navigateToSearchPage(this.page, query);
      
      // 处理反机器人检测
      await this.handleAntiBot(this.page);
      
      // 等待页面加载
      await this.waitForPageLoad(this.page);
      
      await this.saveHtml(this.page, query);
      
      // 解析搜索结果
      const results = await this.parser.parseResults(this.page, this.options.limit || 10);
      
      logger.info({
        query,
        resultsCount: results.length,
        engine: this.config.name,
      }, `${this.config.name}搜索完成`);

      return results;

    } catch (error) {
      logger.error({ error, query }, `${this.config.name}搜索失败`);
      throw error;
    }
  }
  
  async getEngineState(): Promise<EngineState> {
    return this.engineState;
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
    if (!this.configLoader.isAntiBotEnabled(this.config.id)) return;

    // 获取引擎特定的反爬虫检测器
    const detectors = this.configLoader.getAntiBotDetectors(this.config.id);
    
    if (detectors.length > 0) {
      logger.info(`开始检测${this.config.name}反爬虫机制...`);
      
      for (const selector of detectors) {
        try {
          const element = page.locator(selector).first();
          const count = await page.locator(selector).count();
          
          if (count > 0 && await element.isVisible({ timeout: 1000 })) {
            logger.warn(`检测到${this.config.name}反爬虫机制！匹配选择器: "${selector}"`);
            
            // 执行通用反爬虫措施
            await page.waitForTimeout(120000);
            
            // 使用配置中的错误消息
            const errorMessage = this.configLoader.getAntiBotErrorMessage(this.config.id);
            throw new Error(errorMessage);
          }
        } catch (e) {
          if (e instanceof Error && (e.message.includes("需要") || e.message.includes("验证") || e.message.includes("登录"))) {
            throw e;
          }
          logger.debug(`${this.config.name}选择器 "${selector}" 检测失败: ${e}`);
        }
      }
      
      logger.info(`未检测到${this.config.name}反爬虫机制，继续执行。`);
    }

    // 执行基本的反检测措施
    await this.performAntiDetectionMeasures(page);
  }

  private async performAntiDetectionMeasures(page: Page): Promise<void> {
    // 随机鼠标移动
    await page.mouse.move(
      Math.random() * 800,
      Math.random() * 600
    );

    // 随机滚动
    await page.evaluate(() => {
      window.scrollTo(0, Math.random() * 500);
    });

    // 短暂等待
    await page.waitForTimeout(1000 + Math.random() * 2000);
  }
}
