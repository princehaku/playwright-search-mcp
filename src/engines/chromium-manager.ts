import { Browser, BrowserContext } from "playwright";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { BaseBrowserManager, FingerprintConfig } from "./browser-manager.js";
import { CommandOptions } from "../types.js";
import logger from "../logger.js";
import { devices } from "playwright";
import fs from "fs";
import { EngineState } from "../types.js";

export class ChromiumBrowserManager extends BaseBrowserManager {

  async createBrowser(
    engineState: EngineState,
    options: {
      headless?: boolean;
      proxy?: string;
    }
  ): Promise<BrowserContext> {
    let userDataDir = this.stateDir
    logger.info(`正在启动持久化上下文，用户数据目录: ${userDataDir}`);

    chromiumExtra.use(StealthPlugin());

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
      headless: options.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
      ],
    };
    
    if (fingerprint.proxy) {
      contextOptions.proxy = fingerprint.proxy;
    }

    if (options.proxy) {
      contextOptions.proxy = this.parseProxyConfig(options.proxy);
    }

    const context = await chromiumExtra.launchPersistentContext(
      userDataDir,
      contextOptions
    );

    // 导航到 about:blank 以防止stealth插件打开意外页面
    const page = await context.newPage();
    await page.goto("about:blank");

    logger.info("持久化上下文启动成功");
    return context;
  }
}
