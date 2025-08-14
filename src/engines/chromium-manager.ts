import { Browser, BrowserContext, chromium } from "playwright";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { BaseBrowserManager, FingerprintConfig, EngineState } from "./browser-manager.js";
import { CommandOptions } from "../types.js";
import logger from "../logger.js";
import { devices } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";

export class ChromiumBrowserManager extends BaseBrowserManager {

  async createBrowser(
    engineState: EngineState,
    options: {
      headless?: boolean;
      proxy?: string;
    }
  ): Promise<BrowserContext> {
    let userDataDir = this.stateDir;
    logger.info(`正在启动持久化上下文，用户数据目录: ${userDataDir}`);

    chromiumExtra.use(StealthPlugin());

    // 使用已保存的指纹，或创建新的
    if (!engineState.fingerprint) {
      engineState.fingerprint = this.getHostMachineConfig(this.options.locale);
    }
    const fingerprint = engineState.fingerprint;
    
    // Playwright优化的启动参数
    const contextOptions: any = {
      locale: fingerprint.locale,
      viewport: fingerprint.viewport,
      userAgent: fingerprint.userAgent,
      timezoneId: fingerprint.timezoneId,
      colorScheme: fingerprint.colorScheme as "dark" | "light",
      forcedColors: fingerprint.forcedColors as "active" | "none",
      reducedMotion: fingerprint.reducedMotion as "reduce" | "no-preference",
      headless: options.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection",
        "--disable-hang-monitor",
        "--disable-prompt-on-repost",
        "--disable-sync",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--disable-dev-shm-usage"
      ],
    };
    
    // 非无头模式下的额外参数
    if (!options.headless) {
      contextOptions.args.push(
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars"
      );
    }

    // 配置代理
    if (engineState.proxy) {
      contextOptions.proxy = this.parseProxyConfig(engineState.proxy);
    }

    if (options.proxy) {
      contextOptions.proxy = this.parseProxyConfig(options.proxy);
    }

    // 启动持久化浏览器上下文
    const context = await chromiumExtra.launchPersistentContext(
      userDataDir,
      contextOptions
    );

    logger.info({
      engineState,
      contextOptions,
    }, `持久化上下文启动成功`);
    return context;
  }
}
