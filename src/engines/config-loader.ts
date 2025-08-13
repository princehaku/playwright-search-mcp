import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SearchEngineConfig } from './base.js';
import logger from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 使用基类的SearchEngineConfig接口

/**
 * 扩展的引擎配置接口（包含额外属性）
 */
interface ExtendedEngineConfig extends SearchEngineConfig {
  fallbackSelector?: string;
  linkValidation?: string[];
}

/**
 * 通用配置结构
 */
interface CommonConfig {
  defaultFallbackSelector: string;
  defaultLinkValidation: string[];
  defaultAntiBot: {
    enabled: boolean;
    detectors: string[];
    errorMessage: string;
  };
  defaultHeaders: Record<string, string>;
  defaultDelay: {
    min: number;
    max: number;
  };
}

/**
 * 配置加载器类
 */
export class ConfigLoader {
  private static instance: ConfigLoader | null = null;
  private engines: Map<string, SearchEngineConfig> = new Map();
  private commonConfig: CommonConfig | null = null;

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
  private loadConfigs(): void {
    if (this.engines.size > 0 && this.commonConfig) {
      return;
    }

    try {
      // 使用更可靠的路径解析方法
      let configDir: string | undefined;
      
      // 尝试多个可能的路径
      const possiblePaths = [
        path.join(__dirname, 'engine-config'),                    // 开发模式
        path.join(__dirname, '../src/engine-config'),            // 生产模式
        path.join(__dirname, '../../src/engine-config'),         // 备用路径
        path.join(process.cwd(), 'src/engine-config'),           // 从项目根目录
        path.join(process.cwd(), 'dist/src/engine-config')       // 从项目根目录的dist
      ];
      
      for (const testPath of possiblePaths) {
        if (fs.existsSync(path.join(testPath, 'common.json'))) {
          configDir = testPath;
          break;
        }
      }
      
      if (!configDir) {
        throw new Error(`无法找到配置文件目录，尝试的路径: ${possiblePaths.join(', ')}`);
      }
      
      logger.info(`使用配置文件目录: ${configDir}`);
      
      // 加载通用配置
      const commonConfigPath = path.join(configDir, 'common.json');
      const commonConfigContent = fs.readFileSync(commonConfigPath, 'utf-8');
      this.commonConfig = JSON.parse(commonConfigContent);
      
      // 加载所有引擎配置
      const engineFiles = fs.readdirSync(configDir).filter(file => 
        file.endsWith('.json') && file !== 'common.json'
      );
      
      for (const file of engineFiles) {
        const enginePath = path.join(configDir, file);
        const engineContent = fs.readFileSync(enginePath, 'utf-8');
        const engineConfig: ExtendedEngineConfig = JSON.parse(engineContent);
        
        // 合并默认配置
        const mergedConfig = this.mergeWithDefaults(engineConfig);
        this.engines.set(engineConfig.id, mergedConfig);
      }
      
      logger.info(`搜索引擎配置加载成功，共加载 ${this.engines.size} 个引擎`);
    } catch (error) {
      logger.error({ error }, '加载搜索引擎配置失败');
      throw new Error('无法加载搜索引擎配置文件');
    }
  }

  /**
   * 合并默认配置
   */
  private mergeWithDefaults(engineConfig: ExtendedEngineConfig): SearchEngineConfig {
    if (!this.commonConfig) {
      throw new Error('通用配置未加载');
    }

    return {
      ...engineConfig,
      headers: {
        ...this.commonConfig.defaultHeaders,
        ...engineConfig.headers
      },
      antiBot: engineConfig.antiBot || this.commonConfig.defaultAntiBot,
      customDelay: engineConfig.customDelay || this.commonConfig.defaultDelay
    };
  }

  /**
   * 获取引擎配置
   */
  public getEngineConfig(engineId: string): SearchEngineConfig | null {
    this.loadConfigs();
    return this.engines.get(engineId) || null;
  }

  /**
   * 获取所有支持的引擎ID
   */
  public getSupportedEngineIds(): string[] {
    this.loadConfigs();
    return Array.from(this.engines.keys());
  }

  /**
   * 检查引擎是否被支持
   */
  public isEngineSupported(engineId: string): boolean {
    this.loadConfigs();
    return this.engines.has(engineId);
  }

  /**
   * 获取备用选择器
   */
  public getFallbackSelector(engineId: string): string {
    this.loadConfigs();
    
    // 先从引擎特定配置中获取
    const engineConfigFile = this.loadEngineConfigFile(engineId);
    if (engineConfigFile?.fallbackSelector) {
      return engineConfigFile.fallbackSelector;
    }
    
    // 如果没有，使用默认值
    return this.commonConfig?.defaultFallbackSelector || 'div:has(a[href*="http"])';
  }

  /**
   * 获取链接验证规则
   */
  public getLinkValidationRules(engineId: string): string[] {
    this.loadConfigs();
    
    // 先从引擎特定配置中获取
    const engineConfigFile = this.loadEngineConfigFile(engineId);
    if (engineConfigFile?.linkValidation) {
      return engineConfigFile.linkValidation;
    }
    
    // 如果没有，使用默认值
    return this.commonConfig?.defaultLinkValidation || ['http'];
  }

  /**
   * 加载引擎原始配置文件（包含扩展属性）
   */
  private loadEngineConfigFile(engineId: string): ExtendedEngineConfig | null {
    try {
      const isDev = __dirname.includes('src');
      const configDir = isDev 
        ? path.join(__dirname, 'engine-instances')
        : path.join(__dirname, '../../src/engines/engine-instances');
      
      const enginePath = path.join(configDir, `${engineId}.json`);
      if (!fs.existsSync(enginePath)) {
        return null;
      }
      
      const engineContent = fs.readFileSync(enginePath, 'utf-8');
      return JSON.parse(engineContent);
    } catch (error) {
      logger.warn({ error, engineId }, '加载引擎原始配置文件失败');
      return null;
    }
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
    this.engines.clear();
    this.commonConfig = null;
    this.loadConfigs();
    logger.info('搜索引擎配置已重新加载');
  }
}
