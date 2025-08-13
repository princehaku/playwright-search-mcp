import { Browser, BrowserContext, Page } from "playwright";
import { SearchResponse, CommandOptions } from "./types.js";
import { SearchEngineFactory, SearchEngineType } from "./engines/engine-factory.js";
import logger from "./logger.js";
import { ChromiumBrowserManager } from "./engines/chromium-manager.js";

const defaultOptions: CommandOptions = {
  limit: 10,
  timeout: 30000,
  headless: true,
  engine: "google",
  noSaveState: false,
};

/**
 * 重构后的搜索函数
 * 使用工厂模式创建对应的搜索引擎实例
 */
export async function search(
  query: string,
  options: CommandOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  const finalOptions = { ...defaultOptions, ...options };
  const browserManager = new ChromiumBrowserManager(finalOptions);

  let browser: Browser | undefined = existingBrowser;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let userDataDirPath: string | undefined;
  const startTime = Date.now();

  try {
    if (typeof finalOptions.userDataDir === 'string') {
      userDataDirPath = finalOptions.userDataDir;
    } else if (finalOptions.userDataDir === true) {
      userDataDirPath = browserManager.getStateDir();
    }

    // 常规模式
    const engineName = finalOptions.engine || 'google';
    const engineState = browserManager.loadEngineState(engineName);

    context = await browserManager.createBrowser(
      engineState,
      {
        headless: finalOptions.headless,
        proxy: finalOptions.proxy,
      });

    page = await context.newPage();
    await page.goto("about:blank");

    const searchEngine = SearchEngineFactory.createEngine(
      (finalOptions.engine || 'google') as SearchEngineType,
      {
        page,
        options: finalOptions,
        browserManager,
      }
    );

    const results = await searchEngine.search(query);
    const searchTime = (Date.now() - startTime) / 1000;

    // 在常规模式下，如果需要，保存状态
    if (!userDataDirPath && !finalOptions.noSaveState) {
      const engineState = await searchEngine.getEngineState();
      browserManager.saveEngineState(finalOptions.engine || 'google', engineState);
    }

    return {
      query: query,
      results: results,
      totalResults: results.length,
      searchTime: searchTime,
      engine: finalOptions.engine || 'google',
    };
  } finally {
    // 在持久化模式下，我们不关闭浏览器或上下文，以便复用
    if (!userDataDirPath) {
      if (page && !page.isClosed()) {
        await page.close();
      }
      if (context) {
        await context.close();
      }
      if (browser && !existingBrowser) {
        await browser.close();
      }
    }
  }
}

/**
 * 获取支持的搜索引擎列表
 */
export function getSupportedEngines(): SearchEngineType[] {
  return SearchEngineFactory.getSupportedEngines();
}

/**
 * 检查搜索引擎是否被支持
 */
export function isEngineSupported(engineType: string): boolean {
  return SearchEngineFactory.isEngineSupported(engineType);
}

/**
 * 获取搜索引擎的显示名称
 */
export function getEngineDisplayName(engineType: string): string {
  if (SearchEngineFactory.isEngineSupported(engineType)) {
    return SearchEngineFactory.getEngineDisplayName(engineType as SearchEngineType);
  }
  return engineType;
}

// 为了保持向后兼容，导出原有的函数名
export const googleSearch = (query: string, options: CommandOptions = {}, existingBrowser?: Browser) =>
  search(query, { ...options, engine: "google" }, existingBrowser);

export const baiduSearch = (query: string, options: CommandOptions = {}, existingBrowser?: Browser) =>
  search(query, { ...options, engine: "baidu" }, existingBrowser);

export const zhihuSearch = (query: string, options: CommandOptions = {}, existingBrowser?: Browser) =>
  search(query, { ...options, engine: "zhihu" }, existingBrowser);

export const xiaohongshuSearch = (query: string, options: CommandOptions = {}, existingBrowser?: Browser) =>
  search(query, { ...options, engine: "xhs" }, existingBrowser);
