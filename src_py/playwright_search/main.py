import asyncio
import json
import click
from . import __version__
from .logger import logger
from .types import CommandOptions
from .browser_manager import BrowserManager
from .engines import create_engine, get_supported_engines


@click.command()
@click.version_option(version=__version__)
@click.argument("query")
@click.option("-l", "--limit", type=int, default=10, help="结果数量限制")
@click.option("-t", "--timeout", type=int, default=60000, help="超时时间(毫秒)")
@click.option("--headless/--no-headless", default=True, help="是否以无头模式启动浏览器")
@click.option("--state-file", type=click.Path(), default="./browser-state.json", help="浏览器状态文件路径")
@click.option("--no-save-state", is_flag=True, help="不保存浏览器状态")
@click.option("--proxy", type=str, help="代理服务器(示例: socks5://127.0.0.1:1080)")
@click.option(
    "-e", "--engine",
    type=click.Choice(get_supported_engines(), case_sensitive=False),
    default="google",
    help="搜索引擎"
)
def cli(query: str, **kwargs):
    """基于 Playwright 的搜索引擎 MCP 工具"""
    
    async def main():
        # 将 click 的参数转换为 Pydantic 模型
        options = CommandOptions(**kwargs)
        browser_manager = None
        
        try:
            logger.info(f"使用引擎 '{options.engine}' 搜索: '{query}'")
            
            # 初始化浏览器管理器
            browser_manager = BrowserManager(options)
            
            # 启动浏览器并获取上下文
            context = await browser_manager.launch_browser()

            # 创建搜索引擎实例
            search_engine = create_engine(options.engine, options)

            # 执行搜索
            results = await search_engine.search(context, query)

            # 输出结果
            click.echo(results.model_dump_json(indent=2))

        except Exception as e:
            logger.error(f"发生错误: {e}")
            # click.echo(f"错误: {e}", err=True)
            # raise click.Abort() # 退出
        finally:
            if browser_manager:
                await browser_manager.close()

    asyncio.run(main())


if __name__ == "__main__":
    cli()
