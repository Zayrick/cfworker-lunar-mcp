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

async function callTool(name: string, args: Record<string, unknown>) {
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
				name,
				arguments: args,
			},
		}),
	});
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	const body = await readMcpSse(response) as {
		result?: { content?: Array<{ type: string; text: string }> };
	};
	return body.result?.content?.[0]?.text ?? '';
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
		expect(tools.get('get_bazi_shensha')?.title).toBe('八字神煞');
		expect(tools.get('get_bazi_fortune')?.title).toBe('推算大运流年');
		expect(tools.get('get_bazi_flow_hour')?.title).toBe('流时排盘');
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

	it('includes shensha, relations, and element scores in bazi chart', async () => {
		const text = await callTool('get_bazi_chart', { datetime: '2024-01-15 08:30', gender: '男' });
		expect(text).toContain('命中神煞');
		expect(text).toContain('刑冲合害关系');
		expect(text).toContain('五行力量统计');
		expect(text).toContain('| 五行 | 分数 | 占比 | 备注 |');
	});

	it('returns 12 flow hours with ten gods', async () => {
		const text = await callTool('get_bazi_flow_hour', { datetime: '2024-01-15 08:30', date: '2024-01-15' });
		expect(text).toContain('流日:');
		expect(text).toContain('| 时间范围 | 时辰 | 干支 | 十神 | 纳音 | 十二神 | 九星 | 宜 | 忌 |');
		expect(text).toContain('子时');
		expect(text).toContain('亥时');
	});

	it('returns bazi shensha lookup table', async () => {
		const text = await callTool('get_bazi_shensha', { datetime: '2024-01-15 08:30' });
		expect(text).toContain('| 神煞 | 起法 | 目标 | 命中位置 |');
		expect(text).toContain('天乙贵人');
		expect(text).toContain('驿马');
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
