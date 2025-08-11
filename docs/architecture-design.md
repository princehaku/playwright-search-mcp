# Playwright Search 架构设计文档

## 概述

本文档描述了 Playwright Search 工具重构后的架构设计。重构的目标是将原有的单体代码结构重构为模块化、可扩展的架构，提高代码的可维护性和可扩展性。

## 架构原则

### 1. 单一职责原则 (Single Responsibility Principle)
每个类只负责一个特定的功能领域：
- `BaseSearchEngine`: 负责搜索引擎的核心逻辑
- `BaseBrowserManager`: 负责浏览器生命周期管理
- `ResultParser`: 负责搜索结果解析
- `SearchEngineFactory`: 负责搜索引擎实例的创建

### 2. 开闭原则 (Open-Closed Principle)
系统对扩展开放，对修改封闭：
- 新增搜索引擎只需继承 `BaseSearchEngine` 并实现抽象方法
- 新增浏览器类型只需继承 `BaseBrowserManager`
- 无需修改现有代码即可支持新的搜索引擎

### 3. 依赖倒置原则 (Dependency Inversion Principle)
高层模块不依赖低层模块，都依赖抽象：
- 搜索函数依赖 `BaseSearchEngine` 抽象类
- 浏览器管理依赖 `BaseBrowserManager` 抽象类

### 4. 工厂模式 (Factory Pattern)
使用工厂模式创建搜索引擎实例，隐藏实例化细节：
- `SearchEngineFactory.createEngine()` 根据类型创建对应实例
- 统一的接口，便于管理和扩展

## 架构层次

```
┌─────────────────────────────────────────────────────────────┐
│                    CLI Layer (index.ts)                     │
├─────────────────────────────────────────────────────────────┤
│                Search Layer (search-refactored.ts)          │
├─────────────────────────────────────────────────────────────┤
│              Engine Factory (engine-factory.ts)             │
├─────────────────────────────────────────────────────────────┤
│              Engine Layer (各种搜索引擎实现)                 │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐  │
│  │   Google    │    Baidu    │    Zhihu    │Xiaohongshu │  │
│  │   Engine    │    Engine   │    Engine   │   Engine   │  │
│  └─────────────┴─────────────┴─────────────┴─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│              Base Layer (抽象基类)                          │
│  ┌─────────────────┬─────────────────────────────────────┐  │
│  │ BaseSearchEngine│        BaseBrowserManager           │  │
│  └─────────────────┴─────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│              Infrastructure Layer                          │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐  │
│  │  Playwright │   Logger    │   Types     │    Utils   │  │
│  └─────────────┴─────────────┴─────────────┴─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. BaseSearchEngine (基础搜索引擎抽象类)

**职责**: 定义搜索引擎的通用接口和共享功能

**核心方法**:
- `performSearch()`: 抽象方法，子类必须实现
- `createBrowserContext()`: 创建浏览器上下文
- `navigateToSearchPage()`: 导航到搜索页面
- `setupPageHeaders()`: 设置页面头信息
- `handleAntiBot()`: 处理反机器人检测

**设计特点**:
- 提供通用的浏览器操作和页面处理逻辑
- 子类只需实现特定的搜索逻辑
- 统一的错误处理和日志记录

### 2. BaseBrowserManager (基础浏览器管理器抽象类)

**职责**: 管理浏览器的生命周期、指纹配置和状态保存

**核心方法**:
- `createBrowser()`: 抽象方法，创建浏览器实例
- `createContext()`: 抽象方法，创建浏览器上下文
- `loadSavedState()`: 加载保存的状态和指纹
- `saveStateAndFingerprint()`: 保存状态和指纹配置

**设计特点**:
- 统一的指纹管理策略
- 共享的状态文件管理
- 可配置的浏览器启动参数

### 3. SearchEngineFactory (搜索引擎工厂)

**职责**: 根据引擎类型创建对应的搜索引擎实例

**核心方法**:
- `createEngine()`: 创建搜索引擎实例
- `getSupportedEngines()`: 获取支持的引擎列表
- `isEngineSupported()`: 检查引擎是否被支持

**设计特点**:
- 使用 Map 存储引擎类型和类的映射关系
- 支持引擎别名（如 `xhs` 和 `xiaohongshu`）
- 统一的错误处理

### 4. 具体搜索引擎实现

每个搜索引擎都继承自 `BaseSearchEngine`，实现特定的搜索逻辑：

#### GoogleSearchEngine
- 配置: Google 特定的选择器和头信息
- 解析器: 处理 Google 搜索结果页面结构
- 反机器人: 随机延迟和鼠标移动

#### BaiduSearchEngine
- 配置: 百度特定的选择器和头信息
- 解析器: 处理百度搜索结果页面结构
- 反机器人: 自定义延迟策略

#### ZhihuSearchEngine
- 配置: 知乎特定的选择器和头信息
- 解析器: 处理知乎搜索结果页面结构
- 反机器人: 增强的反检测策略

#### XiaohongshuSearchEngine
- 配置: 小红书特定的选择器和头信息
- 解析器: 处理小红书搜索结果页面结构
- 反机器人: 针对社交媒体的特殊处理

## 配置管理

### 搜索引擎配置

每个搜索引擎都有独立的配置对象，包含：

```typescript
interface SearchEngineConfig {
  name: string;                    // 搜索引擎名称
  baseUrl: string;                 // 基础URL
  searchPath: string;              // 搜索路径
  selectors: {                     // 页面元素选择器
    resultContainer: string;
    title: string;
    link: string;
    snippet: string;
  };
  headers?: Record<string, string>; // 自定义HTTP头
  userAgent?: string;              // 自定义User-Agent
  antiBot?: boolean;               // 是否启用反机器人检测
  customDelay?: {                  // 自定义延迟配置
    min: number;
    max: number;
  };
}
```

### 指纹配置

统一的指纹配置接口：

```typescript
interface FingerprintConfig {
  deviceName: string;              // 设备名称
  locale: string;                  // 区域设置
  timezoneId: string;              // 时区ID
  colorScheme: "dark" | "light";  // 颜色方案
  reducedMotion: "reduce" | "no-preference"; // 减少动画
  forcedColors: "active" | "none"; // 强制颜色
  viewport?: { width: number; height: number }; // 视口大小
  userAgent?: string;              // User-Agent
}
```

## 扩展指南

### 添加新的搜索引擎

1. 创建新的引擎配置文件：
```typescript
const NEW_ENGINE_CONFIG: SearchEngineConfig = {
  name: "新引擎",
  baseUrl: "https://example.com",
  searchPath: "/search?q=",
  selectors: {
    resultContainer: "div.result",
    title: "h3.title",
    link: "a.link",
    snippet: "div.snippet",
  },
  // ... 其他配置
};
```

2. 创建结果解析器：
```typescript
class NewEngineResultParser {
  async parseResults(page: Page, limit: number): Promise<SearchResult[]> {
    // 实现特定的解析逻辑
  }
}
```

3. 创建搜索引擎类：
```typescript
export class NewEngineSearchEngine extends BaseSearchEngine {
  constructor(options: CommandOptions = {}) {
    super(NEW_ENGINE_CONFIG, options);
    // 初始化解析器和浏览器管理器
  }

  async performSearch(query: string, headless: boolean, existingBrowser?: Browser): Promise<SearchResponse> {
    // 实现特定的搜索逻辑
  }
}
```

4. 在工厂中注册：
```typescript
private static engineMap = new Map([
  // ... 现有引擎
  ["newengine", NewEngineSearchEngine],
]);
```

### 添加新的浏览器类型

1. 继承 `BaseBrowserManager`：
```typescript
export class FirefoxBrowserManager extends BaseBrowserManager {
  async createBrowser(): Promise<Browser> {
    // 实现Firefox特定的启动逻辑
  }

  async createContext(browser: Browser, fingerprint?: FingerprintConfig): Promise<BrowserContext> {
    // 实现Firefox特定的上下文创建逻辑
  }
}
```

2. 在搜索引擎中使用新的浏览器管理器：
```typescript
export class CustomSearchEngine extends BaseSearchEngine {
  constructor(options: CommandOptions = {}) {
    super(CONFIG, options);
    this.browserManager = new FirefoxBrowserManager(options);
  }
}
```

## 性能优化

### 1. 浏览器实例复用
- 支持传入现有的浏览器实例
- 避免重复创建和销毁浏览器

### 2. 状态文件共享
- 所有搜索引擎共享相同的状态和指纹文件
- 减少文件I/O操作

### 3. 智能延迟策略
- 每个搜索引擎可配置不同的延迟策略
- 根据目标网站的反机器人策略调整

### 4. 错误处理和重试
- 统一的错误处理机制
- 支持配置重试策略

## 安全考虑

### 1. 指纹随机化
- 随机选择设备配置和时区
- 避免固定的浏览器指纹

### 2. 代理支持
- 支持HTTP、HTTPS、SOCKS代理
- 支持代理认证

### 3. 反机器人检测
- 模拟真实用户行为
- 随机鼠标移动和滚动
- 可配置的延迟策略

## 测试策略

### 1. 单元测试
- 测试每个组件的独立功能
- 使用Mock对象隔离依赖

### 2. 集成测试
- 测试搜索引擎的完整流程
- 验证不同搜索引擎的兼容性

### 3. 性能测试
- 测试搜索响应时间
- 测试内存和CPU使用情况

## 部署和维护

### 1. 依赖管理
- 使用TypeScript确保类型安全
- 明确的依赖版本管理

### 2. 日志和监控
- 结构化的日志记录
- 关键指标的监控

### 3. 配置管理
- 环境变量配置
- 配置文件热重载

## 总结

重构后的架构具有以下优势：

1. **可维护性**: 清晰的模块划分和职责分离
2. **可扩展性**: 易于添加新的搜索引擎和浏览器类型
3. **可测试性**: 组件间松耦合，便于单元测试
4. **可重用性**: 通用功能抽象到基类中
5. **类型安全**: 完整的TypeScript类型定义

这种架构设计为未来的功能扩展和维护提供了坚实的基础。
