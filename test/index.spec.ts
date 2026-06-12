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
	'liuyao_chart',
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
	structuredContent?: unknown;
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

function expectMarkdownResult(result: ToolCallResult, expectedText: string) {
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toBeUndefined();
	expect(result.content ?? []).toHaveLength(1);
	expect(result.content?.[0]?.type).toBe('text');
	const text = toolText(result);
	expect(text).toContain(expectedText);
	expect(text).toMatch(/\| .+ \|/);
	return text;
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

	it('exposes only the new MCP tool surface with descriptions and markdown-only outputs', async () => {
		const tools = await listTools();
		const names = tools.map((tool) => tool.name);
		expect(names).toEqual(newToolNames);
		for (const name of legacyToolNames) expect(names).not.toContain(name);

		const byName = new Map(tools.map((tool) => [tool.name, tool]));
		const expectedTitles: Record<string, string> = {
			bazi_chart: '八字排盘',
			bazi_structure: '八字命局分析',
			bazi_timeline: '八字大运流年',
			bazi_period_detail: '八字周期详盘',
			bazi_shensha: '八字神煞参考',
			liuyao_chart: '六爻排盘',
			ziwei_chart: '紫微斗数排盘',
			ziwei_palace_detail: '紫微宫位详盘',
			ziwei_horoscope_overview: '紫微运限概览',
			ziwei_scope_detail: '紫微运限详盘',
			ziwei_topic_context: '紫微专题分析',
		};

		for (const name of newToolNames) {
			const tool = byName.get(name);
			expect(tool?.title).toBe(expectedTitles[name]);
			expect(tool?.description).toContain('适用场景');
			expect(tool?.description).toContain('不要');
			expect(tool?.description).toContain('下一步');
		}

		for (const name of newToolNames) expect(byName.get(name)?.outputSchema).toBeUndefined();
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
			expectedSummary: '八字命局结构证据',
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
			name: 'liuyao_chart',
			args: {
				question: '这次合作能不能成',
				datetime: '2026-06-12 18:00',
				originalHexagram: '火泽睽',
				changedHexagram: '火雷噬嗑',
			},
			expectedSummary: '六爻排盘',
		},
		{
			name: 'ziwei_chart',
			args: { datetime: '2024-01-15 08:30', gender: '男', profile: 'sanhe' },
			expectedSummary: '紫微斗数本命全盘',
		},
		{
			name: 'ziwei_palace_detail',
			args: { datetime: '2024-01-15 08:30', gender: '男', palace: '命宫' },
			expectedSummary: '紫微斗数单宫详盘',
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
	])('returns markdown content without structuredContent for $name', async ({ name, args, expectedSummary }) => {
		const result = await callTool(name, args);
		expectMarkdownResult(result, expectedSummary);
	});

	it('keeps ziwei topic context compact and points to detail tools in markdown', async () => {
		const result = await callTool('ziwei_topic_context', {
			birthDatetime: '2024-01-15 08:30',
			gender: '男',
			targetDatetime: '2026-06-12 18:00',
			topic: 'career',
		});
		const text = expectMarkdownResult(result, '紫微专题取证');
		expect(text.length).toBeLessThan(6000);
		for (const palace of ['官禄', '迁移', '财帛', '福德']) expect(text).toContain(`| ${palace} |`);
		expect(text).toContain('目标公历');
		expect(text).toContain('本命飞化');
		expect(text).toContain('建议调用');
		expect(text).toContain('ziwei_palace_detail(palace=官禄)');
		expect(text).toContain('ziwei_scope_detail(scope=yearly, focusPalace=官禄)');
		expect(text).not.toContain('nextCalls');
		expect(text).not.toContain('"natalSurrounded"');
	});

	it('keeps overview and structure tools inside their intended boundaries', async () => {
		const structure = await callTool('bazi_structure', {
			datetime: '2024-01-15 08:30',
			gender: '男',
		});
		const structureText = expectMarkdownResult(structure, '八字命局结构证据');
		expect(structureText).toContain('不输出最终断命结论');
		expect(structureText).not.toMatch(/最终断命结论[:：]/);

		const overview = await callTool('ziwei_horoscope_overview', {
			birthDatetime: '2024-01-15 08:30',
			gender: '男',
			targetDatetime: '2026-06-12 18:00',
		});
		const overviewText = expectMarkdownResult(overview, '紫微运限总览');
		expect(overviewText).toContain('只做导航');
		expect(overviewText).toContain('下一步必须调用 ziwei_scope_detail');
	});

	it('returns liuyao chart details with main and changed hexagram tables', async () => {
		const result = await callTool('liuyao_chart', {
			question: '这次合作能不能成',
			datetime: '2026-06-12 18:00',
			originalHexagram: '火泽睽',
			changedHexagram: '火雷噬嗑',
		});
		const text = expectMarkdownResult(result, '六爻排盘');
		expect(text).toContain('所问之事：这次合作能不能成');
		expect(text).toContain('干支:');
		expect(text).toContain('空亡：年空亡');
		expect(text).toContain('卦身：');
		expect(text).toContain('世身：');
		expect(text).toContain('主卦：火泽睽');
		expect(text).toContain('变卦：火雷噬嗑');
		expect(text).toContain('| 爻位 | 六神 | 六亲 | 干支 | 世应 | 伏神 | 是否变卦 | 神煞 | 长生 |');
		expect(text).toContain('| 三爻 ━ ━ 阴 |');
		expect(text).toContain('| 是 |');
		expect(text).toContain('六亲、世应沿用主卦艮宫土');
	});

	it.each([
		['invalid date', 'bazi_chart', { datetime: 'not-a-date', gender: '男' }],
		['invalid gender', 'bazi_chart', { datetime: '2024-01-15 08:30', gender: 'unknown' }],
		['invalid scope', 'bazi_period_detail', { datetime: '2024-01-15 08:30', gender: '男', scope: 'week', date: '2026-06-12' }],
		['invalid liuyao hexagram', 'liuyao_chart', {
			question: '测试',
			datetime: '2026-06-12 18:00',
			originalHexagram: '不存在卦',
			changedHexagram: '乾为天',
		}],
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
