import asyncio
import json
import os
import random
from datetime import datetime
from typing import Optional, Tuple

from playwright.async_api import Browser, BrowserContext, async_playwright, Playwright, devices
from playwright_stealth import stealth_async

from .logger import logger
from .types import CommandOptions


class BrowserManager:
    """负责管理浏览器实例、上下文和反爬虫策略"""

    def __init__(self, options: CommandOptions):
        self.options = options
        self.state_file = options.state_file or "./browser-state.json"
        self.fingerprint_file = self.state_file.replace(".json", "-fingerprint.json")
        self.playwright: Optional[Playwright] = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None

    async def launch_browser(self) -> BrowserContext:
        """启动浏览器，应用反爬虫插件，并创建浏览器上下文"""
        logger.info("正在启动浏览器...")
        self.playwright = await async_playwright().start()

        browser_args = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
        ]
        
        # 启动 Chromium 浏览器
        self.browser = await self.playwright.chromium.launch(
            headless=self.options.headless if self.options.headless is not None else True,
            args=browser_args
        )

        logger.info("浏览器启动成功，正在创建浏览器上下文...")

        # 加载或创建指纹
        storage_state, saved_state = self._load_saved_state()
        fingerprint = saved_state.get("fingerprint") or self._get_host_machine_config()

        context_options = {
            "locale": fingerprint.get("locale"),
            "timezone_id": fingerprint.get("timezoneId"),
            "color_scheme": fingerprint.get("colorScheme"),
            "reduced_motion": fingerprint.get("reducedMotion"),
            "forced_colors": fingerprint.get("forcedColors"),
            "user_agent": fingerprint.get("userAgent"),
        }
        
        # 应用设备模拟
        if fingerprint.get("deviceName"):
            device_name = fingerprint["deviceName"]
            if device_name in devices:
                context_options.update(devices[device_name])

        if storage_state:
            context_options["storage_state"] = storage_state

        self.context = await self.browser.new_context(**context_options)
        
        # 应用 stealth 插件
        logger.info("正在应用 Stealth 插件以增强反爬虫能力...")
        await stealth_async(self.context)
        logger.info("Stealth 插件应用成功")

        # 设置默认超时
        self.context.set_default_timeout(self.options.timeout or 60000)

        logger.info({"fingerprint": fingerprint}, "浏览器上下文创建成功")
        return self.context

    def _load_saved_state(self) -> Tuple[Optional[str], dict]:
        """加载保存的浏览器状态和指纹"""
        storage_state = None
        saved_state = {}

        if os.path.exists(self.state_file):
            logger.info(f"发现浏览器状态文件: {self.state_file}, 将加载状态以避免反机器人检测。")
            storage_state = self.state_file
            if os.path.exists(self.fingerprint_file):
                try:
                    with open(self.fingerprint_file, "r", encoding="utf-8") as f:
                        saved_state = json.load(f)
                    logger.info("已加载保存的浏览器指纹。")
                except Exception as e:
                    logger.warning(f"无法加载指纹文件: {e}, 将创建新指纹。")
        else:
            logger.info("未找到浏览器状态文件，将创建新的会话和指纹。")
            
        return storage_state, saved_state

    def _get_host_machine_config(self) -> dict:
        """获取主机配置作为指纹"""
        system_locale = self.options.locale or os.getenv("LANG", "zh-CN")
        hour = datetime.now().hour
        color_scheme = "dark" if hour >= 18 or hour <= 6 else "light"

        device_list = [
            "Desktop Chrome",
            "Desktop Edge",
            "Desktop Firefox",
        ]
        
        device_name = random.choice(device_list)
        user_agent = devices[device_name]['user_agent']

        return {
            "deviceName": device_name,
            "locale": system_locale,
            "timezoneId": random.choice(["America/New_York", "Europe/London", "Asia/Shanghai"]),
            "colorScheme": color_scheme,
            "reducedMotion": "no-preference",
            "forcedColors": "none",
            "userAgent": user_agent,
        }

    async def close(self):
        """保存状态并关闭浏览器"""
        if self.context and not (self.options.no_save_state):
            logger.info("正在保存浏览器状态和指纹...")
            try:
                state_dir = os.path.dirname(self.state_file)
                if not os.path.exists(state_dir):
                    os.makedirs(state_dir)
                
                # 保存状态
                await self.context.storage_state(path=self.state_file)

                # 保存指纹
                fingerprint = self._get_host_machine_config() # 使用最新的配置
                with open(self.fingerprint_file, "w", encoding="utf-8") as f:
                    json.dump({"fingerprint": fingerprint}, f, indent=2)

                logger.info("浏览器状态和指纹保存成功。")
            except Exception as e:
                logger.warning(f"保存浏览器状态失败: {e}")

        if self.browser:
            await self.browser.close()
            logger.info("浏览器已关闭。")
        if self.playwright:
            await self.playwright.stop()
