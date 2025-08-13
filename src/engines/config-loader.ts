import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SearchEngineConfig } from './base.js';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 使用基类的SearchEngineConfig接口

/**
 * 配置文件结构
 */
interface ConfigFile {
  engines: Record<string, SearchEngineConfig>;
  fallbackSelectors: Record<string, string>;
  linkValidation: Record<string, string[]>;
}

/**
 * 配置加载器类
 */
export class ConfigLoader {
  private static instance: ConfigLoader | null = null;
  private config: ConfigFile | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  /**
   * 加载配置文件
   */
  private loadConfig(): ConfigFile {
    if (this.config) {
      return this.config;
    }

    try {
      // 在开发模式下使用源码目录，在生产模式下使用dist目录
      const isDev = __dirname.includes('src');
      const configPath = isDev 
        ? path.join(__dirname, 'configs.json')
        : path.join(__dirname, '../../src/engines/configs.json');
      
      const configContent = fs.readFileSync(configPath, 'utf-8');
      this.config = JSON.parse(configContent);
      logger.info('搜索引擎配置加载成功');
      return this.config!;
    } catch (error) {
      logger.error({ error }, '加载搜索引擎配置失败');
      throw new Error('无法加载搜索引擎配置文件');
    }
  }

  /**
   * 获取引擎配置
   */
  public getEngineConfig(engineId: string): SearchEngineConfig | null {
    const config = this.loadConfig();
    return config.engines[engineId] || null;
  }

  /**
   * 获取所有支持的引擎ID
   */
  public getSupportedEngineIds(): string[] {
    const config = this.loadConfig();
    return Object.keys(config.engines);
  }

  /**
   * 检查引擎是否被支持
   */
  public isEngineSupported(engineId: string): boolean {
    const config = this.loadConfig();
    return engineId in config.engines;
  }

  /**
   * 获取备用选择器
   */
  public getFallbackSelector(engineId: string): string {
    const config = this.loadConfig();
    return config.fallbackSelectors[engineId] || config.fallbackSelectors.default;
  }

  /**
   * 获取链接验证规则
   */
  public getLinkValidationRules(engineId: string): string[] {
    const config = this.loadConfig();
    return config.linkValidation[engineId] || config.linkValidation.default;
  }

  /**
   * 获取反爬虫检测器
   */
  public getAntiBotDetectors(engineId: string): string[] {
    const engineConfig = this.getEngineConfig(engineId);
    return engineConfig?.antiBot?.detectors || [];
  }

  /**
   * 获取反爬虫错误消息
   */
  public getAntiBotErrorMessage(engineId: string): string {
    const engineConfig = this.getEngineConfig(engineId);
    return engineConfig?.antiBot?.errorMessage || `${engineId}需要人工验证，请手动完成后重试。`;
  }

  /**
   * 是否启用反爬虫检测
   */
  public isAntiBotEnabled(engineId: string): boolean {
    const engineConfig = this.getEngineConfig(engineId);
    return engineConfig?.antiBot?.enabled || false;
  }

  /**
   * 重新加载配置（用于热更新）
   */
  public reloadConfig(): void {
    this.config = null;
    this.loadConfig();
    logger.info('搜索引擎配置已重新加载');
  }
}
