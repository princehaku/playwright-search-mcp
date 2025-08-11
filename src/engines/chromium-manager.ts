import { chromium, Browser, BrowserContext } from "playwright";
import { BaseBrowserManager, FingerprintConfig } from "./browser-manager.js";
import { CommandOptions } from "../types.js";
import logger from "../logger.js";

// Chromium浏览器管理器
export class ChromiumBrowserManager extends BaseBrowserManager {
  async createBrowser(): Promise<Browser> {
    logger.info("正在启动Chromium浏览器...");
    
    const browser = await chromium.launch({
      headless: this.options.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    logger.info("Chromium浏览器启动成功");
    return browser;
  }

  async createContext(browser: Browser, fingerprint?: FingerprintConfig): Promise<BrowserContext> {
    const { storageState, savedState } = this.loadSavedState();
    
    // 使用保存的指纹配置或创建新的
    const hostConfig = fingerprint || savedState.fingerprint || this.getHostMachineConfig();
    
    const contextOptions: any = {
      locale: hostConfig.locale,
      timezoneId: hostConfig.timezoneId,
      colorScheme: hostConfig.colorScheme,
      reducedMotion: hostConfig.reducedMotion,
      forcedColors: hostConfig.forcedColors,
      userAgent: hostConfig.userAgent,
    };

    // 如果使用保存的设备配置
    if (hostConfig.deviceName) {
      const device = this.getRandomDeviceConfig();
      contextOptions.viewport = device[1].viewport;
      contextOptions.userAgent = device[1].userAgent;
    }

    // 设置代理
    if (this.options.proxy) {
      contextOptions.proxy = this.parseProxyConfig(this.options.proxy);
    }

    // 设置存储状态
    if (storageState) {
      contextOptions.storageState = storageState;
    }

    logger.info({ fingerprint: hostConfig }, "正在创建浏览器上下文...");
    const context = await browser.newContext(contextOptions);

    // 设置页面超时
    context.setDefaultTimeout(this.options.timeout || 60000);

    return context;
  }

  // 解析代理配置
  private parseProxyConfig(proxyUrl: string): any {
    try {
      const u = new URL(proxyUrl);
      const server = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`;
      const cfg: { server: string; username?: string; password?: string } = {
        server,
      };
      if (u.username) cfg.username = decodeURIComponent(u.username);
      if (u.password) cfg.password = decodeURIComponent(u.password);
      return cfg;
    } catch (e) {
      logger.warn({ proxy: proxyUrl }, "代理URL解析失败，按原样传递给 Playwright");
      return { server: proxyUrl };
    }
  }
}
