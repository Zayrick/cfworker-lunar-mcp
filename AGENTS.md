# Cloudflare Workers

停止。您对 Cloudflare Workers API 和限制的了解可能已过时。在进行任何 Workers、KV、R2、D1、Durable Objects、Queues、Vectorize、AI 或 Agents SDK 相关任务之前，请务必检索最新文档。

## 文档

- https://developers.cloudflare.com/workers/
- MCP：`https://docs.mcp.cloudflare.com/mcp`

有关所有限制和配额，请从产品的 `/platform/limits/` 页面检索，例如 `/workers/platform/limits`

## 命令

| 命令                      | 目的             |
|---------------------------|------------------|
| `npx wrangler dev`        | 本地开发         |
| `npx wrangler deploy`     | 部署到 Cloudflare |
| `npx wrangler types`      | 生成 TypeScript 类型 |

在更改 `wrangler.jsonc` 中的绑定后运行 `wrangler types`。

## Node.js 兼容性

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## 错误

- **错误 1102**（CPU/内存超限）：从 `/workers/platform/limits/` 检索限制
- **所有错误**：https://developers.cloudflare.com/workers/observability/errors/

## 产品文档

从以下路径检索 API 参考和限制：
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`