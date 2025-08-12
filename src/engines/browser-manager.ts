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

// 保存的状态文件接口
export interface SavedState {
  fingerprint?: FingerprintConfig;
  googleDomain?: string;
}

// 浏览器管理器抽象类
export abstract class BaseBrowserManager {
  protected options: CommandOptions;
  protected stateFile: string;
  protected fingerprintFile: string;

  constructor(options: CommandOptions = {}) {
    this.options = options;
    const defaultStateDir = path.join(os.homedir(), ".playwright-search");
    this.stateFile =
      options.stateFile || path.join(defaultStateDir, "browser-state.json");
    this.fingerprintFile = this.stateFile.replace(
      ".json",
      "-fingerprint.json"
    );
  }

  // 抽象方法：子类必须实现
  abstract createBrowser(): Promise<Browser>;
  abstract createContext(
    browser: Browser,
    fingerprint?: FingerprintConfig,
    proxy?: string
  ): Promise<BrowserContext>;

  // 通用方法：加载保存的状态
  protected loadSavedState(): { storageState?: string; savedState: SavedState } {
    let storageState: string | undefined = undefined;
    let savedState: SavedState = {};

    if (fs.existsSync(this.stateFile)) {
      logger.info(
        { stateFile: this.stateFile },
        "发现浏览器状态文件，将使用保存的浏览器状态以避免反机器人检测"
      );
      storageState = this.stateFile;

      // 尝试加载保存的指纹配置
      if (fs.existsSync(this.fingerprintFile)) {
        try {
          const fingerprintData = fs.readFileSync(this.fingerprintFile, "utf8");
          savedState = JSON.parse(fingerprintData);
          logger.info("已加载保存的浏览器指纹配置");
        } catch (e) {
          logger.warn({ error: e }, "无法加载指纹配置文件，将创建新的指纹");
        }
      }
    } else {
      logger.info(
        { stateFile: this.stateFile },
        "未找到浏览器状态文件，将创建新的浏览器会话和指纹"
      );
    }

    return { storageState, savedState };
  }

  // 通用方法：保存状态和指纹
  public async saveStateAndFingerprint(
    context: BrowserContext,
    fingerprint: FingerprintConfig,
    noSaveState: boolean = false
  ): Promise<void> {
    if (noSaveState) return;

    try {
      const stateDir = path.dirname(this.stateFile);
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      // 保存浏览器状态
      await context.storageState({ path: this.stateFile });

      // 保存指纹配置
      const savedState: SavedState = { fingerprint };
      fs.writeFileSync(this.fingerprintFile, JSON.stringify(savedState, null, 2), "utf8");

      logger.info("已保存浏览器状态和指纹配置");
    } catch (e) {
      logger.warn({ error: e }, "保存浏览器状态/指纹失败");
    }
  }

  // 通用方法：获取随机设备配置
  protected getRandomDeviceConfig(): [string, any] {
    const deviceList = [
      "Desktop Chrome",
      "Desktop Edge",
      "Desktop Firefox",
      "Desktop Safari",
    ];

    const randomDevice = deviceList[Math.floor(Math.random() * deviceList.length)];
    return [randomDevice, devices[randomDevice]];
  }

  // 通用方法：获取随机时区
  protected getRandomTimezone(): string {
    const timezoneList = [
      "America/New_York",
      "Europe/London",
      "Asia/Shanghai",
      "Europe/Berlin",
      "Asia/Tokyo",
    ];

    return timezoneList[Math.floor(Math.random() * timezoneList.length)];
  }

  // 通用方法：获取宿主机器的实际配置
  public getHostMachineConfig(userLocale?: string): FingerprintConfig {
    const systemLocale = userLocale || process.env.LANG || "zh-CN";
    const timezoneId = this.getRandomTimezone();
    const hour = new Date().getHours();
    const colorScheme: "dark" | "light" = hour >= 18 || hour <= 6 ? "dark" : "light";

    return {
      deviceName: "Desktop Chrome",
      locale: systemLocale,
      timezoneId,
      colorScheme,
      reducedMotion: "no-preference",
      forcedColors: "none",
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
