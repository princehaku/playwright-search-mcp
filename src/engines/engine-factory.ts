import { Page } from "playwright";
import { CommandOptions } from "../types.js";
import { BaseSearchEngine } from "./base.js";
import { GoogleSearchEngine } from "./google-engine.js";
import { BaiduSearchEngine } from "./baidu-engine.js";
import { ZhihuSearchEngine } from "./zhihu-engine.js";
import { XiaohongshuSearchEngine } from "./xiaohongshu-engine.js";
import { BaseBrowserManager } from "./browser-manager.js";

// 支持的搜索引擎类型
export type SearchEngineType = "google" | "baidu" | "zhihu" | "xhs" | "xiaohongshu";

// 定义传递给引擎构造函数的参数接口
export interface EngineConstructorParams {
  page: Page;
  options: CommandOptions;
  browserManager: BaseBrowserManager;
}

// 搜索引擎工厂类
export class SearchEngineFactory {

  /**
   * 创建搜索引擎实例
   * @param engineType 搜索引擎类型
   * @param options 命令选项
   * @returns 搜索引擎实例
   */
  public static createEngine(
    engineType: SearchEngineType,
    params: EngineConstructorParams
  ): BaseSearchEngine {
    switch (engineType) {
      case "google":
        return new GoogleSearchEngine(
          params.page,
          params.options,
          params.browserManager
        );
      case "baidu":
        return new BaiduSearchEngine(
          params.page,
          params.options,
          params.browserManager
        );
      case "zhihu":
        return new ZhihuSearchEngine(
          params.page,
          params.options,
          params.browserManager
        );
      case "xhs":
      case "xiaohongshu":
        return new XiaohongshuSearchEngine(
          params.page,
          params.options,
          params.browserManager
        );
      default:
        throw new Error(`不支持的搜索引擎: ${engineType}`);
    }
  }

  /**
   * 获取支持的搜索引擎列表
   * @returns 支持的搜索引擎类型数组
   */
  static getSupportedEngines(): SearchEngineType[] {
    return ["google", "baidu", "zhihu", "xhs", "xiaohongshu"];
  }

  /**
   * 检查搜索引擎是否被支持
   * @param engineType 搜索引擎类型
   * @returns 是否支持
   */
  public static isEngineSupported(engineType: string): engineType is SearchEngineType {
    const supportedEngines: SearchEngineType[] = ["google", "baidu", "zhihu", "xhs", "xiaohongshu"];
    return supportedEngines.includes(engineType as SearchEngineType);
  }

  /**
   * 获取搜索引擎的显示名称
   * @param engineType 搜索引擎类型
   * @returns 显示名称
   */
  static getEngineDisplayName(engineType: SearchEngineType): string {
    const displayNames: Record<SearchEngineType, string> = {
      google: "Google",
      baidu: "百度",
      zhihu: "知乎",
      xhs: "小红书",
      xiaohongshu: "小红书",
    };

    return displayNames[engineType] || engineType;
  }
}
