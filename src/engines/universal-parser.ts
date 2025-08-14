import { Page } from "playwright";
import { SearchResult } from "../types.js";
import { SearchEngineConfig } from "./base.js";
import { ConfigLoader } from "./config-loader.js";
import logger from "../logger.js";

/**
 * 通用搜索结果解析器
 * 支持配置化的选择器和解析策略
 */
export class UniversalResultParser {
  private config: SearchEngineConfig;
  private configLoader: ConfigLoader;

  constructor(config: SearchEngineConfig) {
    this.config = config;
    this.configLoader = ConfigLoader.getInstance();
  }

  async parseResults(page: Page, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    try {
      logger.info(`开始解析${this.config.name}搜索结果...`);
      
      // 分别尝试不同的容器选择器
      const containerSelectors = this.config.selectors.resultContainer.split(', ');
      let resultElements: any[] = [];
      
      for (const containerSelector of containerSelectors) {
        logger.info(`尝试容器选择器: ${containerSelector}`);
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
        logger.warn(`未找到任何${this.config.name}搜索结果容器，尝试通用方法...`);
        // 备用方案：查找包含链接的任何div
        const fallbackSelector = this.getFallbackSelector();
        if (fallbackSelector) {
          resultElements = await page.$$(fallbackSelector);
          logger.info(`通用方法找到 ${resultElements.length} 个可能的结果容器`);
        }
      }
      
      for (let i = 0; i < Math.min(resultElements.length, limit); i++) {
        const element = resultElements[i];
        
        try {
          const result = await this.parseElement(element, i + 1);
          if (result) {
            results.push(result);
            logger.info(`成功解析第${i+1}个结果: ${result.title.substring(0, 30)}...`);
          }
        } catch (e) {
          logger.warn({ error: e }, `解析第${i+1}个${this.config.name}搜索结果元素失败`);
        }
      }
    } catch (e) {
      logger.error({ error: e }, `${this.config.name}搜索结果解析整体失败`);
    }
    
    logger.info(`${this.config.name}搜索结果解析完成，共提取 ${results.length} 个结果`);
    return results;
  }

  private async parseElement(element: any, index: number): Promise<SearchResult | null> {
    logger.info(`开始解析第${index}个元素...`);
    
    // 尝试多种标题选择器
    const titleSelectors = this.config.selectors.title.split(', ');
    let titleElement = null;
    let title = "";
    let href = "";
    
    logger.debug(`尝试标题选择器: ${titleSelectors.join(', ')}`);
    
    for (const titleSelector of titleSelectors) {
      titleElement = await element.$(titleSelector.trim());
      if (titleElement) {
        title = await titleElement.textContent() || "";
        href = await titleElement.getAttribute("href") || "";
        logger.debug(`选择器 "${titleSelector}": title="${title.substring(0, 30)}...", href="${href}"`);
        if (title && href) {
          logger.debug(`使用标题选择器 "${titleSelector}" 成功提取: ${title.substring(0, 50)}...`);
          break;
        }
      } else {
        logger.debug(`选择器 "${titleSelector}" 未找到元素`);
      }
    }
    
    // 如果标准方法失败，尝试更宽松的方法
    if (!title || !href) {
      logger.warn(`标准方法失败，尝试宽松解析...`);
      
      // 尝试找任何链接
      const anyLink = await element.$('a');
      if (anyLink) {
        title = title || await anyLink.textContent() || "";
        href = href || await anyLink.getAttribute("href") || "";
        logger.debug(`宽松方法: title="${title.substring(0, 30)}...", href="${href}"`);
      }
      
      // 如果还是没有title，尝试其他文本元素
      if (!title) {
        const textElements = await element.$$('span, div, p, h1, h2, h3, h4, h5, h6');
        for (const textEl of textElements) {
          const text = await textEl.textContent();
          if (text && text.trim().length > 5) {
            title = text.trim();
            logger.debug(`从文本元素提取标题: ${title.substring(0, 30)}...`);
            break;
          }
        }
      }
    }
    
    if (!title || !href) {
      logger.warn(`第${index}个元素：未找到有效的标题或链接 (title="${title}", href="${href}")`);
      return null;
    }
    
    // 验证和完善链接
    if (!this.isValidLink(href)) {
      logger.warn(`第${index}个元素：链接验证失败: ${href}`);
      return null;
    }
    
    const fullLink = this.normalizeLink(href);
    
    // 提取摘要
    const snippet = await this.extractSnippet(element);
    
    logger.debug(`第${index}个元素解析成功: ${title.substring(0, 30)}...`);
    
    return {
      title: this.cleanText(title),
      link: this.cleanText(fullLink),
      snippet: this.cleanText(snippet),
    };
  }

  private async extractSnippet(element: any): Promise<string> {
    const snippetSelectors = this.config.selectors.snippet.split(', ');
    
    for (const snippetSelector of snippetSelectors) {
      const snippetElement = await element.$(snippetSelector.trim());
      if (snippetElement) {
        // 特殊处理：如果是图片选择器，提取src属性
        if (snippetSelector.includes('img')) {
          const src = await snippetElement.getAttribute("src") || 
                      await snippetElement.getAttribute("data-src") || "";
          if (src) return src;
        } else {
          // 普通文本内容
          const snippet = await snippetElement.textContent() || "";
          if (snippet.trim()) {
            return snippet;
          }
        }
      }
    }
    
    return "";
  }

  private getFallbackSelector(): string {
    return this.configLoader.getFallbackSelector(this.config.id);
  }

  private isValidLink(href: string): boolean {
    const rules = this.configLoader.getLinkValidationRules(this.config.id);
    
    for (const rule of rules) {
      if (rule === "http" && href.startsWith("http")) {
        // Google特殊处理：排除搜索页面链接
        if (this.config.id === 'google' && href.includes("google.com/search")) {
          continue;
        }
        return true;
      }
      if (href.startsWith(rule) || href.includes(rule)) {
        return true;
      }
    }
    
    return false;
  }

  private normalizeLink(href: string): string {
    if (href.startsWith('/')) {
      return `${this.config.baseUrl}${href}`;
    }
    return href;
  }

  private cleanText(text?: string | null): string {
    return (text || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
