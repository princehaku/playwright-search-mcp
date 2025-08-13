import { Page } from "playwright";
import { SearchResult, CommandOptions } from "../types.js";
import { BaseSearchEngine, SearchEngineConfig } from "./base.js";
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
    snippet: "img",
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
          
          // 提取图片URL作为snippet
          let snippet = "";
          const imgElement = await element.$(XHS_CONFIG.selectors.snippet);
          if (imgElement) {
            snippet = await imgElement.getAttribute("src") || await imgElement.getAttribute("data-src") || "";
          }
          
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
  private resultParser: XiaohongshuResultParser;

  constructor(
    page: Page,
    options: CommandOptions = {},
    browserManager: any
  ) {
    const engineState = browserManager.loadEngineState(XHS_CONFIG.id);
    super(XHS_CONFIG, page, options, browserManager, engineState);
    this.resultParser = new XiaohongshuResultParser();
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
      const results = await this.resultParser.parseResults(this.page, this.options.limit || 10);
      
      logger.info({
        query,
        resultsCount: results.length,
        engine: "小红书",
      }, "小红书搜索完成");

      return results;

    } catch (error) {
      logger.error({ error, query }, "小红书搜索失败");
      throw error;
    }
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

      await super.handleAntiBot(page);

      logger.warn("检测到小红书登录弹窗，搜索可能无法继续。");
    } catch (error) {
      // If neither selector is found within the timeout, proceed.
      logger.info("未检测到小红书登录弹窗");
    }
  }


}
