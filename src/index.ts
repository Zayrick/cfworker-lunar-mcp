import { createMcpHandler } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SolarTime, SolarDay } from 'tyme4ts';

function formatGanZhiResult(
	solarDay: SolarDay,
	solarTime: SolarTime,
) {
	const lunarDay = solarDay.getLunarDay();
	const lunarHour = solarTime.getLunarHour();
	const eightChar = lunarHour.getEightChar();

	return {
		solar: solarDay.toString(),
		lunar: lunarDay.toString(),
		ganZhi: {
			year: eightChar.getYear().getName(),
			month: eightChar.getMonth().getName(),
			day: eightChar.getDay().getName(),
			hour: eightChar.getHour().getName(),
			full: eightChar.toString(),
		},
	};
}

function createServer() {
	const server = new McpServer({
		name: 'Lunar Calendar MCP',
		version: '1.0.0',
	});

	server.tool(
		'convert_to_ganzhi',
		'Convert a Gregorian date-time (YYYY-MM-DD HH:MM) to Chinese Heavenly Stems and Earthly Branches (天干地支). Returns 干支 for year, month, day, and hour pillars (四柱/八字), along with the corresponding lunar date.',
		{
			datetime: z
				.string()
				.describe('Date-time string in YYYY-MM-DD HH:MM format, e.g. "2024-01-15 08:30"'),
		},
		async ({ datetime }) => {
			const match = datetime.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
			if (!match) {
				return {
					content: [{ type: 'text' as const, text: 'Invalid format. Please use YYYY-MM-DD HH:MM (e.g. "2024-01-15 08:30")' }],
					isError: true,
				};
			}

			const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
			const year = parseInt(yearStr);
			const month = parseInt(monthStr);
			const day = parseInt(dayStr);
			const hour = parseInt(hourStr);
			const minute = parseInt(minuteStr);

			try {
				const solarTime = SolarTime.fromYmdHms(year, month, day, hour, minute, 0);
				const solarDay = SolarDay.fromYmd(year, month, day);
				const result = formatGanZhiResult(solarDay, solarTime);

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ input: datetime, ...result }, null, 2),
						},
					],
				};
			} catch (e) {
				return {
					content: [{ type: 'text' as const, text: `Conversion error: ${e instanceof Error ? e.message : String(e)}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		'get_current_ganzhi',
		'Get the current date and time\'s Chinese Heavenly Stems and Earthly Branches (天干地支). Returns the current 干支 for year, month, day, and hour pillars (四柱/八字), along with the corresponding lunar date.',
		{},
		async () => {
			const now = new Date();
			const year = now.getFullYear();
			const month = now.getMonth() + 1;
			const day = now.getDate();
			const hour = now.getHours();
			const minute = now.getMinutes();

			const solarTime = SolarTime.fromYmdHms(year, month, day, hour, minute, 0);
			const solarDay = SolarDay.fromYmd(year, month, day);
			const result = formatGanZhiResult(solarDay, solarTime);

			const pad = (n: number) => String(n).padStart(2, '0');
			const currentTime = `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;

			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({ currentTime, ...result }, null, 2),
					},
				],
			};
		},
	);

	return server;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
			const server = createServer();
			return createMcpHandler(server)(request, env, ctx);
		}

		return new Response(
			JSON.stringify({
				name: 'Lunar Calendar MCP Server',
				description: 'Public/Lunar calendar conversion with Heavenly Stems and Earthly Branches (天干地支)',
				mcp_endpoint: '/mcp',
				tools: ['convert_to_ganzhi', 'get_current_ganzhi'],
			}),
			{
				headers: { 'Content-Type': 'application/json; charset=utf-8' },
			},
		);
	},
} satisfies ExportedHandler<Env>;
