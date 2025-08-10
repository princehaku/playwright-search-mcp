import { pino } from "pino";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import pinoPretty from "pino-pretty";
import { execSync } from "child_process";

// 在 Windows 上强制控制台使用 UTF-8，避免中文乱码
if (process.platform === "win32") {
  try {
    execSync("chcp 65001", { stdio: "ignore" });
  } catch {}
  if ((process.stdout as any).setDefaultEncoding) {
    (process.stdout as any).setDefaultEncoding("utf8");
  }
  if ((process.stderr as any).setDefaultEncoding) {
    (process.stderr as any).setDefaultEncoding("utf8");
  }
}

// 使用系统临时目录，确保跨平台兼容性
  const logDir = path.join(os.tmpdir(), "playwright-search-logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 创建日志文件路径
  const logFilePath = path.join(logDir, "playwright-search.log");

// 主线程多路输出，避免 pretty 在 worker 内导致编码不一致
const prettyStream = pinoPretty({
  colorize: false,
  translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
  ignore: "pid,hostname",
  messageFormat: "{msg}",
});

// 文件输出（使用 sonic-boom，默认 UTF-8），确保目录已创建
const fileStream = pino.destination({ dest: logFilePath, mkdir: true, sync: false });

// 创建 pino 日志实例（控制台 + 文件）
const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
  },
  pino.multistream([
    { level: "info", stream: prettyStream },
    { level: "trace", stream: fileStream },
  ])
);

// 添加进程退出时的处理
process.on("exit", () => {
  logger.info("进程退出，日志关闭");
});

process.on("SIGINT", () => {
  logger.info("收到SIGINT信号，日志关闭");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("收到SIGTERM信号，日志关闭");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "未捕获的异常");
  process.exit(1);
});

export default logger;
