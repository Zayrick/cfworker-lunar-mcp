import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Lunar Calendar MCP Server', () => {
	it('returns server info on root path (unit style)', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.json() as Record<string, unknown>;
		expect(body).toHaveProperty('name', 'Lunar Calendar MCP Server');
		expect(body).toHaveProperty('mcp_endpoint', '/lunar');
		expect(body.tools).toContain('convert_to_ganzhi');
		expect(body.tools).toContain('get_current_ganzhi');
	});

	it('returns server info on root path (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/');
		const body = await response.json() as Record<string, unknown>;
		expect(body).toHaveProperty('name', 'Lunar Calendar MCP Server');
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
		const text = await response.text();
		const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
		expect(dataLine).toBeDefined();
		const body = JSON.parse(dataLine?.slice('data: '.length) ?? '{}') as {
			result?: { tools?: Array<{ name: string; title?: string }> };
		};
		const tools = new Map(body.result?.tools?.map((tool) => [tool.name, tool]));
		expect(tools.get('get_bazi_chart')?.title).toBe('八字排盘');
		expect(tools.get('get_bazi_fortune')?.title).toBe('推算大运流年');
	});

	it('does not route subpaths as MCP endpoints', async () => {
		const request = new IncomingRequest('http://example.com/lunar/test');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.json() as Record<string, unknown>;
		expect(body).toHaveProperty('mcp_endpoint', '/lunar');
	});
});
