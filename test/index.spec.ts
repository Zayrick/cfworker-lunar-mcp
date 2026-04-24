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
			headers: { 'content-type': 'application/json' },
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
		expect(response.status).not.toBe(404);
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
