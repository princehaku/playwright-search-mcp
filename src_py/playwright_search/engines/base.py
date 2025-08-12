from abc import ABC, abstractmethod
import asyncio
import random
from typing import Dict, Any, List, TypedDict, Optional
from urllib.parse import urljoin, urlparse

from playwright.async_api import Page, BrowserContext

from ..logger import logger
from ..types import CommandOptions, SearchResponse, SearchResult


class SearchEngineSelectors(TypedDict):
    """搜索引擎页面元素选择器"""
    result_container: str
    title: str
    link: str
    snippet: str


class CustomDelay(TypedDict):
    """自定义延迟配置"""
    min: int
    max: int


class SearchEngineConfig(TypedDict):
    """搜索引擎配置"""
    name: str
    base_url: str
    search_path: str
    selectors: SearchEngineSelectors
    headers: Optional[Dict[str, str]]
    user_agent: Optional[str]
    anti_bot: Optional[bool]
    custom_delay: Optional[CustomDelay]


class BaseEngine(ABC):
    """搜索引擎的抽象基类"""

    def __init__(self, config: SearchEngineConfig, options: CommandOptions):
        self.config = config
        self.options = options

    @abstractmethod
    async def search(self, context: BrowserContext, query: str) -> SearchResponse:
        """执行搜索并返回结果。子类必须实现此方法。"""
        raise NotImplementedError

    async def _navigate_to_search_page(self, page: Page, query: str):
        """导航到搜索页面"""
        search_url = self._build_search_url(query)
        logger.info(f"正在导航到 {self.config['name']} 搜索页面: {search_url}")
        
        await page.goto(search_url, wait_until="networkidle")

        if self.config.get("custom_delay"):
            delay = self._get_random_delay(
                self.config["custom_delay"]["min"], self.config["custom_delay"]["max"]
            )
            await page.wait_for_timeout(delay)

    def _build_search_url(self, query: str) -> str:
        """构建完整的搜索 URL"""
        encoded_query = query.replace(" ", "+")
        return f"{self.config['base_url']}{self.config['search_path']}{encoded_query}"

    async def _setup_page_headers(self, page: Page):
        """设置页面请求头"""
        if self.config.get("headers"):
            await page.set_extra_http_headers(self.config["headers"])

    async def _wait_for_page_load(self, page: Page):
        """等待搜索结果容器加载"""
        try:
            await page.wait_for_selector(
                self.config["selectors"]["result_container"], timeout=15000
            )
        except Exception:
            logger.warning("等待搜索结果超时，将继续处理。可能会导致无结果。")
            await page.screenshot(path="google-debug.png")


    def _get_random_delay(self, min_delay: int, max_delay: int) -> int:
        """获取随机延迟时间"""
        return random.randint(min_delay, max_delay)

    def _clean_text(self, text: Optional[str]) -> str:
        """清理文本中的不可见字符和多余空格"""
        if not text:
            return ""
        return " ".join(text.replace("\u200b", "").split()).strip()

    def _is_valid_link(self, href: Optional[str]) -> bool:
        """验证链接是否为有效的 HTTP/HTTPS 链接"""
        if not href:
            return False
        try:
            full_url = urljoin(self.config["base_url"], href)
            parsed_url = urlparse(full_url)
            return parsed_url.scheme in ["http", "https"]
        except Exception:
            return False

    def _create_search_result(self, title: str, link: str, snippet: str) -> SearchResult:
        """创建标准化的搜索结果对象"""
        return SearchResult(
            title=self._clean_text(title),
            link=self._clean_text(link),
            snippet=self._clean_text(snippet),
        )

    async def _handle_anti_bot(self, page: Page):
        """执行一些模拟人类行为的操作来绕过反机器人检测"""
        if not self.config.get("anti_bot"):
            return

        # 随机鼠标移动
        viewport_size = page.viewport_size
        if viewport_size:
            await page.mouse.move(
                random.uniform(0, viewport_size["width"]),
                random.uniform(0, viewport_size["height"]),
            )

        # 随机滚动
        await page.evaluate(f"window.scrollTo(0, {random.uniform(0, 100)})")

        # 等待随机时间
        await page.wait_for_timeout(self._get_random_delay(1000, 3000))
