import { Page } from "playwright";
import { SearchResult, CommandOptions } from "../types.js";
import {
  BaseSearchEngine,
  SearchEngineConfig,
  EngineState,
} from "./base.js";
import logger from "../logger.js";

// Google搜索引擎配置
const GOOGLE_CONFIG: SearchEngineConfig = {
  id: "google",
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
  private googleDomain: string;

  constructor(engineState: EngineState) {
    this.googleDomain = engineState.googleDomain || "https://www.google.com.hk";
  }

  async parseResults(page: Page, limit: number): Promise<SearchResult[]> {
    logger.info("启动Google智能解析器...");
    
    try {
      // 等待页面加载完成
      await page.waitForLoadState('networkidle', { timeout: 15000 });
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
      
      return results;

    } catch (e) {
      logger.error({ error: e }, "智能解析时发生严重错误");
      throw e; // 重新抛出错误，让调用者知道解析失败
    }
  }

  public getGoogleDomain(): string {
    return this.googleDomain;
  }
}

// Google搜索引擎实现 - 其他部分保持不变
export class GoogleSearchEngine extends BaseSearchEngine {
  private resultParser: GoogleResultParser;

  constructor(
    page: Page,
    options: CommandOptions = {},
    browserManager: any
  ) {
    const engineState = browserManager.loadEngineState(GOOGLE_CONFIG.id);
    super(GOOGLE_CONFIG, page, options, browserManager, engineState);
    this.resultParser = new GoogleResultParser(engineState);
  }

  protected async handleAntiBot(page: Page): Promise<void> {
    const recaptchaSelector = 'iframe[src*="recaptcha"]';
    try {
      // 使用 locator().count() 来避免等待
      const recaptchaCount = await page.locator(recaptchaSelector).count();
      
      if (recaptchaCount > 0) {
        logger.warn("检测到Google reCAPTCHA，需要人机验证。");
        // 调用基类方法，它包含更长的等待和随机操作
        await super.handleAntiBot(page); 
        // 抛出错误或等待一个外部信号
        throw new Error("需要人工干预来解决reCAPTCHA。");
      } else {
        logger.info("未检测到reCAPTCHA，继续执行。");
        // 不执行任何操作，直接返回
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("reCAPTCHA")) {
        throw error;
      }
      // 对于其他错误，记录下来但允许程序继续
      logger.error({ error }, "在handleAntiBot中发生未知错误");
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      // 设置页面头信息
      await this.setupPageHeaders(this.page);
      
      // 导航到搜索页面
      await this.navigateToSearchPage(this.page, query);
      
      // 处理反机器人检测
      await this.handleAntiBot(this.page);
      
      await this.saveHtml(this.page, query);
      
      // 解析搜索结果
      const results = await this.resultParser.parseResults(this.page, this.options.limit || 10);

      logger.info({
        query,
        resultsCount: results.length,
        engine: "Google",
      }, "Google搜索完成");

      return results;

    } catch (error) {
      logger.error({ error, query }, "Google搜索失败");
      throw error;
    }
  }


}
