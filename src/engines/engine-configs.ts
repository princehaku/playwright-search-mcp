import { SearchEngineConfig } from "./base.js";

/**
 * 搜索引擎配置集合
 * 包含所有支持的搜索引擎的配置信息
 */
export const ENGINE_CONFIGS: Record<string, SearchEngineConfig> = {
  google: {
    id: "google",
    name: "Google",
    baseUrl: "https://www.google.com",
    searchPath: "/search?q=",
    selectors: {
      resultContainer: ".g, div[data-sokoban-container], .Gx5Zad, .tF2Cxc, .hlcw0c",
      title: "h3, .LC20lb, .DKV0Md",
      link: "a, .yuRUbf a",
      snippet: ".VwiC3b, div[data-sncf='1'], .s, .IsZvec",
    },
    headers: {
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    antiBot: true,
    customDelay: {
      min: 1000,
      max: 3000,
    },
  },

  baidu: {
    id: "baidu",
    name: "百度",
    baseUrl: "https://www.baidu.com",
    searchPath: "/s?wd=",
    selectors: {
      resultContainer: "div.result, .c-container",
      title: "h3.t a, h3 a",
      link: "h3.t a, h3 a",
      snippet: '[data-module="abstract"], [data-module="sc_p"], .c-abstract',
    },
    headers: {
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
    antiBot: true,
    customDelay: {
      min: 1500,
      max: 4000,
    },
  },

  zhihu: {
    id: "zhihu",
    name: "知乎",
    baseUrl: "https://www.zhihu.com",
    searchPath: "/search?type=content&q=",
    selectors: {
      resultContainer: "div[data-za-detail-view-element_name], .List-item, .SearchResult-Card, div.Search-result",
      title: "h2 a, .ContentItem-title a, .SearchResult-title a",
      link: "h2 a, .ContentItem-title a, .SearchResult-title a",
      snippet: ".ContentItem-content, .SearchResult-excerpt, .RichText",
    },
    headers: {
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
    antiBot: true,
    customDelay: {
      min: 2000,
      max: 5000,
    },
  },

  xhs: {
    id: "xhs",
    name: "小红书",
    baseUrl: "https://www.xiaohongshu.com",
    searchPath: "/search_result?keyword=",
    selectors: {
      resultContainer: "section.note-item, .feeds-container .note-item",
      title: "a.title, .note-title",
      link: 'a[href^="/explore/"], .note-link',
      snippet: "img", // 小红书使用图片作为snippet
    },
    headers: {
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
    antiBot: true,
    customDelay: {
      min: 2500,
      max: 6000,
    },
  },
};

/**
 * 特殊的反爬虫处理器配置
 */
export const ANTI_BOT_HANDLERS: Record<string, string[]> = {
  google: [
    'iframe[src*="recaptcha"]',
  ],
  zhihu: [
    '.SignFlow',
    '.Login-content', 
    '[placeholder="手机号"]',
    '[placeholder*="短信验证码"]',
    '[name="digits"]',
    '.SignFlow-smsInputContainer',
    '*:has-text("验证码登录")',
    '*:has-text("获取短信验证码")',
    '*:has-text("获取语音验证码")'
  ],
  xhs: [
    'text="登录后查看搜索结果"',
    'text-matches("可用\\\\s*小红书\\\\s*或\\\\s*微信\\\\s*扫码")',
  ],
  baidu: [],
};

/**
 * 获取引擎配置
 */
export function getEngineConfig(engineId: string): SearchEngineConfig | null {
  return ENGINE_CONFIGS[engineId] || null;
}

/**
 * 获取所有支持的引擎ID
 */
export function getSupportedEngineIds(): string[] {
  return Object.keys(ENGINE_CONFIGS);
}

/**
 * 检查引擎是否被支持
 */
export function isEngineSupported(engineId: string): boolean {
  return engineId in ENGINE_CONFIGS;
}
