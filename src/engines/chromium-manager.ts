import { Browser, BrowserContext } from "playwright";
import { chromium as chromiumExtra} from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { BaseBrowserManager, FingerprintConfig } from "./browser-manager.js";
import { CommandOptions } from "../types.js";
import logger from "../logger.js";
import { devices } from "playwright";
import fs from "fs";
import { EngineState } from "../types.js";

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
        // "--no-zygote", // 在某些版本的Linux上可能需要，但通常可以移除
        // "--disable-gpu", // Stealth插件可能会处理GPU伪装
      ],
    });

    logger.info("集成了Stealth插件的Chromium浏览器启动成功");
    return browser;
  }

  // 更新：使用加载的引擎状态创建上下文
  async createContext(
    browser: Browser,
    engineState: EngineState,
    proxy?: string
  ): Promise<BrowserContext> {
    const storageStateFile = this.stateFile;
    const storageState = fs.existsSync(storageStateFile)
      ? storageStateFile
      : undefined;

    // 使用已保存的指纹，或创建新的
    if (!engineState.fingerprint) {
      engineState.fingerprint = this.getHostMachineConfig(this.options.locale);
    }
    const fingerprint = engineState.fingerprint;

    const contextOptions: any = {
      locale: fingerprint.locale,
      timezoneId: fingerprint.timezoneId,
      colorScheme: fingerprint.colorScheme,
      reducedMotion: fingerprint.reducedMotion,
      forcedColors: fingerprint.forcedColors,
      userAgent: fingerprint.userAgent,
      viewport: fingerprint.viewport,
    };

    // 设置代理
    if (proxy) {
      contextOptions.proxy = this.parseProxyConfig(proxy);
    }

    // 设置存储状态
    if (storageState) {
      contextOptions.storageState = storageState;
    }

    logger.info({ fingerprint }, "正在创建浏览器上下文...");
    const context = await browser.newContext(contextOptions);

    // 导航到 about:blank 以防止stealth插件打开意外页面
    const page = await context.newPage();
    await page.goto("about:blank");
    
    // 设置页面超时
    context.setDefaultTimeout(this.options.timeout || 60000);

    return context;
  }
}
