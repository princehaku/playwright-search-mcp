import { Page } from "playwright";
import { CommandOptions } from "../types.js";
import { ConfigurableSearchEngine } from "./base.js";
import { BaseBrowserManager } from "./browser-manager.js";
import { ConfigLoader } from "./config-loader.js";

// 支持的搜索引擎类型
export type SearchEngineType = "google" | "baidu" | "zhihu" | "xhs" | "xiaohongshu";

// 定义传递给引擎构造函数的参数接口
export interface EngineConstructorParams {
  page: Page;
  options: CommandOptions;
  browserManager: BaseBrowserManager;
}

// 配置化的搜索引擎工厂类
export class SearchEngineFactory {
  private static configLoader = ConfigLoader.getInstance();

  /**
   * 创建搜索引擎实例
   * @param engineType 搜索引擎类型
   * @param params 构造参数
   * @returns 搜索引擎实例
   */
  public static createEngine(
    engineType: SearchEngineType,
    params: EngineConstructorParams
  ): ConfigurableSearchEngine {
    // 处理别名
    const normalizedType = engineType === "xiaohongshu" ? "xhs" : engineType;
    
    const config = this.configLoader.getEngineConfig(normalizedType);
    if (!config) {
      throw new Error(`不支持的搜索引擎: ${engineType}`);
    }

    // 加载引擎状态
    const engineState = params.browserManager.loadEngineState(config.id);

    return new ConfigurableSearchEngine(
      config,
      params.page,
      params.options,
      params.browserManager,
      engineState
    );
  }

  /**
   * 获取支持的搜索引擎列表
   * @returns 支持的搜索引擎类型数组
   */
  static getSupportedEngines(): SearchEngineType[] {
    const engines = this.configLoader.getSupportedEngineIds();
    // 添加xiaohongshu别名
    return [...engines, "xiaohongshu"] as SearchEngineType[];
  }

  /**
   * 检查搜索引擎是否被支持
   * @param engineType 搜索引擎类型
   * @returns 是否支持
   */
  public static isEngineSupported(engineType: string): engineType is SearchEngineType {
    const normalizedType = engineType === "xiaohongshu" ? "xhs" : engineType;
    return this.configLoader.isEngineSupported(normalizedType);
  }

  /**
   * 获取搜索引擎的显示名称
   * @param engineType 搜索引擎类型
   * @returns 显示名称
   */
  static getEngineDisplayName(engineType: SearchEngineType): string {
    const normalizedType = engineType === "xiaohongshu" ? "xhs" : engineType;
    const config = this.configLoader.getEngineConfig(normalizedType);
    return config?.name || engineType;
  }
}
