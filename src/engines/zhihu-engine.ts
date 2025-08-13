import { Page } from "playwright";
import { SearchResult, CommandOptions } from "../types.js";
import { BaseSearchEngine, SearchEngineConfig } from "./base.js";
import logger from "../logger.js";

// 知乎搜索引擎配置
const ZHIHU_CONFIG: SearchEngineConfig = {
  id: "zhihu",
  name: "知乎",
  baseUrl: "https://www.zhihu.com",
  searchPath: "/search?type=content&q=",
  selectors: {
    resultContainer: "div[data-za-detail-view-element_name], .List-item, .SearchResult-Card, div.Search-result",
    title: "h2 a, .ContentItem-title a, .SearchResult-title a",
    link: "h2 a, .ContentItem-title a, .SearchResult-title a",
    snippet: ".ContentItem-content, .SearchResult-excerpt, .RichText",
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
      logger.info("开始解析知乎搜索结果...");
      
      // 分别尝试不同的容器选择器
      const containerSelectors = ZHIHU_CONFIG.selectors.resultContainer.split(', ');
      let resultElements: any[] = [];
      
      for (const containerSelector of containerSelectors) {
        logger.debug(`尝试容器选择器: ${containerSelector}`);
        try {
          await page.waitForSelector(containerSelector.trim(), { timeout: 3000 });
          const elements = await page.$$(containerSelector.trim());
          if (elements.length > 0) {
            logger.info(`使用容器选择器 "${containerSelector}" 找到 ${elements.length} 个结果容器`);
            resultElements = elements;
            break;
          }
        } catch (e) {
          logger.debug(`容器选择器 "${containerSelector}" 未找到元素`);
          continue;
        }
      }

      if (resultElements.length === 0) {
        logger.warn("未找到任何搜索结果容器，尝试通用方法...");
        // 备用方案：查找包含链接的任何div
        resultElements = await page.$$('div:has(a[href*="/question/"], a[href*="/answer/"], a[href*="/zvideo/"])');
        logger.info(`通用方法找到 ${resultElements.length} 个可能的结果容器`);
      }
      
      for (let i = 0; i < Math.min(resultElements.length, limit); i++) {
        const element = resultElements[i];
        
        try {
          // 尝试多种标题选择器
          const titleSelectors = ZHIHU_CONFIG.selectors.title.split(', ');
          let titleElement = null;
          let title = "";
          let href = "";
          
          for (const titleSelector of titleSelectors) {
            titleElement = await element.$(titleSelector.trim());
            if (titleElement) {
              title = await titleElement.textContent() || "";
              href = await titleElement.getAttribute("href") || "";
              if (title && href) {
                logger.debug(`使用标题选择器 "${titleSelector}" 成功提取: ${title.substring(0, 50)}...`);
                break;
              }
            }
          }
          
          if (!title || !href) {
            logger.debug(`第${i+1}个元素：未找到有效的标题或链接`);
            continue;
          }
          
          // 验证和完善链接
          if (!this.isValidZhihuLink(href)) {
            logger.debug(`第${i+1}个元素：链接验证失败: ${href}`);
            continue;
          }
          
          const fullLink = href.startsWith('/') ? `${ZHIHU_CONFIG.baseUrl}${href}` : href;
          
          // 提取摘要
          const snippetSelectors = ZHIHU_CONFIG.selectors.snippet.split(', ');
          let snippet = "";
          
          for (const snippetSelector of snippetSelectors) {
            const snippetElement = await element.$(snippetSelector.trim());
            if (snippetElement) {
              snippet = await snippetElement.textContent() || "";
              if (snippet.trim()) {
                break;
              }
            }
          }
          
          results.push({
            title: this.cleanText(title),
            link: this.cleanText(fullLink),
            snippet: this.cleanText(snippet),
          });
          
          logger.debug(`成功解析第${i+1}个结果: ${title.substring(0, 30)}...`);
        } catch (e) {
          logger.warn({ error: e }, `解析第${i+1}个知乎搜索结果元素失败`);
        }
      }
    } catch (e) {
      logger.error({ error: e }, "知乎搜索结果解析整体失败");
    }
    
    logger.info(`知乎搜索结果解析完成，共提取 ${results.length} 个结果`);
    return results;
  }

  private isValidZhihuLink(href: string): boolean {
    // 知乎搜索结果链接类型
    return href.startsWith("/question/") || 
           href.startsWith("/answer/") || 
           href.startsWith("/zvideo/") ||
           href.startsWith("/p/") ||
           href.startsWith("/column/") ||
           href.includes("zhihu.com") ||
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
  private resultParser: ZhihuResultParser;

  constructor(
    page: Page,
    options: CommandOptions = {},
    browserManager: any
  ) {
    const engineState = browserManager.loadEngineState(ZHIHU_CONFIG.id);
    super(ZHIHU_CONFIG, page, options, browserManager, engineState);
    this.resultParser = new ZhihuResultParser();
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
        engine: "知乎",
      }, "知乎搜索完成");

      return results;

    } catch (error) {
      logger.error({ error, query }, "知乎搜索失败");
      throw error;
    }
  }

  protected async handleAntiBot(page: Page): Promise<void> {
    try {
      // 检测知乎验证码登录页面（简化选择器）
      const captchaSelectors = [
        // 最基本的检测
        '.SignFlow',
        '.Login-content', 
        '[placeholder="手机号"]',
        '[placeholder*="短信验证码"]',
        '[name="digits"]',
        '.SignFlow-smsInputContainer',
        // 文本检测
        '*:has-text("验证码登录")',
        '*:has-text("获取短信验证码")',
        '*:has-text("获取语音验证码")'
      ];

      let captchaDetected = false;
      logger.info("开始检测知乎验证码页面...");
      
      for (const selector of captchaSelectors) {
        try {
          const element = await page.locator(selector).first();
          const count = await page.locator(selector).count();
          logger.debug(`检测选择器 "${selector}": 找到 ${count} 个元素`);
          
          if (count > 0 && await element.isVisible({ timeout: 1000 })) {
            logger.debug(`验证码检测成功！匹配选择器: "${selector}"`);
            captchaDetected = true;
            break;
          }
        } catch (e) {
          logger.error(`选择器 "${selector}" 检测失败: ${e}`);
          continue;
        }
      }
      
      logger.info(`验证码检测结果: ${captchaDetected ? '检测到' : '未检测到'}`);
      
      // 额外检测：检查页面URL和标题
      const url = page.url();
      const title = await page.title();
      logger.info(`当前页面 - URL: ${url}, 标题: ${title}`);

      if (captchaDetected) {
        logger.warn("检测到知乎验证码登录页面，需要人工验证。");
        // 调用基类方法，包含更长的等待时间
        await super.handleAntiBot(page);
        throw new Error("知乎需要验证码登录，请手动完成验证后重试。");
      } else {
        logger.info("未检测到知乎验证码，继续执行。");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("验证码")) {
        throw error;
      }
      // 对于其他错误，记录下来但允许程序继续
      logger.error({ error }, "在知乎handleAntiBot中发生未知错误");
    }
  }

}
