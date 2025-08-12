import time
from typing import List

from playwright.async_api import Page, BrowserContext

from ..logger import logger
from ..types import SearchResponse, SearchResult, CommandOptions
from .base import BaseEngine, SearchEngineConfig


GOOGLE_CONFIG: SearchEngineConfig = {
    "name": "Google",
    "base_url": "https://www.google.com",
    "search_path": "/search?q=",
    "selectors": {
        "result_container": "div[data-sokoban-container]",
        "title": "h3",
        "link": "a",
        "snippet": "div[data-sncf='1']",
    },
    "headers": {
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    "anti_bot": True,
    "custom_delay": {"min": 1000, "max": 3000},
}


class GoogleEngine(BaseEngine):
    """Google 搜索引擎的实现"""

    def __init__(self, options: CommandOptions):
        super().__init__(GOOGLE_CONFIG, options)

    async def search(self, context: BrowserContext, query: str) -> SearchResponse:
        start_time = time.time()
        page = await context.new_page()
        
        try:
            await self._setup_page_headers(page)
            await self._navigate_to_search_page(page, query)
            await self._handle_anti_bot(page)
            
            results = await self._parse_results(page)

            end_time = time.time()
            duration = (end_time - start_time) * 1000  # 毫秒

            logger.info(f"Google 搜索完成: 查询='{query}', 结果数={len(results)}, 耗时={duration:.2f}ms")

            return SearchResponse(
                query=query,
                results=results,
                totalResults=len(results),
                searchTime=duration,
                engine=self.config["name"],
            )
        except Exception as e:
            logger.error(f"Google 搜索失败: {e}")
            await page.screenshot(path='google-error-screenshot.png', full_page=True)
            raise
        finally:
            await page.close()

    async def _handle_anti_bot(self, page: Page):
        """处理反机器人检测，特别是 reCAPTCHA"""
        try:
            recaptcha_frame = await page.wait_for_selector('iframe[src*="recaptcha"]', timeout=5000)
            if recaptcha_frame:
                logger.warning("检测到 Google reCAPTCHA，需要人工干预。")
                await page.screenshot(path='google-recaptcha.png', full_page=True)
                raise Exception("需要人工干预来解决 reCAPTCHA。")
        except Exception:
            logger.info("未检测到 reCAPTCHA，执行标准反机器人流程。")
            await super()._handle_anti_bot(page)

    async def _parse_results(self, page: Page) -> List[SearchResult]:
        """使用 page.evaluate 智能解析搜索结果"""
        logger.info("启动 Google 智能解析器...")
        await page.wait_for_load_state('domcontentloaded', timeout=15000)

        limit = self.options.limit or 10

        results_js = """
        (limit) => {
            const extractedResults = [];
            const links = Array.from(document.querySelectorAll('a'));

            for (const link of links) {
                if (extractedResults.length >= limit) break;

                const h3 = link.querySelector('h3');
                if (h3 && h3.textContent) {
                    const href = link.href;
                    const title = h3.textContent;
                    
                    let snippet = '';
                    let container = link.closest('div[data-sokoban-container], div.g, div.s, [role="main"] > div > div');
                    if (container) {
                        const snippetNode = container.querySelector('div[data-sncf="1"], .s, .VwiC3b');
                        if (snippetNode) {
                            snippet = snippetNode.innerText;
                        }
                    }

                    if (href && title && !href.startsWith('javascript:') && href.includes('http')) {
                        extractedResults.push({
                            title: title.trim(),
                            link: href,
                            snippet: snippet.trim(),
                        });
                    }
                }
            }
            return extractedResults;
        }
        """
        
        extracted_data = await page.evaluate(results_js, limit)
        
        logger.info(f"智能解析器提取到 {len(extracted_data)} 个结果。")
        if not extracted_data:
            logger.warning("解析器未提取到任何结果，将截图用于调试。")
            await page.screenshot(path='google-screenshot.png', full_page=True)

        return [self._create_search_result(**item) for item in extracted_data]
