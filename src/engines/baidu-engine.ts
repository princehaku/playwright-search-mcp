import { Page } from "playwright";
import { SearchResult, CommandOptions } from "../types.js";
import { BaseSearchEngine, SearchEngineConfig } from "./base.js";
import logger from "../logger.js";

// 百度搜索引擎配置
const BAIDU_CONFIG: SearchEngineConfig = {
  id: "baidu",
  name: "百度",
  baseUrl: "https://www.baidu.com",
  searchPath: "/s?wd=",
  selectors: {
    resultContainer: "div.result",
    title: "h3.t a",
    link: "h3.t a",
    snippet: '[data-module="abstract"], [data-module="sc_p"]',
  },
  headers: {
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  },
  antiBot: true,
  customDelay: {
    min: 1500,
    max: 4000,
  },
};

// 百度搜索结果解析器
class BaiduResultParser {
  async parseResults(page: Page, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    try {
      // 等待搜索结果加载
      await page.waitForSelector(BAIDU_CONFIG.selectors.resultContainer, {
        timeout: 10000,
      });

      // 获取所有搜索结果
      const resultElements = await page.$$(BAIDU_CONFIG.selectors.resultContainer);
      
      for (let i = 0; i < Math.min(resultElements.length, limit); i++) {
        const element = resultElements[i];
        
        try {
          // 提取标题和链接
          const titleElement = await element.$(BAIDU_CONFIG.selectors.title);
          
          if (!titleElement) continue;
          
          const title = await titleElement.textContent();
          const href = await titleElement.getAttribute("href");
          
          if (!title || !href) continue;
          
          // 验证链接
          if (!this.isValidBaiduLink(href)) continue;
          
          // 提取摘要
          const snippetElement = await element.$(BAIDU_CONFIG.selectors.snippet);
          const snippet = snippetElement ? await snippetElement.textContent() : "";
          
          results.push({
            title: this.cleanText(title),
            link: this.cleanText(href),
            snippet: this.cleanText(snippet),
          });
        } catch (e) {
          logger.warn({ error: e }, "解析百度搜索结果元素失败");
        }
      }
    } catch (e) {
      logger.warn({ error: e }, "等待百度搜索结果超时");
    }
    
    return results;
  }

  private isValidBaiduLink(href: string): boolean {
    // 百度搜索结果链接通常包含真实URL
    return href.includes("http") || href.includes("www");
  }

  private cleanText(text?: string | null): string {
    return (text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}

// 百度搜索引擎实现
export class BaiduSearchEngine extends BaseSearchEngine {
  private resultParser: BaiduResultParser;

  constructor(
    page: Page,
    options: CommandOptions = {},
    browserManager: any
  ) {
    const engineState = browserManager.loadEngineState(BAIDU_CONFIG.id);
    super(BAIDU_CONFIG, page, options, browserManager, engineState);
    this.resultParser = new BaiduResultParser();
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      // 设置页面头信息
      await this.setupPageHeaders(this.page);
      
      // 导航到搜索页面
      await this.navigateToSearchPage(this.page, query);
      
      // 等待页面加载
      await this.waitForPageLoad(this.page);
      
      await this.saveHtml(this.page, query);
      
      // 解析搜索结果
      const results = await this.resultParser.parseResults(this.page, this.options.limit || 10);
      
      logger.info({
        query,
        resultsCount: results.length,
        engine: "百度",
      }, "百度搜索完成");

      return results;

    } catch (error) {
      logger.error({ error, query }, "百度搜索失败");
      throw error;
    }
  }


}
