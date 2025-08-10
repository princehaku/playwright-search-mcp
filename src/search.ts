import { chromium, devices, BrowserContextOptions, Browser } from "playwright";
import { SearchResponse, SearchResult, CommandOptions, HtmlResponse } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "./logger.js";
import { url } from "inspector";

// 解析代理字符串为 Playwright 的 proxy 配置
function getPlaywrightProxyConfig(proxyUrl?: string):
  | {
      server: string;
      username?: string;
      password?: string;
      bypass?: string;
    }
  | undefined {
  if (!proxyUrl) return undefined;
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
    // 回退：无法解析时直接传入原字符串
    logger.warn({ proxy: proxyUrl }, "代理URL解析失败，按原样传递给 Playwright");
    return { server: proxyUrl } as any;
  }
}

// 规范化 headless 配置（兼容 boolean 与字符串）
function coerceHeadless(value: unknown): boolean {
  if (value === false) return false;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (v === "false" || v === "0" || v === "no") return false;
  }
  return true;
}

// 指纹配置接口
interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
  reducedMotion: "reduce" | "no-preference";
  forcedColors: "active" | "none";
}

// 保存的状态文件接口
interface SavedState {
  fingerprint?: FingerprintConfig;
  googleDomain?: string;
}

/**
 * 获取宿主机器的实际配置
 * @param userLocale 用户指定的区域设置（如果有）
 * @returns 基于宿主机器的指纹配置
 */
function getHostMachineConfig(userLocale?: string): FingerprintConfig {
  // 获取系统区域设置
  const systemLocale = userLocale || process.env.LANG || "zh-CN";

  // 获取系统时区
  // Node.js 不直接提供时区信息，但可以通过时区偏移量推断
  const timezoneOffset = new Date().getTimezoneOffset();
  let timezoneId = "Asia/Shanghai"; // 默认使用上海时区

  // 根据时区偏移量粗略推断时区
  // 时区偏移量是以分钟为单位，与UTC的差值，负值表示东区
  if (timezoneOffset <= -480 && timezoneOffset > -600) {
    // UTC+8 (中国、新加坡、香港等)
    timezoneId = "Asia/Shanghai";
  } else if (timezoneOffset <= -540) {
    // UTC+9 (日本、韩国等)
    timezoneId = "Asia/Tokyo";
  } else if (timezoneOffset <= -420 && timezoneOffset > -480) {
    // UTC+7 (泰国、越南等)
    timezoneId = "Asia/Bangkok";
  } else if (timezoneOffset <= 0 && timezoneOffset > -60) {
    // UTC+0 (英国等)
    timezoneId = "Europe/London";
  } else if (timezoneOffset <= 60 && timezoneOffset > 0) {
    // UTC-1 (欧洲部分地区)
    timezoneId = "Europe/Berlin";
  } else if (timezoneOffset <= 300 && timezoneOffset > 240) {
    // UTC-5 (美国东部)
    timezoneId = "America/New_York";
  }

  // 检测系统颜色方案
  // Node.js 无法直接获取系统颜色方案，使用合理的默认值
  // 可以根据时间推断：晚上使用深色模式，白天使用浅色模式
  const hour = new Date().getHours();
  const colorScheme =
    hour >= 19 || hour < 7 ? ("dark" as const) : ("light" as const);

  // 其他设置使用合理的默认值
  const reducedMotion = "no-preference" as const; // 大多数用户不会启用减少动画
  const forcedColors = "none" as const; // 大多数用户不会启用强制颜色

  // 选择一个合适的设备名称
  // 根据操作系统选择合适的浏览器
  const platform = os.platform();
  let deviceName = "Desktop Chrome"; // 默认使用Chrome

  if (platform === "darwin") {
    // macOS
    deviceName = "Desktop Safari";
  } else if (platform === "win32") {
    // Windows
    deviceName = "Desktop Edge";
  } else if (platform === "linux") {
    // Linux
    deviceName = "Desktop Firefox";
  }

  // 我们使用的Chrome
  deviceName = "Desktop Chrome";

  return {
    deviceName,
    locale: systemLocale,
    timezoneId,
    colorScheme,
    reducedMotion,
    forcedColors,
  };
}

/**
 * 执行Google搜索并返回结果
 * @param query 搜索关键词
 * @param options 搜索选项
 * @returns 搜索结果
 */
export async function googleSearch(
  query: string,
  options: CommandOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  // 设置默认选项
  const {
    limit = 10,
    timeout = 60000,
    stateFile = "./browser-state.json",
    noSaveState = false,
    locale = "zh-CN", // 默认使用中文
  } = options;

  // 根据传入参数决定是否无头
  let useHeadless = options.headless !== false;

  logger.info({ options }, "正在初始化浏览器...");

  // 检查是否存在状态文件
  let storageState: string | undefined = undefined;
  let savedState: SavedState = {};

  // 指纹配置文件路径
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");

  if (fs.existsSync(stateFile)) {
    logger.info(
      { stateFile },
      "发现浏览器状态文件，将使用保存的浏览器状态以避免反机器人检测"
    );
    storageState = stateFile;

    // 尝试加载保存的指纹配置
    if (fs.existsSync(fingerprintFile)) {
      try {
        const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
        savedState = JSON.parse(fingerprintData);
        logger.info("已加载保存的浏览器指纹配置");
      } catch (e) {
        logger.warn({ error: e }, "无法加载指纹配置文件，将创建新的指纹");
      }
    }
  } else {
    logger.info(
      { stateFile },
      "未找到浏览器状态文件，将创建新的浏览器会话和指纹"
    );
  }

  // 只使用桌面设备列表
  const deviceList = [
    "Desktop Chrome",
    "Desktop Edge",
    "Desktop Firefox",
    "Desktop Safari",
  ];

  // 时区列表
  const timezoneList = [
    "America/New_York",
    "Europe/London",
    "Asia/Shanghai",
    "Europe/Berlin",
    "Asia/Tokyo",
  ];

  // Google域名列表
  const googleDomains = [
    "https://www.google.com",
    "https://www.google.com.hk",
  ];

  // 获取随机设备配置或使用保存的配置
  const getDeviceConfig = (): [string, any] => {
    if (
      savedState.fingerprint?.deviceName &&
      devices[savedState.fingerprint.deviceName]
    ) {
      // 使用保存的设备配置
      return [
        savedState.fingerprint.deviceName,
        devices[savedState.fingerprint.deviceName],
      ];
    } else {
      // 随机选择一个设备
      const randomDevice =
        deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    }
  };

  // 获取随机延迟时间
  const getRandomDelay = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // 定义一个函数来执行搜索，可以重用于无头和有头模式
  async function performSearch(headless: boolean): Promise<SearchResponse> {
    let browser: Browser;
    let browserWasProvided = false;

    if (existingBrowser) {
      browser = existingBrowser;
      browserWasProvided = true;
      logger.info("使用已存在的浏览器实例");
    } else {
      logger.info(
        { headless },
        `准备以${headless ? "无头" : "有头"}模式启动浏览器...`
      );

      // 初始化浏览器，添加更多参数以避免检测
      browser = await chromium.launch({
        headless,
        timeout: timeout * 2, // 增加浏览器启动超时时间
        proxy: getPlaywrightProxyConfig(options.proxy),
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      });

      logger.info("浏览器已成功启动!");
    }

    // 获取设备配置 - 使用保存的或随机生成
    const [deviceName, deviceConfig] = getDeviceConfig();

    // 创建浏览器上下文选项
    let contextOptions: BrowserContextOptions = {
      ...deviceConfig,
    };

    // 如果有保存的指纹配置，使用它；否则使用宿主机器的实际设置
    if (savedState.fingerprint) {
      contextOptions = {
        ...contextOptions,
        locale: savedState.fingerprint.locale,
        timezoneId: savedState.fingerprint.timezoneId,
        colorScheme: savedState.fingerprint.colorScheme,
        reducedMotion: savedState.fingerprint.reducedMotion,
        forcedColors: savedState.fingerprint.forcedColors,
      };
      logger.info("使用保存的浏览器指纹配置");
    } else {
      // 获取宿主机器的实际设置
      const hostConfig = getHostMachineConfig(locale);

      // 如果需要使用不同的设备类型，重新获取设备配置
      if (hostConfig.deviceName !== deviceName) {
        logger.info(
          { deviceType: hostConfig.deviceName },
          "根据宿主机器设置使用设备类型"
        );
        // 使用新的设备配置
        contextOptions = { ...devices[hostConfig.deviceName] };
      }

      contextOptions = {
        ...contextOptions,
        locale: hostConfig.locale,
        timezoneId: hostConfig.timezoneId,
        colorScheme: hostConfig.colorScheme,
        reducedMotion: hostConfig.reducedMotion,
        forcedColors: hostConfig.forcedColors,
      };

      // 保存新生成的指纹配置
      savedState.fingerprint = hostConfig;
      logger.info(
        {
          locale: hostConfig.locale,
          timezone: hostConfig.timezoneId,
          colorScheme: hostConfig.colorScheme,
          deviceType: hostConfig.deviceName,
        },
        "已根据宿主机器生成新的浏览器指纹配置"
      );
    }

    // 添加通用选项 - 确保使用桌面配置
    contextOptions = {
      ...contextOptions,
      permissions: ["geolocation", "notifications"],
      acceptDownloads: true,
      isMobile: false, // 强制使用桌面模式
      hasTouch: false, // 禁用触摸功能
      javaScriptEnabled: true,
    };

    if (storageState) {
      logger.info("正在加载保存的浏览器状态...");
    }

    const context = await browser.newContext(
      storageState ? { ...contextOptions, storageState } : contextOptions
    );

    // 设置额外的浏览器属性以避免检测
    await context.addInitScript(() => {
      // 覆盖 navigator 属性
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en", "zh-CN"],
      });

      // 覆盖 window 属性
      // @ts-ignore - 忽略 chrome 属性不存在的错误
      window.chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };

      // 添加 WebGL 指纹随机化
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (
          parameter: number
        ) {
          // 随机化 UNMASKED_VENDOR_WEBGL 和 UNMASKED_RENDERER_WEBGL
          if (parameter === 37445) {
            return "Intel Inc.";
          }
          if (parameter === 37446) {
            return "Intel Iris OpenGL Engine";
          }
          return getParameter.call(this, parameter);
        };
      }
    });

    const page = await context.newPage();

    // 设置页面额外属性
    await page.addInitScript(() => {
      // 模拟真实的屏幕尺寸和颜色深度
      Object.defineProperty(window.screen, "width", { get: () => 1920 });
      Object.defineProperty(window.screen, "height", { get: () => 1080 });
      Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
    });

    try {
      // 使用保存的Google域名或随机选择一个
      let selectedDomain: string;
      if (savedState.googleDomain) {
        selectedDomain = savedState.googleDomain;
        logger.info({ domain: selectedDomain }, "使用保存的Google域名");
      } else {
        selectedDomain =
          googleDomains[Math.floor(Math.random() * googleDomains.length)];
        // 保存选择的域名
        savedState.googleDomain = selectedDomain;
        logger.info({ domain: selectedDomain }, "随机选择Google域名");
      }

      logger.info("正在访问Google搜索页面...");

      // 访问Google搜索页面
      const response = await page.goto(selectedDomain, {
        timeout,
        waitUntil: "networkidle",
      });

      // 检查是否被重定向到人机验证页面
      const currentUrl = page.url();
      const sorryPatterns = [
        "google.com/sorry/index",
        "google.com/sorry",
        "recaptcha",
        "captcha",
        "unusual traffic",
      ];

      const isBlockedPage = sorryPatterns.some(
        (pattern) =>
          currentUrl.includes(pattern) ||
          (response && response.url().toString().includes(pattern))
      );

      if (isBlockedPage) {
        if (headless) {
          logger.warn("检测到人机验证页面，将以有头模式重新启动浏览器...");

          // 关闭当前页面和上下文
          await page.close();
          await context.close();

          // 如果是外部提供的浏览器，不关闭它，而是创建一个新的浏览器实例
          if (browserWasProvided) {
            logger.info(
              "使用外部浏览器实例时遇到人机验证，创建新的浏览器实例..."
            );
            // 创建一个新的浏览器实例，不再使用外部提供的实例
            const newBrowser = await chromium.launch({
              headless: false, // 使用有头模式
              timeout: timeout * 2,
              proxy: getPlaywrightProxyConfig(options.proxy),
              args: [
                "--disable-blink-features=AutomationControlled",
                // 其他参数与原来相同
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-site-isolation-trials",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-renderer-backgrounding",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
              ],
              ignoreDefaultArgs: ["--enable-automation"],
            });

            // 使用新的浏览器实例执行搜索
            try {
              const tempContext = await newBrowser.newContext(contextOptions);
              const tempPage = await tempContext.newPage();

              // 这里可以添加处理人机验证的代码
              // ...

              // 完成后关闭临时浏览器
              await newBrowser.close();

              // 重新执行搜索
              return performSearch(false);
            } catch (error) {
              await newBrowser.close();
              throw error;
            }
          } else {
            // 如果不是外部提供的浏览器，直接关闭并重新执行搜索
            await browser.close();
            return performSearch(false); // 以有头模式重新执行搜索
          }
        } else {
          logger.warn("检测到人机验证页面，请在浏览器中完成验证...");
          // 等待用户完成验证并重定向回搜索页面
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("人机验证已完成，继续搜索...");
        }
      }

      logger.info({ query }, "正在输入搜索关键词");

      // 等待搜索框出现 - 尝试多个可能的选择器
      const searchInputSelectors = [
        "textarea[name='q']",
        "input[name='q']",
        "textarea[title='Search']",
        "input[title='Search']",
        "textarea[aria-label='Search']",
        "input[aria-label='Search']",
        "textarea",
      ];

      let searchInput = null;
      for (const selector of searchInputSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          logger.info({ selector }, "找到搜索框");
          break;
        }
      }

      if (!searchInput) {
        logger.error("无法找到搜索框");
        throw new Error("无法找到搜索框");
      }

      // 直接点击搜索框，减少延迟
      await searchInput.click();

      // 直接输入整个查询字符串，而不是逐个字符输入
      await page.keyboard.type(query, { delay: getRandomDelay(10, 30) });

      // 减少按回车前的延迟
      await page.waitForTimeout(getRandomDelay(100, 300));
      await page.keyboard.press("Enter");

      logger.info("正在等待页面加载完成...");

      // 等待页面加载完成
      await page.waitForLoadState("networkidle", { timeout });

      // 检查搜索后的URL是否被重定向到人机验证页面
      const searchUrl = page.url();
      const isBlockedAfterSearch = sorryPatterns.some((pattern) =>
        searchUrl.includes(pattern)
      );

      if (isBlockedAfterSearch) {
        if (headless) {
          logger.warn(
            "搜索后检测到人机验证页面，将以有头模式重新启动浏览器..."
          );

          // 关闭当前页面和上下文
          await page.close();
          await context.close();

          // 如果是外部提供的浏览器，不关闭它，而是创建一个新的浏览器实例
          if (browserWasProvided) {
            logger.info(
              "使用外部浏览器实例时搜索后遇到人机验证，创建新的浏览器实例..."
            );
            // 创建一个新的浏览器实例，不再使用外部提供的实例
            const newBrowser = await chromium.launch({
              headless: false, // 使用有头模式
              timeout: timeout * 2,
              proxy: getPlaywrightProxyConfig(options.proxy),
              args: [
                "--disable-blink-features=AutomationControlled",
                // 其他参数与原来相同
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-site-isolation-trials",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-renderer-backgrounding",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
              ],
              ignoreDefaultArgs: ["--enable-automation"],
            });

            // 使用新的浏览器实例执行搜索
            try {
              const tempContext = await newBrowser.newContext(contextOptions);
              const tempPage = await tempContext.newPage();

              // 这里可以添加处理人机验证的代码
              // ...

              // 完成后关闭临时浏览器
              await newBrowser.close();

              // 重新执行搜索
              return performSearch(false);
            } catch (error) {
              await newBrowser.close();
              throw error;
            }
          } else {
            // 如果不是外部提供的浏览器，直接关闭并重新执行搜索
            await browser.close();
            return performSearch(false); // 以有头模式重新执行搜索
          }
        } else {
          logger.warn("搜索后检测到人机验证页面，请在浏览器中完成验证...");
          // 等待用户完成验证并重定向回搜索页面
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("人机验证已完成，继续搜索...");

          // 等待页面重新加载
          await page.waitForLoadState("networkidle", { timeout });
        }
      }

      logger.info({ url: page.url() }, "正在等待搜索结果加载...");

      // 尝试多个可能的搜索结果选择器
      const searchResultSelectors = [
        "#search",
        "#rso",
        ".g",
        "[data-sokoban-container]",
        "div[role='main']",
      ];

      let resultsFound = false;
      for (const selector of searchResultSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: timeout / 2 });
          logger.info({ selector }, "找到搜索结果");
          resultsFound = true;
          break;
        } catch (e) {
          // 继续尝试下一个选择器
        }
      }

      if (!resultsFound) {
        // 如果找不到搜索结果，检查是否被重定向到人机验证页面
        const currentUrl = page.url();
        const isBlockedDuringResults = sorryPatterns.some((pattern) =>
          currentUrl.includes(pattern)
        );

        if (isBlockedDuringResults) {
          if (headless) {
            logger.warn(
              "等待搜索结果时检测到人机验证页面，将以有头模式重新启动浏览器..."
            );

            // 关闭当前页面和上下文
            await page.close();
            await context.close();

            // 如果是外部提供的浏览器，不关闭它，而是创建一个新的浏览器实例
            if (browserWasProvided) {
              logger.info(
                "使用外部浏览器实例时等待搜索结果遇到人机验证，创建新的浏览器实例..."
              );
              // 创建一个新的浏览器实例，不再使用外部提供的实例
              const newBrowser = await chromium.launch({
                headless: false, // 使用有头模式
                timeout: timeout * 2,
                args: [
                  "--disable-blink-features=AutomationControlled",
                  // 其他参数与原来相同
                  "--disable-features=IsolateOrigins,site-per-process",
                  "--disable-site-isolation-trials",
                  "--disable-web-security",
                  "--no-sandbox",
                  "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage",
                  "--disable-accelerated-2d-canvas",
                  "--no-first-run",
                  "--no-zygote",
                  "--disable-gpu",
                  "--hide-scrollbars",
                  "--mute-audio",
                  "--disable-background-networking",
                  "--disable-background-timer-throttling",
                  "--disable-backgrounding-occluded-windows",
                  "--disable-breakpad",
                  "--disable-component-extensions-with-background-pages",
                  "--disable-extensions",
                  "--disable-features=TranslateUI",
                  "--disable-ipc-flooding-protection",
                  "--disable-renderer-backgrounding",
                  "--enable-features=NetworkService,NetworkServiceInProcess",
                  "--force-color-profile=srgb",
                  "--metrics-recording-only",
                ],
                ignoreDefaultArgs: ["--enable-automation"],
              });

              // 使用新的浏览器实例执行搜索
              try {
                const tempContext = await newBrowser.newContext(contextOptions);
                const tempPage = await tempContext.newPage();

                // 这里可以添加处理人机验证的代码
                // ...

                // 完成后关闭临时浏览器
                await newBrowser.close();

                // 重新执行搜索
                return performSearch(false);
              } catch (error) {
                await newBrowser.close();
                throw error;
              }
            } else {
              // 如果不是外部提供的浏览器，直接关闭并重新执行搜索
              await browser.close();
              return performSearch(false); // 以有头模式重新执行搜索
            }
          } else {
            logger.warn(
              "等待搜索结果时检测到人机验证页面，请在浏览器中完成验证..."
            );
            // 等待用户完成验证并重定向回搜索页面
            await page.waitForNavigation({
              timeout: timeout * 2,
              url: (url) => {
                const urlStr = url.toString();
                return sorryPatterns.every(
                  (pattern) => !urlStr.includes(pattern)
                );
              },
            });
            logger.info("人机验证已完成，继续搜索...");

            // 再次尝试等待搜索结果
            for (const selector of searchResultSelectors) {
              try {
                await page.waitForSelector(selector, { timeout: timeout / 2 });
                logger.info({ selector }, "验证后找到搜索结果");
                resultsFound = true;
                break;
              } catch (e) {
                // 继续尝试下一个选择器
              }
            }

            if (!resultsFound) {
              logger.error("无法找到搜索结果元素");
              throw new Error("无法找到搜索结果元素");
            }
          }
        } else {
          // 如果不是人机验证问题，则抛出错误
          logger.error("无法找到搜索结果元素");
          throw new Error("无法找到搜索结果元素");
        }
      }

      // 减少等待时间
      await page.waitForTimeout(getRandomDelay(200, 500));

      logger.info("正在提取搜索结果...");

      let results: SearchResult[] = []; // 在 evaluate 调用之前声明 results

      // 提取搜索结果 - 使用移植自 playwright-search-extractor.cjs 的逻辑
      results = await page.evaluate((maxResults: number): SearchResult[] => { // 添加返回类型
        const results: { title: string; link: string; snippet: string }[] = [];
        const seenUrls = new Set<string>(); // 用于去重

        // 定义多组选择器，按优先级排序 (参考 playwright-search-extractor.cjs)
        const selectorSets = [
          { container: '#search div[data-hveid]', title: 'h3', snippet: '.VwiC3b' },
          { container: '#rso div[data-hveid]', title: 'h3', snippet: '[data-sncf="1"]' },
          { container: '.g', title: 'h3', snippet: 'div[style*="webkit-line-clamp"]' },
          { container: 'div[jscontroller][data-hveid]', title: 'h3', snippet: 'div[role="text"]' }
        ];

        // 备用摘要选择器
        const alternativeSnippetSelectors = [
          '.VwiC3b',
          '[data-sncf="1"]',
          'div[style*="webkit-line-clamp"]',
          'div[role="text"]'
        ];

        // 尝试每组选择器
        for (const selectors of selectorSets) {
          if (results.length >= maxResults) break; // 如果已达到数量限制，停止

          const containers = document.querySelectorAll(selectors.container);

          for (const container of containers) {
            if (results.length >= maxResults) break;

            const titleElement = container.querySelector(selectors.title);
            if (!titleElement) continue;

            const title = (titleElement.textContent || "").trim();

            // 查找链接
            let link = '';
            const linkInTitle = titleElement.querySelector('a');
            if (linkInTitle) {
              link = linkInTitle.href;
            } else {
              let current: Element | null = titleElement;
              while (current && current.tagName !== 'A') {
                current = current.parentElement;
              }
              if (current && current instanceof HTMLAnchorElement) {
                link = current.href;
              } else {
                const containerLink = container.querySelector('a');
                if (containerLink) {
                  link = containerLink.href;
                }
              }
            }

            // 过滤无效或重复链接
            if (!link || !link.startsWith('http') || seenUrls.has(link)) continue;

            // 查找摘要
            let snippet = '';
            const snippetElement = container.querySelector(selectors.snippet);
            if (snippetElement) {
              snippet = (snippetElement.textContent || "").trim();
            } else {
              // 尝试其他摘要选择器
              for (const altSelector of alternativeSnippetSelectors) {
                const element = container.querySelector(altSelector);
                if (element) {
                  snippet = (element.textContent || "").trim();
                  break;
                }
              }

              // 如果仍然没有找到摘要，尝试通用方法
              if (!snippet) {
                const textNodes = Array.from(container.querySelectorAll('div')).filter(el =>
                  !el.querySelector('h3') &&
                  (el.textContent || "").trim().length > 20
                );
                if (textNodes.length > 0) {
                  snippet = (textNodes[0].textContent || "").trim();
                }
              }
            }

            // 只添加有标题和链接的结果
            if (title && link) {
              results.push({ title, link, snippet });
              seenUrls.add(link); // 记录已处理的URL
            }
          }
        }
        
        // 如果主要选择器未找到足够结果，尝试更通用的方法 (作为补充)
        if (results.length < maxResults) {
            const anchorElements = Array.from(document.querySelectorAll("a[href^='http']"));
            for (const el of anchorElements) {
                if (results.length >= maxResults) break;

                // 检查 el 是否为 HTMLAnchorElement
                if (!(el instanceof HTMLAnchorElement)) {
                    continue;
                }
                const link = el.href;
                // 过滤掉导航链接、图片链接、已存在链接等
                if (!link || seenUrls.has(link) || link.includes("google.com/") || link.includes("accounts.google") || link.includes("support.google")) {
                    continue;
                }

                const title = (el.textContent || "").trim();
                if (!title) continue; // 跳过没有文本内容的链接

                // 尝试获取周围的文本作为摘要
                let snippet = "";
                let parent = el.parentElement;
                for (let i = 0; i < 3 && parent; i++) {
                  const text = (parent.textContent || "").trim();
                  // 确保摘要文本与标题不同且有一定长度
                  if (text.length > 20 && text !== title) {
                    snippet = text;
                    break; // 找到合适的摘要就停止向上查找
                  }
                  parent = parent.parentElement;
                }

                results.push({ title, link, snippet });
                seenUrls.add(link);
            }
        }

        return results.slice(0, maxResults); // 确保不超过限制
      }, limit); // 将 limit 传递给 evaluate 函数

      logger.info({ count: results.length }, "成功获取到搜索结果");

      try {
        // 保存浏览器状态（除非用户指定了不保存）
        if (!noSaveState) {
          logger.info({ stateFile }, "正在保存浏览器状态...");

          // 确保目录存在
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }

          // 保存状态
          await context.storageState({ path: stateFile });
          logger.info("浏览器状态保存成功!");

          // 保存指纹配置
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info({ fingerprintFile }, "指纹配置已保存");
          } catch (fingerprintError) {
            logger.error({ error: fingerprintError }, "保存指纹配置时发生错误");
          }
        } else {
          logger.info("根据用户设置，不保存浏览器状态");
        }
      } catch (error) {
        logger.error({ error }, "保存浏览器状态时发生错误");
      }

      // 只有在浏览器不是外部提供的情况下才关闭浏览器
      if (!browserWasProvided) {
        logger.info("正在关闭浏览器...");
        await browser.close();
      } else {
        logger.info("保持浏览器实例打开状态");
      }

      // 返回搜索结果
      return {
        query,
        results, // 现在 results 在这个作用域内是可访问的
      };
    } catch (error) {
      logger.error({ error }, "搜索过程中发生错误");

      try {
        // 尝试保存浏览器状态，即使发生错误
        if (!noSaveState) {
          logger.info({ stateFile }, "正在保存浏览器状态...");
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          await context.storageState({ path: stateFile });

          // 保存指纹配置
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info({ fingerprintFile }, "指纹配置已保存");
          } catch (fingerprintError) {
            logger.error({ error: fingerprintError }, "保存指纹配置时发生错误");
          }
        }
      } catch (stateError) {
        logger.error({ error: stateError }, "保存浏览器状态时发生错误");
      }

      // 只有在浏览器不是外部提供的情况下才关闭浏览器
      if (!browserWasProvided) {
        logger.info("正在关闭浏览器...");
        await browser.close();
      } else {
        logger.info("保持浏览器实例打开状态");
      }

      // 返回错误信息或空结果
      // logger.error 已经记录了错误，这里返回一个包含错误信息的模拟结果
       return {
         query,
         results: [
           {
             title: "搜索失败",
             link: "",
             snippet: `无法完成搜索，错误信息: ${
               error instanceof Error ? error.message : String(error)
             }`,
           },
         ],
       };
    }
    // 移除 finally 块，因为资源清理已经在 try 和 catch 块中处理
  }

  // 首先尝试以无头模式执行搜索
  logger.info({ requestedHeadless: options.headless, useHeadless }, "Google headless 参数");
  return performSearch(useHeadless);
}

/**
 * 执行百度搜索并返回结果
 */
export async function baiduSearch(
  query: string,
  options: CommandOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  const { limit = 10, timeout = 60000, stateFile = "./browser-state.json", noSaveState = false, locale = "zh-CN" } = options;
  let useHeadless = options.headless !== false;

  logger.info({ options }, "正在初始化浏览器用于百度搜索...");

  // 使用浏览器方式搜索
  let storageState: string | undefined = fs.existsSync(stateFile) ? stateFile : undefined;

  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");
  let savedState: SavedState = {};
  if (fs.existsSync(fingerprintFile)) {
    try {
      const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
      savedState = JSON.parse(fingerprintData);
    } catch {}
  }

  const [deviceName, deviceConfig] = (() => {
    if (savedState.fingerprint?.deviceName && devices[savedState.fingerprint.deviceName]) {
      return [savedState.fingerprint.deviceName, devices[savedState.fingerprint.deviceName]] as [string, any];
    }
    return ["Desktop Chrome", devices["Desktop Chrome"]] as [string, any];
  })();

  const hostConfig = savedState.fingerprint || getHostMachineConfig(locale);
  let contextOptions: BrowserContextOptions = {
    ...(hostConfig.deviceName !== deviceName ? devices[hostConfig.deviceName] : deviceConfig),
    locale: hostConfig.locale,
    timezoneId: hostConfig.timezoneId,
    colorScheme: hostConfig.colorScheme,
    reducedMotion: hostConfig.reducedMotion,
    forcedColors: hostConfig.forcedColors,
    permissions: ["geolocation", "notifications"],
    acceptDownloads: true,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
  };

  async function performSearch(headless: boolean): Promise<SearchResponse> {
    let browser: Browser;
    if (existingBrowser) {
      browser = existingBrowser;
    } else {
      browser = await chromium.launch({
        headless,
        timeout: timeout * 2,
        proxy: getPlaywrightProxyConfig(options.proxy),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--disable-web-security",
          "--disable-features=VizDisplayCompositor"
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      });
    }

    const context = await browser.newContext(storageState ? { ...contextOptions, storageState } : contextOptions);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"] });
      Object.defineProperty(window, "chrome", { get: () => ({ runtime: {} }) });
      
      // 移除webdriver属性
      delete (navigator as any).webdriver;
      
      // 添加Chrome对象
      (window as any).chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };
      
      // 修改navigator属性
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // 修改permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission } as any) :
          originalQuery(parameters)
      );
    });

    const page = await context.newPage();
    try {
            // 直接访问百度搜索结果页面
      const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${limit}`;
      logger.info("正在访问百度搜索结果页面:", searchUrl);
      await page.goto(searchUrl, { 
        timeout: 60000, 
        waitUntil: "networkidle" 
      });
      
      // 等待页面完全加载
      await page.waitForTimeout(3000);
      
      // 检查页面是否正常加载
      const pageContent = await page.content();
      const pageTitle = await page.title();
      logger.info("百度搜索结果页面内容长度:", pageContent.length);
      logger.info("百度搜索结果页面标题:", pageTitle);
      
      if (pageContent.length < 1000) {
        throw new Error("百度页面内容异常，可能被拦截");
      }
      
      // 调试：尝试截图
      try {
        await page.screenshot({ path: "baidu-debug.png" });
        logger.info("已保存百度页面截图到 baidu-debug.png");
      } catch (e) {
        logger.warn("截图失败:", e);
      }
      
      // 等待搜索结果出现
      logger.info("等待搜索结果出现...");
      try {
        await page.waitForSelector("div#content_left .result, div#content_left .c-container", { timeout: 15000 });
        logger.info("搜索结果已加载");
      } catch (e) {
        logger.warn("等待搜索结果超时，继续尝试解析...");
      }

      // 解析结果（更健壮的选择器）
      const results = await page.evaluate((maxResults: number) => {
        const list: { title: string; link: string; snippet: string }[] = [];
        
        const cleanText = (t?: string | null) => (t || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
        
        // 尝试多种结果容器选择器
        const selectors = [
          "div#content_left .result",
          "div#content_left .c-container", 
          "div#content_left .result-op",
          "div#content_left .c-row",
          "div#content_left [class*='result']"
        ];
        
        let items: NodeListOf<Element> | null = null;
        for (const selector of selectors) {
          items = document.querySelectorAll(selector);
          if (items.length > 0) break;
        }
        
        if (!items || items.length === 0) {
          // 兜底：查找所有可能的结果项
          items = document.querySelectorAll("div#content_left > div");
        }
        
        for (const el of Array.from(items)) {
          if (list.length >= maxResults) break;
          
          // 尝试多种标题选择器
          let title = "";
          let link = "";
          let snippet = "";
          
          // 标题和链接
          const titleSelectors = [
            "h3 a",
            "h3",
            "a[href]",
            ".t a",
            ".c-title a"
          ];
          
          for (const titleSelector of titleSelectors) {
            const titleEl = el.querySelector(titleSelector);
            if (titleEl) {
              if (titleEl instanceof HTMLAnchorElement) {
                title = cleanText(titleEl.textContent);
                link = titleEl.href;
                break;
                             } else if (titleEl.textContent) {
                 title = cleanText(titleEl.textContent);
                 // 尝试在标题元素附近找链接
                 const nearbyLink = titleEl.querySelector("a") || titleEl.parentElement?.querySelector("a");
                 if (nearbyLink instanceof HTMLAnchorElement) {
                   link = nearbyLink.href || "";
                 }
                 break;
               }
            }
          }
          
          // 摘要
          const snippetSelectors = [
            ".c-abstract",
            ".c-span-last", 
            ".c-color",
            ".c-row",
            ".c-abstract-text",
            "p"
          ];
          
          for (const snippetSelector of snippetSelectors) {
            const snippetEl = el.querySelector(snippetSelector);
            if (snippetEl && snippetEl.textContent) {
              snippet = cleanText(snippetEl.textContent);
              if (snippet.length > 10) break; // 确保有足够的内容
            }
          }
          
          // 过滤有效结果
          if (title && link && link.startsWith("http") && !link.includes("baidu.com/baidu")) {
            list.push({ title, link, snippet });
          }
        }
        
        return list;
      }, limit);

      if (!existingBrowser) await browser.close();
      return { query, results };
    } catch (e) {
      if (!existingBrowser) await browser.close();
      return { query, results: [{ title: "搜索失败", link: "", snippet: String(e) }] };
    }
  }

  logger.info({ requestedHeadless: options.headless, useHeadless }, "百度 headless 参数");
  return performSearch(useHeadless);
}



/**
 * 执行知乎站内搜索并返回结果（知识搜索）
 */
export async function zhihuSearch(
  query: string,
  options: CommandOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  const { limit = 10, timeout = 60000, stateFile = "./browser-state.json", locale = "zh-CN", noSaveState = false } = options;
  let useHeadless = options.headless !== false;

  // 为知乎使用独立的状态与指纹文件
  const zhihuStateFile = stateFile.endsWith('.json')
    ? stateFile.replace(/\.json$/i, "-zhihu.json")
    : stateFile + "-zhihu.json";
  const fingerprintFile = zhihuStateFile.replace(".json", "-fingerprint.json");

  let storageState: string | undefined = fs.existsSync(zhihuStateFile) ? zhihuStateFile : undefined;
  let savedState: SavedState = {};
  if (fs.existsSync(fingerprintFile)) {
    try {
      const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
      savedState = JSON.parse(fingerprintData);
      logger.info({ fingerprintFile }, "已加载知乎指纹配置");
    } catch (e) {
      logger.warn({ error: e }, "无法加载知乎指纹配置，将创建新的指纹");
    }
  }

  const hostConfig = savedState.fingerprint || getHostMachineConfig(locale);
  let contextOptions: BrowserContextOptions = {
    ...devices[hostConfig.deviceName],
    locale: hostConfig.locale,
    timezoneId: hostConfig.timezoneId,
    colorScheme: hostConfig.colorScheme,
    permissions: ["geolocation", "notifications"],
    acceptDownloads: true,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
  };

  async function performSearch(headless: boolean, antiBot: boolean = false): Promise<SearchResponse> {
    let browser: Browser;
    let browserWasProvided = false;
    if (existingBrowser && !options.proxy) {
      browser = existingBrowser;
      browserWasProvided = true;
    } else {
      logger.info({ headless, antiBot }, `准备以${headless ? "无头" : "有头"}模式启动浏览器用于知乎...${antiBot ? "(开启反机器人检测增强)" : ""}`);
      browser = await chromium.launch({
        headless,
        timeout: timeout * 2,
        proxy: getPlaywrightProxyConfig(options.proxy),
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      });
    }

    // 设置上下文
    const context = await browser.newContext(
      storageState ? { ...contextOptions, storageState } : contextOptions
    );
    // 基础伪装：始终注入
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en-US", "en"] });
      // @ts-ignore
      window.chrome = { runtime: {}, loadTimes: function () {}, csi: function () {}, app: {} };
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
          if (parameter === 37445) return "Intel Inc.";
          if (parameter === 37446) return "Intel Iris OpenGL Engine";
          return getParameter.call(this, parameter);
        };
      }
    });

    if (antiBot) {
      // 反爬增强：额外HTTP头与屏幕属性伪装
      await context.setExtraHTTPHeaders({
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
      });
    }

    const page = await context.newPage();

    try {
      // 访问知乎搜索页（内容搜索）
      const searchUrl = `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`;
      logger.info({ searchUrl }, "正在访问知乎搜索页面...");
      if (antiBot) {
        await page.addInitScript(() => {
          Object.defineProperty(window.screen, "width", { get: () => 1920 });
          Object.defineProperty(window.screen, "height", { get: () => 1080 });
          Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
          Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
        });
      }
      const response = await page.goto(searchUrl, { timeout, waitUntil: "domcontentloaded" });

      // 检测登录/验证码/风控页
      const sorryPatterns = ["/signin", "login", "captcha", "verify", "verification", "anti", "403"];
      const currentUrl = page.url();
      const isBlocked = sorryPatterns.some((p) => currentUrl.includes(p) || (response && response.url().toString().includes(p)));
      if (isBlocked && headless) {
        logger.warn("检测到知乎登录/验证码/风控页面，将以有头模式并开启反机器人检测增强重新启动，请完成验证或登录...");
        await page.close();
        await context.close();
        if (!browserWasProvided) await browser.close();
        return performSearch(false, true);
      }
      if (isBlocked) {
        logger.warn("请在打开的浏览器中完成知乎登录或验证码，完成后将继续提取结果...");
        await page.waitForNavigation({ timeout: timeout * 2, waitUntil: "networkidle" }).catch(() => {});
      }

      // 等待搜索结果卡片出现，并进行懒加载滚动（兼容多种结构）
      const cardsSelector = "div.SearchResult-Card, div.SearchResultItem, div.SearchResult, div.List-item";
      try { await page.waitForSelector(cardsSelector, { timeout: timeout / 2 }); } catch {}

      // 自动向下滚动加载更多内容，直到达到数量或达到滚动次数上限
      const target = Math.max(limit, 10);
      for (let i = 0; i < 20; i++) {
        const count = await page.locator(cardsSelector).count().catch(() => 0);
        if (count >= target) break;
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(500);
      }

      // 提取结果（更健壮的选择器与清洗逻辑）
      const results = await page.evaluate((maxResults: number) => {
        const list: { title: string; link: string; snippet: string }[] = [];

        const isValidLink = (href: string) => {
          if (!href) return false;
          if (!href.startsWith("http")) return false;
          // 允许知乎站内常见内容链接
          const allowPatterns = [/zhihu\.com\/question\//, /zhihu\.com\/answer\//, /zhuanlan\.zhihu\.com\/p\//, /zhihu\.com\/zvideo\//, /zhihu\.com\/article\//];
          if (allowPatterns.some((re) => re.test(href))) return true;
          // 其他域也允许，但过滤明显的导航/登录等
          const blockPatterns = [/\b(signin|login|verify|verification|captcha)\b/, /\bpeople\b/];
          if (blockPatterns.some((re) => re.test(href))) return false;
          return true;
        };

                const cleanText = (t?: string | null) => (t || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
        
        const tryGetTitleAndLink = (root: Element): { a?: HTMLAnchorElement; title: string; link: string } => {
          // 优先一：带埋点的Title
          let a = root.querySelector("a[data-za-detail-view-element_name='Title']") as HTMLAnchorElement | null;
          // 优先二：常见标题类名
          if (!a) a = root.querySelector("a.QuestionItem-title, a.ContentItem-title, a.ArticleItem-title, a.ZVideoItem-title") as HTMLAnchorElement | null;
          // 优先三：任意可用的站内链接
          if (!a) {
            const candidates = Array.from(root.querySelectorAll("a[href]")) as HTMLAnchorElement[];
            a = candidates.find((x) => isValidLink(x.href)) || null;
          }
          const link = a?.href || "";
          // 标题
          let title = cleanText(a?.textContent || "");
          if (!title) {
            const h = root.querySelector("h1,h2,h3");
            title = cleanText(h?.textContent || "");
          }
          return { a: a || undefined, title, link };
        };

        const tryGetSnippet = (root: Element): string => {
          const snippetEl = (root.querySelector(".RichContent-inner") as HTMLElement)
            || (root.querySelector(".ArticleItem-excerpt") as HTMLElement)
            || (root.querySelector(".RichText") as HTMLElement)
            || (root.querySelector(".ContentItem-meta, .KfeCollection-DetailAuthor") as HTMLElement)
            || null;
          let snippet = cleanText(snippetEl?.textContent || "");
          if (!snippet) {
            // 兜底：取容器中较长的一段文本
            const blocks = Array.from(root.querySelectorAll("p,div,span")) as HTMLElement[];
            for (const b of blocks) {
              const txt = cleanText(b.textContent || "");
              if (txt.length >= 30 && txt !== "登录加入知乎，与世界分享你的知识、经验和见解") {
                snippet = txt;
                break;
              }
            }
          }
          return snippet;
        };

        const cardNodes = document.querySelectorAll("div.SearchResult-Card, div.SearchResultItem, div.SearchResult, div.List-item");
        for (const el of Array.from(cardNodes)) {
          if (list.length >= maxResults) break;
          const { title, link } = tryGetTitleAndLink(el);
          if (!title || !link || !isValidLink(link)) continue;
          const snippet = tryGetSnippet(el);
          list.push({ title, link, snippet });
        }

        return list.slice(0, maxResults);
      }, limit);

      // 保存状态与指纹，便于下次免登录/降低风控
      try {
        if (!noSaveState) {
          const stateDir = path.dirname(zhihuStateFile);
          if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
          await context.storageState({ path: zhihuStateFile });
          // 保存指纹
          savedState.fingerprint = hostConfig;
          fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), "utf8");
        }
      } catch (e) {
        logger.warn({ error: e }, "保存知乎状态/指纹失败");
      }

      // 关闭或保留浏览器
      if (!browserWasProvided) {
        await browser.close();
      }

      return { query, results };
    } catch (e) {
      // 错误时也尝试保存状态
      try {
        if (!noSaveState) {
          await context.storageState({ path: zhihuStateFile });
          savedState.fingerprint = hostConfig;
          fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2), "utf8");
        }
      } catch {}

      if (!browserWasProvided) {
        await browser.close();
      }
      return { query, results: [{ title: "搜索失败", link: "", snippet: String(e) }] };
    }
  }

  logger.info({ requestedHeadless: options.headless, useHeadless }, "知乎 headless 参数");
  return performSearch(useHeadless);
}

/**
 * 执行小红书站内搜索并返回结果
 */
export async function xiaohongshuSearch(
  query: string,
  options: CommandOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  const { limit = 10, timeout = 60000, stateFile = "./browser-state.json", locale = "zh-CN" } = options;
  let useHeadless = options.headless !== false;

  let storageState: string | undefined = fs.existsSync(stateFile) ? stateFile : undefined;
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");
  let savedState: SavedState = {};
  if (fs.existsSync(fingerprintFile)) {
    try {
      const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
      savedState = JSON.parse(fingerprintData);
    } catch {}
  }

  const hostConfig = savedState.fingerprint || getHostMachineConfig(locale);
  let contextOptions: BrowserContextOptions = {
    ...devices[hostConfig.deviceName],
    locale: hostConfig.locale,
    timezoneId: hostConfig.timezoneId,
    colorScheme: hostConfig.colorScheme,
  };

  async function performSearch(headless: boolean): Promise<SearchResponse> {
    const browser = await chromium.launch({
      headless,
      timeout: timeout * 2,
      proxy: getPlaywrightProxyConfig(options.proxy),
      ignoreDefaultArgs: ["--enable-automation"],
    });
    const context = await browser.newContext(storageState ? { ...contextOptions, storageState } : contextOptions);
    const page = await context.newPage();
    try {
      // 小红书PC站搜索页（需注意可能强登录/风控）
      await page.goto(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`, { timeout, waitUntil: "domcontentloaded" });

      // 等待卡片加载
      try { await page.waitForSelector(".feeds-container, .note-item, .browse-mode", { timeout: timeout / 2 }); } catch {}

      const results = await page.evaluate((maxResults: number) => {
        const list: { title: string; link: string; snippet: string }[] = [];
        // 多种可能结构
        const cards = document.querySelectorAll("a[href*='/explore/'], a[href*='/discovery/item/']");
        for (const aEl of Array.from(cards)) {
          if (!(aEl instanceof HTMLAnchorElement)) continue;
          if (list.length >= maxResults) break;
          const title = (aEl.textContent || "").trim();
          const link = aEl.href;
          const snippet = title; // 站内摘要不稳定，先退化为标题
          if (title && link) list.push({ title, link, snippet });
        }
        return list;
      }, limit);

      await browser.close();
      return { query, results };
    } catch (e) {
      await browser.close();
      return { query, results: [{ title: "搜索失败", link: "", snippet: String(e) }] };
    }
  }

  logger.info({ requestedHeadless: options.headless, useHeadless }, "小红书 headless 参数");
  return performSearch(useHeadless);
}

/**
 * 获取Google搜索结果页面的原始HTML
 * @param query 搜索关键词
 * @param options 搜索选项
 * @param saveToFile 是否将HTML保存到文件（可选）
 * @param outputPath HTML输出文件路径（可选，默认为'./playwright-search-html/[query]-[timestamp].html'）
 * @returns 包含HTML内容的响应对象
 */
export async function getGoogleSearchPageHtml(
  query: string,
  options: CommandOptions = {},
  saveToFile: boolean = false,
  outputPath?: string
): Promise<HtmlResponse> {
  // 设置默认选项，与googleSearch保持一致
  const {
    timeout = 60000,
    stateFile = "./browser-state.json",
    noSaveState = false,
    locale = "zh-CN", // 默认使用中文
  } = options;

  // 根据传入参数决定是否无头
  let useHeadless = options.headless !== false;

  logger.info({ options }, "正在初始化浏览器以获取搜索页面HTML...");

  // 复用googleSearch中的浏览器初始化代码
  // 检查是否存在状态文件
  let storageState: string | undefined = undefined;
  let savedState: SavedState = {};

  // 指纹配置文件路径
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");

  if (fs.existsSync(stateFile)) {
    logger.info(
      { stateFile },
      "发现浏览器状态文件，将使用保存的浏览器状态以避免反机器人检测"
    );
    storageState = stateFile;

    // 尝试加载保存的指纹配置
    if (fs.existsSync(fingerprintFile)) {
      try {
        const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
        savedState = JSON.parse(fingerprintData);
        logger.info("已加载保存的浏览器指纹配置");
      } catch (e) {
        logger.warn({ error: e }, "无法加载指纹配置文件，将创建新的指纹");
      }
    }
  } else {
    logger.info(
      { stateFile },
      "未找到浏览器状态文件，将创建新的浏览器会话和指纹"
    );
  }

  // 只使用桌面设备列表
  const deviceList = [
    "Desktop Chrome",
    "Desktop Edge",
    "Desktop Firefox",
    "Desktop Safari",
  ];

  // Google域名列表
  const googleDomains = [
    "https://www.google.com",
    "https://www.google.com.hk",
    "https://www.google.co.uk",
    "https://www.google.ca",
  ];

  // 获取随机设备配置或使用保存的配置
  const getDeviceConfig = (): [string, any] => {
    if (
      savedState.fingerprint?.deviceName &&
      devices[savedState.fingerprint.deviceName]
    ) {
      // 使用保存的设备配置
      return [
        savedState.fingerprint.deviceName,
        devices[savedState.fingerprint.deviceName],
      ];
    } else {
      // 随机选择一个设备
      const randomDevice =
        deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    }
  };

  // 获取随机延迟时间
  const getRandomDelay = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // 定义一个专门的函数来获取HTML
  async function performSearchAndGetHtml(headless: boolean): Promise<HtmlResponse> {
    let browser: Browser;
    
    // 初始化浏览器，添加更多参数以避免检测
    browser = await chromium.launch({
      headless,
      timeout: timeout * 2, // 增加浏览器启动超时时间
      proxy: getPlaywrightProxyConfig(options.proxy),
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    logger.info("浏览器已成功启动!");

    // 获取设备配置 - 使用保存的或随机生成
    const [deviceName, deviceConfig] = getDeviceConfig();

    // 创建浏览器上下文选项
    let contextOptions: BrowserContextOptions = {
      ...deviceConfig,
    };

    // 如果有保存的指纹配置，使用它；否则使用宿主机器的实际设置
    if (savedState.fingerprint) {
      contextOptions = {
        ...contextOptions,
        locale: savedState.fingerprint.locale,
        timezoneId: savedState.fingerprint.timezoneId,
        colorScheme: savedState.fingerprint.colorScheme,
        reducedMotion: savedState.fingerprint.reducedMotion,
        forcedColors: savedState.fingerprint.forcedColors,
      };
      logger.info("使用保存的浏览器指纹配置");
    } else {
      // 获取宿主机器的实际设置
      const hostConfig = getHostMachineConfig(locale);

      // 如果需要使用不同的设备类型，重新获取设备配置
      if (hostConfig.deviceName !== deviceName) {
        logger.info(
          { deviceType: hostConfig.deviceName },
          "根据宿主机器设置使用设备类型"
        );
        // 使用新的设备配置
        contextOptions = { ...devices[hostConfig.deviceName] };
      }

      contextOptions = {
        ...contextOptions,
        locale: hostConfig.locale,
        timezoneId: hostConfig.timezoneId,
        colorScheme: hostConfig.colorScheme,
        reducedMotion: hostConfig.reducedMotion,
        forcedColors: hostConfig.forcedColors,
      };

      // 保存新生成的指纹配置
      savedState.fingerprint = hostConfig;
      logger.info(
        {
          locale: hostConfig.locale,
          timezone: hostConfig.timezoneId,
          colorScheme: hostConfig.colorScheme,
          deviceType: hostConfig.deviceName,
        },
        "已根据宿主机器生成新的浏览器指纹配置"
      );
    }

    // 添加通用选项 - 确保使用桌面配置
    contextOptions = {
      ...contextOptions,
      permissions: ["geolocation", "notifications"],
      acceptDownloads: true,
      isMobile: false, // 强制使用桌面模式
      hasTouch: false, // 禁用触摸功能
      javaScriptEnabled: true,
    };

    if (storageState) {
      logger.info("正在加载保存的浏览器状态...");
    }

    const context = await browser.newContext(
      storageState ? { ...contextOptions, storageState } : contextOptions
    );

    // 设置额外的浏览器属性以避免检测
    await context.addInitScript(() => {
      // 覆盖 navigator 属性
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en", "zh-CN"],
      });

      // 覆盖 window 属性
      // @ts-ignore - 忽略 chrome 属性不存在的错误
      window.chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };

      // 添加 WebGL 指纹随机化
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (
          parameter: number
        ) {
          // 随机化 UNMASKED_VENDOR_WEBGL 和 UNMASKED_RENDERER_WEBGL
          if (parameter === 37445) {
            return "Intel Inc.";
          }
          if (parameter === 37446) {
            return "Intel Iris OpenGL Engine";
          }
          return getParameter.call(this, parameter);
        };
      }
    });

    const page = await context.newPage();

    // 设置页面额外属性
    await page.addInitScript(() => {
      // 模拟真实的屏幕尺寸和颜色深度
      Object.defineProperty(window.screen, "width", { get: () => 1920 });
      Object.defineProperty(window.screen, "height", { get: () => 1080 });
      Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
    });

    try {
      // 使用保存的Google域名或随机选择一个
      let selectedDomain: string;
      if (savedState.googleDomain) {
        selectedDomain = savedState.googleDomain;
        logger.info({ domain: selectedDomain }, "使用保存的Google域名");
      } else {
        selectedDomain =
          googleDomains[Math.floor(Math.random() * googleDomains.length)];
        // 保存选择的域名
        savedState.googleDomain = selectedDomain;
        logger.info({ domain: selectedDomain }, "随机选择Google域名");
      }

      logger.info("正在访问Google搜索页面...");

      // 访问Google搜索页面
      const response = await page.goto(selectedDomain, {
        timeout,
        waitUntil: "networkidle",
      });

      // 检查是否被重定向到人机验证页面
      const currentUrl = page.url();
      const sorryPatterns = [
        "google.com/sorry/index",
        "google.com/sorry",
        "recaptcha",
        "captcha",
        "unusual traffic",
      ];

      const isBlockedPage = sorryPatterns.some(
        (pattern) =>
          currentUrl.includes(pattern) ||
          (response && response.url().toString().includes(pattern))
      );

      if (isBlockedPage) {
        if (headless) {
          logger.warn("检测到人机验证页面，将以有头模式重新启动浏览器...");

          // 关闭当前页面和上下文
          await page.close();
          await context.close();
          await browser.close();
          
          // 以有头模式重新执行
          return performSearchAndGetHtml(false);
        } else {
          logger.warn("检测到人机验证页面，请在浏览器中完成验证...");
          // 等待用户完成验证并重定向回搜索页面
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("人机验证已完成，继续搜索...");
        }
      }

      logger.info({ query }, "正在输入搜索关键词");

      // 等待搜索框出现 - 尝试多个可能的选择器
      const searchInputSelectors = [
        "textarea[name='q']",
        "input[name='q']",
        "textarea[title='Search']",
        "input[title='Search']",
        "textarea[aria-label='Search']",
        "input[aria-label='Search']",
        "textarea",
      ];

      let searchInput = null;
      for (const selector of searchInputSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          logger.info({ selector }, "找到搜索框");
          break;
        }
      }

      if (!searchInput) {
        logger.error("无法找到搜索框");
        throw new Error("无法找到搜索框");
      }

      // 直接点击搜索框，减少延迟
      await searchInput.click();

      // 直接输入整个查询字符串，而不是逐个字符输入
      await page.keyboard.type(query, { delay: getRandomDelay(10, 30) });

      // 减少按回车前的延迟
      await page.waitForTimeout(getRandomDelay(100, 300));
      await page.keyboard.press("Enter");

      logger.info("正在等待搜索结果页面加载完成...");

      // 等待页面加载完成
      await page.waitForLoadState("networkidle", { timeout });

      // 检查搜索后的URL是否被重定向到人机验证页面
      const searchUrl = page.url();
      const isBlockedAfterSearch = sorryPatterns.some((pattern) =>
        searchUrl.includes(pattern)
      );

      if (isBlockedAfterSearch) {
        if (headless) {
          logger.warn("搜索后检测到人机验证页面，将以有头模式重新启动浏览器...");

          // 关闭当前页面和上下文
          await page.close();
          await context.close();
          await browser.close();
          
          // 以有头模式重新执行
          return performSearchAndGetHtml(false);
        } else {
          logger.warn("搜索后检测到人机验证页面，请在浏览器中完成验证...");
          // 等待用户完成验证并重定向回搜索页面
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("人机验证已完成，继续搜索...");

          // 等待页面重新加载
          await page.waitForLoadState("networkidle", { timeout });
        }
      }

      // 获取当前页面URL
      const finalUrl = page.url();
      logger.info({ url: finalUrl }, "搜索结果页面已加载，准备提取HTML...");

      // 添加额外的等待时间，确保页面完全加载和稳定
      logger.info("等待页面稳定...");
      await page.waitForTimeout(1000); // 等待1秒，让页面完全稳定
      
      // 再次等待网络空闲，确保所有异步操作完成
      await page.waitForLoadState("networkidle", { timeout });
      
      // 获取页面HTML内容
      const fullHtml = await page.content();
      
      // 移除CSS和JavaScript内容，只保留纯HTML
      // 移除所有<style>标签及其内容
      let html = fullHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      // 移除所有<link rel="stylesheet">标签
      html = html.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
      // 移除所有<script>标签及其内容
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      
      logger.info({
        originalLength: fullHtml.length,
        cleanedLength: html.length
      }, "成功获取并清理页面HTML内容");

      // 如果需要，将HTML保存到文件并截图
      let savedFilePath: string | undefined = undefined;
      let screenshotPath: string | undefined = undefined;
      
      if (saveToFile) {
        // 生成默认文件名（如果未提供）
        if (!outputPath) {
          // 确保目录存在
          const outputDir = "./playwright-search-html";
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          // 生成文件名：查询词-时间戳.html
          const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
          const sanitizedQuery = query.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
          outputPath = `${outputDir}/${sanitizedQuery}-${timestamp}.html`;
        }

        // 确保文件目录存在
        const fileDir = path.dirname(outputPath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }

        // 写入HTML文件
        fs.writeFileSync(outputPath, html, "utf8");
        savedFilePath = outputPath;
        logger.info({ path: outputPath }, "清理后的HTML内容已保存到文件");
        
        // 保存网页截图
        // 生成截图文件名（基于HTML文件名，但扩展名为.png）
        const screenshotFilePath = outputPath.replace(/\.html$/, '.png');
        
        // 截取整个页面的截图
        logger.info("正在截取网页截图...");
        await page.screenshot({
          path: screenshotFilePath,
          fullPage: true
        });
        
        screenshotPath = screenshotFilePath;
        logger.info({ path: screenshotFilePath }, "网页截图已保存");
      }

      try {
        // 保存浏览器状态（除非用户指定了不保存）
        if (!noSaveState) {
          logger.info({ stateFile }, "正在保存浏览器状态...");

          // 确保目录存在
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }

          // 保存状态
          await context.storageState({ path: stateFile });
          logger.info("浏览器状态保存成功!");

          // 保存指纹配置
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info({ fingerprintFile }, "指纹配置已保存");
          } catch (fingerprintError) {
            logger.error({ error: fingerprintError }, "保存指纹配置时发生错误");
          }
        } else {
          logger.info("根据用户设置，不保存浏览器状态");
        }
      } catch (error) {
        logger.error({ error }, "保存浏览器状态时发生错误");
      }

      // 关闭浏览器
      logger.info("正在关闭浏览器...");
      await browser.close();

      // 返回HTML响应
      return {
        query,
        html,
        url: finalUrl,
        savedPath: savedFilePath,
        screenshotPath: screenshotPath,
        originalHtmlLength: fullHtml.length
      };
    } catch (error) {
      logger.error({ error }, "获取页面HTML过程中发生错误");

      try {
        // 尝试保存浏览器状态，即使发生错误
        if (!noSaveState) {
          logger.info({ stateFile }, "正在保存浏览器状态...");
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          await context.storageState({ path: stateFile });

          // 保存指纹配置
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info({ fingerprintFile }, "指纹配置已保存");
          } catch (fingerprintError) {
            logger.error({ error: fingerprintError }, "保存指纹配置时发生错误");
          }
        }
      } catch (stateError) {
        logger.error({ error: stateError }, "保存浏览器状态时发生错误");
      }

      // 关闭浏览器
      logger.info("正在关闭浏览器...");
      await browser.close();

      // 返回错误信息
      throw new Error(`获取Google搜索页面HTML失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 首先尝试以无头模式执行
  return performSearchAndGetHtml(useHeadless);
}
