import { chromium, Browser, BrowserContext, devices } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CommandOptions } from "../types.js";
import logger from "../logger.js";
import { ChromiumBrowserManager } from "./chromium-manager.js";

// 指纹配置接口
export interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
  reducedMotion: "reduce" | "no-preference";
  forcedColors: "active" | "none";
  viewport?: { width: number; height: number };
  userAgent?: string;
}

// 新：每个引擎的独立状态
export interface EngineState {
  fingerprint?: FingerprintConfig;
  proxy?: string;
}

// 更新：保存的状态文件接口，现在是一个映射
export type SavedState = Record<string, EngineState>;

// 浏览器管理器抽象类
export abstract class BaseBrowserManager {
  protected options: CommandOptions;
  protected stateDir: string;
  protected fingerprintFile: string;

  constructor(options: CommandOptions = {}) {
    this.options = options;

    let stateDir: string;
    const localStateDir = path.resolve(".playwright-search");
    const homeStateDir = path.join(os.homedir(), ".playwright-search");

    if (fs.existsSync(localStateDir)) {
      stateDir = localStateDir;
    } else {
      stateDir = homeStateDir;
    }
    if (options.userDataDir) {
      stateDir = options.userDataDir
    }

    this.stateDir = stateDir;
    // Ensure the state directory exists
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }

    this.fingerprintFile = path.join(this.stateDir, "browser-state-fingerprint.json");

  }

  public getStateDir(): string {
    return this.stateDir;
  }

  public loadEngineState(engineId: string): EngineState {
    const state = this.loadFingerprintFromFile();
    return state[engineId] || {};
  }

  // 抽象方法：子类必须实现
  abstract createBrowser(
    engineState: EngineState,
    options: {
      headless?: boolean;
      proxy?: string;
    }): Promise<BrowserContext>;

  
  // 私有方法：从文件加载所有状态
  private loadFingerprintFromFile(): SavedState {
    let savedState: SavedState = {};

    if (fs.existsSync(this.fingerprintFile)) {
      try {
        const fingerprintData = fs.readFileSync(this.fingerprintFile, "utf8");
        savedState = JSON.parse(fingerprintData);
        logger.info("已加载所有引擎的浏览器指纹和代理配置");
      } catch (e) {
        logger.warn(
          { error: e },
          "无法加载指紋或代理配置文件，将创建新的"
        );
      }
    }
    return savedState;
  }

  // 更新：保存状态和指纹
  public async saveStateAndFingerprint(
    context: BrowserContext,
    engineId: string,
    engineState: EngineState,
    noSaveState: boolean = false
  ): Promise<void> {
    if (noSaveState) {
      return;
    }

    try {
      const stateDir = this.stateDir;

      const currentState = this.loadFingerprintFromFile();
      // 更新或添加当前引擎的状态
      currentState[engineId] = {
        ...currentState[engineId], // 保留该引擎可能存在的旧属性
        ...engineState,
      };

      // 将更新后的完整状态写回文件
      fs.writeFileSync(
        this.fingerprintFile,
        JSON.stringify(currentState, null, 2),
        "utf8"
      );

      logger.info(`已为引擎 '${engineId}' 保存指纹和代理配置`);
    } catch (e) {
      const err = e as Error;
      logger.error({
        err: {
          type: err.constructor.name,
          message: err.message,
          stack: err.stack,
        }
      }, `保存浏览器状态/指纹/代理失败 for engine '${engineId}'`);
    }
  }

  // 通用方法：获取随机设备配置
  protected getRandomDeviceConfig(): [string, any] {
    // 筛选出所有桌面设备
    const desktopDevices = Object.keys(devices).filter(
      (name) => !devices[name].isMobile
    ).filter(
      (name) => devices[name].userAgent.indexOf("Chrome") !== -1
    );

    // 从桌面设备中随机选择一个
    const randomDeviceName =
      desktopDevices[Math.floor(Math.random() * desktopDevices.length)];
    const device = devices[randomDeviceName];

    // 强制设置720p分辨率
    device.viewport = { width: 1200, height: 768 };

    return [randomDeviceName, device];
  }

  // 通用方法：获取随机时区
  protected getRandomTimezone(): string {
    const timezoneList = [
      "Asia/Shanghai"
    ];

    return timezoneList[Math.floor(Math.random() * timezoneList.length)];
  }

  // 通用方法：获取宿主机器的实际配置
  public getHostMachineConfig(userLocale?: string): FingerprintConfig {
    const systemLocale = userLocale || process.env.LANG || "zh-CN";
    const timezoneId = this.getRandomTimezone();
    const hour = new Date().getHours();
    const colorScheme: "dark" | "light" =
      hour >= 18 || hour <= 6 ? "dark" : "light";

    const [deviceName, device] = this.getRandomDeviceConfig();

    return {
      deviceName,
      locale: systemLocale,
      timezoneId,
      colorScheme,
      reducedMotion: "no-preference",
      forcedColors: "none",
      viewport: device.viewport,
      userAgent: device.userAgent
    };
  }

  // 通用方法：规范化 headless 配置
  protected coerceHeadless(value: unknown): boolean {
    if (value === false) return false;
    if (typeof value === "string") {
      const v = value.toLowerCase();
      if (v === "false" || v === "0" || v === "no") return false;
    }
    return true;
  }

  // 通用方法：获取随机延迟时间
  protected getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  // 通用方法：解析代理配置
  protected parseProxyConfig(proxyUrl: string): any {
    try {
      const u = new URL(proxyUrl);
      const server = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""
        }`;
      const cfg: { server: string; username?: string; password?: string } = {
        server,
      };
      if (u.username) cfg.username = decodeURIComponent(u.username);
      if (u.password) cfg.password = decodeURIComponent(u.password);
      return cfg;
    } catch (e) {
      logger.warn({ proxy: proxyUrl }, "代理URL解析失败");
      return { server: proxyUrl };
    }
  }
}
