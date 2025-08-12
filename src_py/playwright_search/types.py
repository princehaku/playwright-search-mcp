from typing import List, Optional
from pydantic import BaseModel, Field


class SearchResult(BaseModel):
    """搜索结果模型"""
    title: str
    link: str
    snippet: str


class SearchResponse(BaseModel):
    """搜索响应模型"""
    query: str
    results: List[SearchResult]
    total_results: int = Field(alias='totalResults')
    search_time: float = Field(alias='searchTime')
    engine: str


class CommandOptions(BaseModel):
    """命令行选项模型"""
    limit: Optional[int] = None
    timeout: Optional[int] = None
    headless: Optional[bool] = None
    state_file: Optional[str] = Field(None, alias='stateFile')
    no_save_state: Optional[bool] = Field(None, alias='noSaveState')
    locale: Optional[str] = None  # 搜索结果语言
    proxy: Optional[str] = None  # 代理服务器
    engine: Optional[str] = None  # 搜索引擎


class HtmlResponse(BaseModel):
    """HTML响应模型 - 用于获取原始搜索页面HTML"""
    query: str
    html: str
    url: str
    saved_path: Optional[str] = Field(None, alias='savedPath')
    screenshot_path: Optional[str] = Field(None, alias='screenshotPath')
    original_html_length: Optional[int] = Field(None, alias='originalHtmlLength')
