import { chromium as playwrightChromium, Browser, BrowserContext } from "playwright";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "playwright-extra/dist/plugins/stealth/index.js";
import { BaseBrowserManager, FingerprintConfig } from "./browser-manager.js";
import { CommandOptions } from "../types.js";
import logger from "../logger.js";
import { devices } from "playwright";

export class ChromiumBrowserManager extends BaseBrowserManager {
  async createBrowser(): Promise<Browser> {
    logger.info("正在启动集成了Stealth插件的Chromium浏览器...");
    
    // 使用 playwright-extra 来添加 stealth 插件
    chromiumExtra.use(StealthPlugin());

    // 使用 playwright-extra 启动浏览器
    const browser = await chromiumExtra.launch({
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

    logger.info("集成了Stealth插件的Chromium浏览器启动成功");
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

  getRandomDeviceConfig(): [string, any] {
    const deviceNames = Object.keys(devices);
    const randomDeviceName =
      deviceNames[Math.floor(Math.random() * deviceNames.length)];
    return [randomDeviceName, devices[randomDeviceName]];
  }
}
