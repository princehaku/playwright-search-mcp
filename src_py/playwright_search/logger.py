import sys
import os
import tempfile
from loguru import logger

# 移除默认的 handler
logger.remove()

# 日志目录
log_dir = os.path.join(tempfile.gettempdir(), "playwright-search-logs")
if not os.path.exists(log_dir):
    os.makedirs(log_dir)

# 日志文件路径
log_file_path = os.path.join(log_dir, "playwright-search.log")

# 控制台输出
logger.add(
    sys.stderr,
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>",
    colorize=True,
)

# 文件输出
logger.add(
    log_file_path,
    level="TRACE",
    rotation="10 MB",  # 文件大小达到 10MB 时轮换
    retention="7 days",  # 保留 7 天的日志
    encoding="utf-8",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
)

# 全局异常捕获
def handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    logger.critical("Uncaught exception", exc_info=(exc_type, exc_value, exc_traceback))

sys.excepthook = handle_exception
