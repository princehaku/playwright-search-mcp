import { Browser } from "playwright";
import { SearchResponse, CommandOptions } from "./types.js";
import { SearchEngineFactory, SearchEngineType } from "./engines/engine-factory.js";
import logger from "./logger.js";

/**
 * 重构后的搜索函数
 * 使用工厂模式创建对应的搜索引擎实例
 */
export async function search(
  query: string,
  options: CommandOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  const engineType = (options.engine || "google") as SearchEngineType;
  
  // 验证搜索引擎类型
  if (!SearchEngineFactory.isEngineSupported(engineType)) {
    throw new Error(`不支持的搜索引擎: ${engineType}`);
  }

  logger.info({ engine: engineType, query }, "开始搜索");

  try {
    // 创建搜索引擎实例
    const searchEngine = SearchEngineFactory.createEngine(engineType, options);
    
    // 执行搜索
    const response = await searchEngine.performSearch(
      query,
      options.headless !== false,
      existingBrowser
    );

    return response;
  } catch (error) {
    logger.error({ error, engine: engineType, query }, "搜索失败");
    throw error;
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
