#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { search } from "./search-refactored.js";
import logger from "./logger.js";

// 创建MCP服务器实例
const server = new McpServer({
  name: "playwright-search-server",
  version: "1.0.0",
});

// 注册搜索引擎工具
server.tool(
  "playwright-search",
  "使用搜索引擎查询实时网络信息，返回包含标题、链接和摘要的搜索结果。",
  {
    query: z.string().describe("搜索查询字符串。"),
    limit: z.number().optional().describe("返回的搜索结果数量 (默认: 10)"),
    timeout: z.number().optional().describe("搜索操作的超时时间(毫秒) (默认: 30000)"),
    engine: z.string().optional().describe("搜索引擎 (google|baidu|zhihu|xhs)，默认google"),
    proxy: z.string().optional().describe("代理服务器，例如 socks5://127.0.0.1:1080"),
  },
  async (params) => {
    try {
      const { query, ...options } = params;
      logger.info({ query, options }, "执行搜索");

      const results = await search(query, options);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error({ error }, "搜索工具执行错误");
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
);

// 启动服务器
async function startServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("搜索MCP服务器已启动，等待连接...");
  } catch (error) {
    logger.error({ error }, "服务器启动失败");
    process.exit(1);
  }
}

startServer();
