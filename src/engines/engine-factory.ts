import { CommandOptions } from "../types.js";
import { BaseSearchEngine } from "./base.js";
import { GoogleSearchEngine } from "./google-engine.js";
import { BaiduSearchEngine } from "./baidu-engine.js";
import { ZhihuSearchEngine } from "./zhihu-engine.js";
import { XiaohongshuSearchEngine } from "./xiaohongshu-engine.js";

// 支持的搜索引擎类型
export type SearchEngineType = "google" | "baidu" | "zhihu" | "xhs" | "xiaohongshu";

// 搜索引擎工厂类
export class SearchEngineFactory {
  private static engineMap: Map<SearchEngineType, new (options: CommandOptions) => BaseSearchEngine> = new Map<SearchEngineType, new (options: CommandOptions) => BaseSearchEngine>([
    ["google", GoogleSearchEngine],
    ["baidu", BaiduSearchEngine],
    ["zhihu", ZhihuSearchEngine],
    ["xhs", XiaohongshuSearchEngine],
    ["xiaohongshu", XiaohongshuSearchEngine],
  ]);

  /**
   * 创建搜索引擎实例
   * @param engineType 搜索引擎类型
   * @param options 命令选项
   * @returns 搜索引擎实例
   */
  static createEngine(engineType: SearchEngineType, options: CommandOptions = {}): BaseSearchEngine {
    const EngineClass = this.engineMap.get(engineType);
    
    if (!EngineClass) {
      throw new Error(`不支持的搜索引擎类型: ${engineType}`);
    }

    return new EngineClass(options);
  }

  /**
   * 获取支持的搜索引擎列表
   * @returns 支持的搜索引擎类型数组
   */
  static getSupportedEngines(): SearchEngineType[] {
    return Array.from(this.engineMap.keys());
  }

  /**
   * 检查搜索引擎是否被支持
   * @param engineType 搜索引擎类型
   * @returns 是否支持
   */
  static isEngineSupported(engineType: string): engineType is SearchEngineType {
    return this.engineMap.has(engineType as SearchEngineType);
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
