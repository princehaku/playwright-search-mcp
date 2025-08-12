from typing import Dict, Type, List

from ..types import CommandOptions
from .base import BaseEngine
from .google import GoogleEngine
# from .baidu import BaiduEngine  # Placeholder
# from .zhihu import ZhihuEngine  # Placeholder
# from .xiaohongshu import XiaohongshuEngine  # Placeholder

# 支持的搜索引擎映射
# 将引擎名称映射到对应的引擎类
ENGINE_MAP: Dict[str, Type[BaseEngine]] = {
    "google": GoogleEngine,
    # "baidu": BaiduEngine,
    # "zhihu": ZhihuEngine,
    # "xhs": XiaohongshuEngine,
    # "xiaohongshu": XiaohongshuEngine,
}


def create_engine(engine_name: str, options: CommandOptions) -> BaseEngine:
    """
    根据引擎名称创建搜索引擎实例。

    :param engine_name: 搜索引擎的名称 (例如, 'google').
    :param options: 命令行选项.
    :return: BaseEngine 的一个实例.
    :raises ValueError: 如果引擎名称不受支持.
    """
    engine_class = ENGINE_MAP.get(engine_name.lower())
    if not engine_class:
        raise ValueError(f"不支持的搜索引擎: {engine_name}")
    return engine_class(options)


def get_supported_engines() -> List[str]:
    """
    返回所有支持的搜索引擎的名称列表。

    :return: 引擎名称的字符串列表.
    """
    return list(ENGINE_MAP.keys())
