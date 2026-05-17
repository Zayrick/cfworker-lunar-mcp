import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function readMcpSse(response: Response) {
	const text = await response.text();
	const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
	expect(dataLine).toBeDefined();
	return JSON.parse(dataLine?.slice('data: '.length) ?? '{}') as Record<string, unknown>;
}

describe('Lunar Calendar MCP Server', () => {
	it('returns server info on root path (unit style)', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.text();
		expect(response.headers.get('content-type')).toContain('text/plain');
		expect(body).toContain('Lunar Calendar MCP Server');
		expect(body).toContain('MCP endpoint: /lunar');
		expect(body).toContain('| convert_to_ganzhi | 公历转干支 |');
		expect(body).toContain('| get_current_ganzhi | 获取当前干支 |');
	});

	it('returns server info on root path (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/');
		const body = await response.text();
		expect(body).toContain('Lunar Calendar MCP Server');
	});

	it('routes MCP requests on /lunar only', async () => {
		const request = new IncomingRequest('http://example.com/lunar', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: {},
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
	});

	it('returns display titles in MCP tools/list', async () => {
		const request = new IncomingRequest('http://example.com/lunar', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/list',
				params: {},
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await readMcpSse(response) as {
			result?: { tools?: Array<{ name: string; title?: string }> };
		};
		const tools = new Map(body.result?.tools?.map((tool) => [tool.name, tool]));
		expect(tools.get('get_bazi_chart')?.title).toBe('八字排盘');
		expect(tools.get('get_bazi_fortune')?.title).toBe('推算大运流年');
	});

	it('returns tool content as compact markdown text instead of JSON dumps', async () => {
		const request = new IncomingRequest('http://example.com/lunar', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'convert_to_ganzhi',
					arguments: { datetime: '2024-01-15 08:30' },
				},
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await readMcpSse(response) as {
			result?: { content?: Array<{ type: string; text: string }> };
		};
		const text = body.result?.content?.[0]?.text ?? '';
		expect(text).toContain('输入: 2024-01-15 08:30');
		expect(text).toContain('| 年柱 | 月柱 | 日柱 | 时柱 | 完整四柱 |');
		expect(text).not.toContain('"ganZhi"');
		expect(() => JSON.parse(text)).toThrow();
	});

	it('does not route subpaths as MCP endpoints', async () => {
		const request = new IncomingRequest('http://example.com/lunar/test');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.text();
		expect(body).toContain('MCP endpoint: /lunar');
	});
});
