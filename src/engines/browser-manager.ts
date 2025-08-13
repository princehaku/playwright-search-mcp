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
  googleDomain?: string; // 特定于Google的配置
}

// 更新：保存的状态文件接口，现在是一个映射
export type SavedState = Record<string, EngineState>;

// 浏览器管理器抽象类
export abstract class BaseBrowserManager {
  protected options: CommandOptions;
  protected stateFile: string;
  protected fingerprintFile: string;

  constructor(options: CommandOptions = {}) {
    this.options = options;

    if (options.stateFile) {
      this.stateFile = options.stateFile;
    } else {
      let stateDir: string;
      const localStateDir = path.resolve(".playwright-search");
      const homeStateDir = path.join(os.homedir(), ".playwright-search");

      if (fs.existsSync(localStateDir)) {
        stateDir = localStateDir;
      } else {
        stateDir = homeStateDir;
      }
      // Ensure the state directory exists
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }
      this.stateFile = path.join(stateDir, "browser-state.json");
    }

    this.fingerprintFile = this.stateFile.replace(
      ".json",
      "-fingerprint.json"
    );

    
    logger.info(`加载配置文件: ${this.fingerprintFile}`);
  }

  // 抽象方法：子类必须实现
  abstract createBrowser(): Promise<Browser>;
  abstract createContext(
    browser: Browser,
    engineState: EngineState,
    proxy?: string
  ): Promise<BrowserContext>;

  // 更新：加载特定引擎的状态
  public loadEngineState(engineId: string): EngineState {
    const allStates = this.loadSavedStatesFromFile();
    return allStates[engineId] || {};
  }

  // 私有方法：从文件加载所有状态
  private loadSavedStatesFromFile(): SavedState {
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
    if (noSaveState) return;

    try {
      const stateDir = path.dirname(this.stateFile);
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      // 保存浏览器上下文（cookies, local storage等）
      await context.storageState({ path: this.stateFile });

      // 加载当前所有引擎的状态，以避免覆盖
      const currentState = this.loadSavedStatesFromFile();
      
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

      logger.info(`已为引擎 '${engineId}' 保存浏览器状态、指纹和代理配置`);
    } catch (e) {
      logger.warn({ error: e }, "保存浏览器状态/指纹/代理失败");
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
      userAgent: device.userAgent,
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
      const server = `${u.protocol}//${u.hostname}${
        u.port ? ":" + u.port : ""
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
