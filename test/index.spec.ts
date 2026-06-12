import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const newToolNames = [
	'bazi_chart',
	'bazi_structure',
	'bazi_timeline',
	'bazi_period_detail',
	'bazi_shensha',
	'ziwei_chart',
	'ziwei_palace_detail',
	'ziwei_horoscope_overview',
	'ziwei_scope_detail',
	'ziwei_topic_context',
];

const legacyToolNames = [
	'convert_to_ganzhi',
	'get_current_ganzhi',
	'get_bazi_chart',
	'get_bazi_shensha',
	'get_bazi_fortune',
	'get_bazi_flow_month',
	'get_bazi_flow_day',
	'get_bazi_flow_hour',
	'get_ziwei_chart',
	'get_ziwei_horoscope',
	'get_ziwei_scope_detail',
];

type ToolCallResult = {
	content?: Array<{ type: string; text: string }>;
	structuredContent?: {
		ok?: boolean;
		kind?: string;
		summary?: string;
		data?: Record<string, unknown>;
		warnings?: string[];
	};
	isError?: boolean;
};

async function readMcpSse(response: Response) {
	const text = await response.text();
	const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
	expect(dataLine).toBeDefined();
	return JSON.parse(dataLine?.slice('data: '.length) ?? '{}') as {
		result?: unknown;
		error?: { message?: string };
	};
}

async function mcpRequest(method: string, params: Record<string, unknown>) {
	const request = new IncomingRequest('http://example.com/lunar', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method,
			params,
		}),
	});
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	expect(response.status).toBe(200);
	return readMcpSse(response);
}

async function listTools() {
	const body = await mcpRequest('tools/list', {});
	return (body.result as {
		tools?: Array<{
			name: string;
			title?: string;
			description?: string;
			outputSchema?: unknown;
		}>;
	}).tools ?? [];
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
	const body = await mcpRequest('tools/call', {
		name,
		arguments: args,
	});
	if (body.error) {
		return {
			isError: true,
			content: [{ type: 'text', text: body.error.message ?? '' }],
		};
	}
	return (body.result ?? {}) as ToolCallResult;
}

function toolText(result: ToolCallResult) {
	return result.content?.[0]?.text ?? '';
}

function expectStructuredResult(result: ToolCallResult, kind: string) {
	expect(result.isError).not.toBe(true);
	expect(result.content ?? []).toHaveLength(0);
	expect(result.structuredContent).toMatchObject({
		ok: true,
		kind,
	});
	expect(result.structuredContent?.data).toBeDefined();
}

describe('Lunar Calendar MCP Server', () => {
	it('returns server info on root path with the new bazi and ziwei tools', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.text();
		expect(response.headers.get('content-type')).toContain('text/plain');
		expect(body).toContain('Lunar Calendar MCP Server');
		expect(body).toContain('MCP endpoint: /lunar');
		for (const name of newToolNames) expect(body).toContain(`| ${name} |`);
		for (const name of legacyToolNames) expect(body).not.toContain(name);
	});

	it('returns server info on root path (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/');
		const body = await response.text();
		expect(body).toContain('Lunar Calendar MCP Server');
		expect(body).toContain('bazi_structure');
		expect(body).toContain('ziwei_topic_context');
	});

	it('routes MCP requests on /lunar only', async () => {
		const body = await mcpRequest('tools/list', {});
		expect(body.result).toBeDefined();
	});

	it('does not route subpaths as MCP endpoints', async () => {
		const request = new IncomingRequest('http://example.com/lunar/test');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = await response.text();
		expect(body).toContain('MCP endpoint: /lunar');
		expect(body).toContain('bazi_chart');
	});

	it('exposes only the new MCP tool surface with descriptions and output schemas', async () => {
		const tools = await listTools();
		const names = tools.map((tool) => tool.name);
		expect(names).toEqual(newToolNames);
		for (const name of legacyToolNames) expect(names).not.toContain(name);

		const byName = new Map(tools.map((tool) => [tool.name, tool]));
		const expectedTitles: Record<string, string> = {
			bazi_chart: '八字本命基础盘',
			bazi_structure: '八字命局结构证据',
			bazi_timeline: '八字大运流年时间轴',
			bazi_period_detail: '八字单一周期详盘',
			bazi_shensha: '八字神煞辅助表',
			ziwei_chart: '紫微斗数本命全盘',
			ziwei_palace_detail: '紫微斗数单宫详盘',
			ziwei_horoscope_overview: '紫微运限总览',
			ziwei_scope_detail: '紫微单层运限详盘',
			ziwei_topic_context: '紫微专题取证',
		};

		for (const name of newToolNames) {
			const tool = byName.get(name);
			expect(tool?.title).toBe(expectedTitles[name]);
			expect(tool?.description).toContain('适用场景');
			expect(tool?.description).toContain('不要');
			expect(tool?.description).toContain('下一步');
		}

		for (const name of ['bazi_chart', 'bazi_structure', 'bazi_timeline', 'ziwei_chart', 'ziwei_scope_detail']) {
			expect(byName.get(name)?.outputSchema).toBeDefined();
		}
	});

	it.each([
		{
			name: 'bazi_chart',
			args: { datetime: '2024-01-15 08:30', gender: '男' },
			expectedSummary: '八字本命基础盘',
		},
		{
			name: 'bazi_structure',
			args: { datetime: '2024-01-15 08:30', gender: '男' },
			expectedSummary: '八字结构取证数据',
		},
		{
			name: 'bazi_timeline',
			args: { datetime: '2024-01-15 08:30', gender: '男', startYear: 2026, count: 2 },
			expectedSummary: '八字大运流年时间轴',
		},
		{
			name: 'bazi_period_detail',
			args: { datetime: '2024-01-15 08:30', gender: '男', scope: 'day', date: '2026-06-12' },
			expectedSummary: '八字单一周期详盘',
		},
		{
			name: 'bazi_shensha',
			args: { datetime: '2024-01-15 08:30' },
			expectedSummary: '常用八字神煞辅助表',
		},
		{
			name: 'ziwei_chart',
			args: { datetime: '2024-01-15 08:30', gender: '男', profile: 'sanhe' },
			expectedSummary: '紫微本命全盘',
		},
		{
			name: 'ziwei_palace_detail',
			args: { datetime: '2024-01-15 08:30', gender: '男', palace: '命宫' },
			expectedSummary: '紫微单宫详盘',
		},
		{
			name: 'ziwei_horoscope_overview',
			args: {
				birthDatetime: '2024-01-15 08:30',
				gender: '男',
				targetDatetime: '2026-06-12 18:00',
				profile: 'sanhe',
			},
			expectedSummary: '紫微运限总览',
		},
		{
			name: 'ziwei_scope_detail',
			args: {
				birthDatetime: '2024-01-15 08:30',
				gender: '男',
				targetDatetime: '2026-06-12 18:00',
				scope: 'yearly',
				focusPalace: '命宫',
			},
			expectedSummary: '紫微单层运限详盘',
		},
		{
			name: 'ziwei_topic_context',
			args: {
				birthDatetime: '2024-01-15 08:30',
				gender: '男',
				targetDatetime: '2026-06-12 18:00',
				topic: 'career',
			},
			expectedSummary: '紫微专题取证',
		},
	])('returns structuredContent without markdown content for $name', async ({ name, args, expectedSummary }) => {
		const result = await callTool(name, args);
		expectStructuredResult(result, name);
		expect(result.structuredContent?.summary).toContain(expectedSummary);
	});

	it('keeps ziwei topic context compact and points to detail tools', async () => {
		const result = await callTool('ziwei_topic_context', {
			birthDatetime: '2024-01-15 08:30',
			gender: '男',
			targetDatetime: '2026-06-12 18:00',
			topic: 'career',
		});
		expectStructuredResult(result, 'ziwei_topic_context');
		const data = result.structuredContent?.data as {
			palaces?: Array<Record<string, unknown>>;
			runtime?: Record<string, unknown>;
		};
		const palaces = data.palaces ?? [];
		expect(JSON.stringify(data).length).toBeLessThan(25000);
		expect(data.runtime).toMatchObject({ profile: 'sanhe', calendar: 'solar' });
		expect(palaces.map((palace) => palace.name)).toEqual(['官禄', '迁移', '财帛', '福德']);

		const firstPalace = palaces[0] as Record<string, unknown>;
		expect(firstPalace.origin).toBeUndefined();
		expect(firstPalace.originSurrounded).toBeUndefined();
		expect(firstPalace.yearlySurrounded).toBeUndefined();
		expect(firstPalace.natal).toMatchObject({ name: '官禄' });
		expect(firstPalace.natalSurrounded).toBeInstanceOf(Array);
		expect(firstPalace.nextCalls).toEqual([
			{ tool: 'ziwei_palace_detail', arguments: { palace: '官禄' } },
			{ tool: 'ziwei_scope_detail', arguments: { scope: 'yearly', focusPalace: '官禄' } },
		]);
		expect(result.structuredContent?.warnings?.[0]).toContain('索引级证据');
	});

	it('keeps overview and structure tools inside their intended boundaries', async () => {
		const structure = await callTool('bazi_structure', {
			datetime: '2024-01-15 08:30',
			gender: '男',
		});
		expectStructuredResult(structure, 'bazi_structure');
		expect(structure.structuredContent?.summary).toContain('不直接给');
		expect(structure.structuredContent?.summary).not.toMatch(/最终断命结论[:：]/);

		const overview = await callTool('ziwei_horoscope_overview', {
			birthDatetime: '2024-01-15 08:30',
			gender: '男',
			targetDatetime: '2026-06-12 18:00',
		});
		expectStructuredResult(overview, 'ziwei_horoscope_overview');
		expect(overview.structuredContent?.summary).toContain('只做导航');
		expect(overview.structuredContent?.summary).toContain('下一步调用 ziwei_scope_detail');
	});

	it.each([
		['invalid date', 'bazi_chart', { datetime: 'not-a-date', gender: '男' }],
		['invalid gender', 'bazi_chart', { datetime: '2024-01-15 08:30', gender: 'unknown' }],
		['invalid scope', 'bazi_period_detail', { datetime: '2024-01-15 08:30', gender: '男', scope: 'week', date: '2026-06-12' }],
		['invalid topic', 'ziwei_topic_context', {
			birthDatetime: '2024-01-15 08:30',
			gender: '男',
			targetDatetime: '2026-06-12 18:00',
			topic: 'education',
		}],
		['invalid profile', 'ziwei_chart', { datetime: '2024-01-15 08:30', gender: '男', profile: 'legacy' }],
		['invalid calendar', 'ziwei_chart', { datetime: '2024-01-15 08:30', gender: '男', calendar: 'gregorian' }],
	])('returns isError for %s', async (_label, name, args) => {
		const result = await callTool(name, args);
		expect(result.isError).toBe(true);
		expect(toolText(result).length).toBeGreaterThan(0);
	});
});
