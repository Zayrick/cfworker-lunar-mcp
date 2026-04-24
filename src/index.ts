import { createMcpHandler } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
	SolarTime,
	SolarDay,
	SolarTerm,
	ChildLimit,
	Gender,
	SixtyCycleYear,
	SixtyCycleDay,
	EightChar,
	HeavenStem,
	EarthBranch,
	SixtyCycle,
	DecadeFortune,
	Fortune,
} from 'tyme4ts';

// ===== Utility Helpers =====

function parseDatetime(datetime: string) {
	const match = datetime.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
	if (!match) return null;
	return {
		year: parseInt(match[1]),
		month: parseInt(match[2]),
		day: parseInt(match[3]),
		hour: parseInt(match[4]),
		minute: parseInt(match[5]),
	};
}

function toGender(g: string): Gender {
	return g === '男' || g.toLowerCase() === 'male' ? Gender.MAN : Gender.WOMAN;
}

function pad(n: number, len = 2) {
	return String(n).padStart(len, '0');
}

function jsonResult(data: unknown) {
	return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errResult(msg: string) {
	return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

// ===== BaZi Core Helpers =====

function buildBaziContext(datetime: string) {
	const dt = parseDatetime(datetime);
	if (!dt) throw new Error('Invalid format. Use YYYY-MM-DD HH:MM');
	const { year, month, day, hour, minute } = dt;
	const solarTime = SolarTime.fromYmdHms(year, month, day, hour, minute, 0);
	const solarDay = SolarDay.fromYmd(year, month, day);
	const lunarHour = solarTime.getLunarHour();
	const lunarDay = solarDay.getLunarDay();
	const eightChar = lunarHour.getEightChar();
	const dayMaster = eightChar.getDay().getHeavenStem();
	return { dt, solarTime, solarDay, lunarHour, lunarDay, eightChar, dayMaster };
}

/** Build detailed info for one pillar */
function pillarDetail(pillar: SixtyCycle, dayMaster: HeavenStem, isDayPillar: boolean) {
	const hs = pillar.getHeavenStem();
	const eb = pillar.getEarthBranch();

	// 十神
	const tenGod = isDayPillar ? '日主' : dayMaster.getTenStar(hs).getName();

	// 藏干 + each hidden stem's 十神
	const hiddenStems: { stem: string; tenGod: string }[] = [];
	const main = eb.getHideHeavenStemMain();
	hiddenStems.push({ stem: main.getName(), tenGod: dayMaster.getTenStar(main).getName() });
	const mid = eb.getHideHeavenStemMiddle();
	if (mid) hiddenStems.push({ stem: mid.getName(), tenGod: dayMaster.getTenStar(mid).getName() });
	const res = eb.getHideHeavenStemResidual();
	if (res) hiddenStems.push({ stem: res.getName(), tenGod: dayMaster.getTenStar(res).getName() });

	// 星运: terrain from day master's perspective
	const terrain = dayMaster.getTerrain(eb).getName();

	// 自坐: each pillar's own stem on its own branch
	const selfSitting = hs.getTerrain(eb).getName();

	// 空亡
	const extras = pillar.getExtraEarthBranches();
	const kongwang = [extras[0].getName(), extras[1].getName()];

	// 纳音
	const nayin = pillar.getSound().getName();

	return {
		pillar: pillar.getName(),
		tenGod,
		heavenStem: hs.getName(),
		earthBranch: eb.getName(),
		hiddenStems,
		terrain,
		selfSitting,
		kongwang,
		nayin,
	};
}

/** Find the two 节 (Jie) solar terms that bracket the birth date */
function findBracketingJie(year: number, month: number, day: number, hour: number, minute: number) {
	interface JieTerm {
		name: string;
		year: number;
		month: number;
		day: number;
		hour: number;
		minute: number;
		second: number;
		val: number;
	}

	const terms: JieTerm[] = [];
	for (const y of [year - 1, year, year + 1]) {
		for (let i = 0; i < 24; i++) {
			try {
				const t = SolarTerm.fromIndex(y, i);
				if (!t.isJie()) continue;
				const st = t.getJulianDay().getSolarTime();
				const item: JieTerm = {
					name: t.getName(),
					year: st.getYear(),
					month: st.getMonth(),
					day: st.getDay(),
					hour: st.getHour(),
					minute: st.getMinute(),
					second: st.getSecond(),
					val: st.getYear() * 1e8 + st.getMonth() * 1e6 + st.getDay() * 1e4 + st.getHour() * 100 + st.getMinute(),
				};
				terms.push(item);
			} catch {
				/* skip invalid */
			}
		}
	}
	terms.sort((a, b) => a.val - b.val);

	// Deduplicate by value
	const unique: JieTerm[] = [];
	for (const t of terms) {
		if (unique.length === 0 || unique[unique.length - 1].val !== t.val) unique.push(t);
	}

	const birthVal = year * 1e8 + month * 1e6 + day * 1e4 + hour * 100 + minute;
	let current = unique[0];
	let next = unique[1] || unique[0];
	for (let i = 0; i < unique.length - 1; i++) {
		if (birthVal >= unique[i].val && birthVal < unique[i + 1].val) {
			current = unique[i];
			next = unique[i + 1];
			break;
		}
	}

	const fmt = (t: JieTerm) => `${t.year}年${t.month}月${t.day}日 ${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
	return {
		current: { name: current.name, time: fmt(current) },
		next: { name: next.name, time: fmt(next) },
	};
}

/** Format SixtyCycle with its NaYin */
function sixtyCycleWithNayin(sc: SixtyCycle) {
	return { sixtyCycle: sc.getName(), nayin: sc.getSound().getName() };
}

// ===== Tool Registration =====

function registerGanzhiTools(server: McpServer) {
	server.tool(
		'convert_to_ganzhi',
		'将公历日期时间转换为天干地支（四柱/八字）及农历日期。Convert Gregorian date-time to 天干地支 four pillars.',
		{ datetime: z.string().describe('日期时间 YYYY-MM-DD HH:MM，如 "2024-01-15 08:30"') },
		async ({ datetime }) => {
			try {
				const { solarDay, lunarDay, eightChar } = buildBaziContext(datetime);
				return jsonResult({
					input: datetime,
					solar: solarDay.toString(),
					lunar: lunarDay.toString(),
					ganZhi: {
						year: eightChar.getYear().getName(),
						month: eightChar.getMonth().getName(),
						day: eightChar.getDay().getName(),
						hour: eightChar.getHour().getName(),
						full: eightChar.toString(),
					},
				});
			} catch (e) {
				return errResult(`转换错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.tool(
		'get_current_ganzhi',
		'获取当前日期时间的天干地支（四柱/八字）。Get current date-time\'s 天干地支 four pillars.',
		{},
		async () => {
			// Use UTC+8 (China Standard Time) instead of UTC
			const now = new Date(Date.now() + 8 * 3600_000);
			const datetime = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
			const { solarDay, lunarDay, eightChar } = buildBaziContext(datetime);
			return jsonResult({
				currentTime: datetime,
				solar: solarDay.toString(),
				lunar: lunarDay.toString(),
				ganZhi: {
					year: eightChar.getYear().getName(),
					month: eightChar.getMonth().getName(),
					day: eightChar.getDay().getName(),
					hour: eightChar.getHour().getName(),
					full: eightChar.toString(),
				},
			});
		},
	);
}

function registerBaziChartTool(server: McpServer) {
	server.tool(
		'get_bazi_chart',
		'八字命盘：获取四柱详情（十神、天干、地支、藏干、星运、自坐、空亡、纳音）、农历、节气、胎元、胎息、命宫、身宫、起运时间、大运列表。',
		{
			datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
			gender: z.string().describe('性别：男/女 或 male/female'),
		},
		async ({ datetime, gender }) => {
			try {
				const ctx = buildBaziContext(datetime);
				const { dt, solarTime, solarDay, lunarDay, eightChar, dayMaster } = ctx;
				const g = toGender(gender);

				// 四柱详情
				const fourPillars = {
					year: pillarDetail(eightChar.getYear(), dayMaster, false),
					month: pillarDetail(eightChar.getMonth(), dayMaster, false),
					day: pillarDetail(eightChar.getDay(), dayMaster, true),
					hour: pillarDetail(eightChar.getHour(), dayMaster, false),
				};

				// 农历
				const lunar = `${lunarDay.toString()} ${eightChar.getHour().getName()}时`;

				// 节气
				const solarTerms = findBracketingJie(dt.year, dt.month, dt.day, dt.hour, dt.minute);

				// 胎元、胎息
				const fetalOrigin = sixtyCycleWithNayin(eightChar.getFetalOrigin());
				const fetalBreath = sixtyCycleWithNayin(eightChar.getFetalBreath());

				// 命宫、身宫
				const lifePalace = sixtyCycleWithNayin(eightChar.getOwnSign());
				const bodyPalace = sixtyCycleWithNayin(eightChar.getBodySign());

				// 起运
				const childLimit = ChildLimit.fromSolarTime(solarTime, g);
				const endTime = childLimit.getEndTime();
				const startLuck = {
					description: `${childLimit.getYearCount()}年${childLimit.getMonthCount()}个月${childLimit.getDayCount()}天${childLimit.getHourCount()}时${childLimit.getMinuteCount()}分后起运`,
					startDate: `公历${endTime.getYear()}年${endTime.getMonth()}月${endTime.getDay()}日 ${pad(endTime.getHour())}:${pad(endTime.getMinute())}:${pad(endTime.getSecond())}`,
					years: childLimit.getYearCount(),
					months: childLimit.getMonthCount(),
					days: childLimit.getDayCount(),
					hours: childLimit.getHourCount(),
					minutes: childLimit.getMinuteCount(),
				};

				// 大运
				const birthYear = dt.year;
				const majorLuck: unknown[] = [];

				// 童限
				majorLuck.push({
					type: '童限',
					startYear: birthYear + childLimit.getStartAge() - 1,
					endYear: birthYear + childLimit.getEndAge(),
					ageRange: `${childLimit.getStartAge()} - ${childLimit.getEndAge()}岁`,
				});

				// 十步大运
				let decade = childLimit.getStartDecadeFortune();
				for (let i = 0; i < 10; i++) {
					const sc = decade.getSixtyCycle();
					majorLuck.push({
						sixtyCycle: sc.getName(),
						tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
						nayin: sc.getSound().getName(),
						startAge: decade.getStartAge(),
						endAge: decade.getEndAge(),
						startYear: birthYear + decade.getStartAge() - 1,
						endYear: birthYear + decade.getEndAge() - 1,
						ageRange: `${decade.getStartAge()} - ${decade.getEndAge()}岁`,
					});
					decade = decade.next(1);
				}

				return jsonResult({
					input: datetime,
					solar: solarDay.toString(),
					lunar,
					fourPillars,
					solarTerms,
					fetalOrigin,
					fetalBreath,
					lifePalace,
					bodyPalace,
					startLuck,
					majorLuck,
				});
			} catch (e) {
				return errResult(`八字命盘错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerBaziFortuneTool(server: McpServer) {
	server.tool(
		'get_bazi_fortune',
		'八字小运与流年：输入出生信息和年份范围，获取每年的小运（个人年运）和流年（该年干支）及对应十神。',
		{
			datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
			gender: z.string().describe('性别：男/女 或 male/female'),
			startYear: z.number().describe('起始年份（公历年份）'),
			count: z.number().optional().default(10).describe('查询年数，默认10'),
		},
		async ({ datetime, gender, startYear, count }) => {
			try {
				const ctx = buildBaziContext(datetime);
				const { dt, solarTime, eightChar, dayMaster } = ctx;
				const g = toGender(gender);
				const birthYear = dt.year;
				const childLimit = ChildLimit.fromSolarTime(solarTime, g);

				// Find the starting fortune index: age = startYear - birthYear + 1
				const startAge = startYear - birthYear + 1;
				const results: unknown[] = [];

				// Iterate through Fortune objects
				let fortune = childLimit.getStartFortune();
				// Advance to start age
				const firstAge = fortune.getAge();
				if (startAge > firstAge) {
					fortune = fortune.next(startAge - firstAge);
				}

				for (let i = 0; i < count; i++) {
					const age = fortune.getAge();
					const year = birthYear + age - 1;

					// 小运: personal fortune cycle
					const fortuneSc = fortune.getSixtyCycle();
					const fortuneTenGod = dayMaster.getTenStar(fortuneSc.getHeavenStem()).getName();

					// 流年: universal year cycle
					const yearSc = fortune.getSixtyCycleYear().getSixtyCycle();
					const yearTenGod = dayMaster.getTenStar(yearSc.getHeavenStem()).getName();

					// Find which 大运 this year belongs to
					let decadeInfo: { sixtyCycle: string; tenGod: string } | null = null;
					let dec = childLimit.getStartDecadeFortune();
					for (let d = 0; d < 10; d++) {
						if (age >= dec.getStartAge() && age <= dec.getEndAge()) {
							const decSc = dec.getSixtyCycle();
							decadeInfo = {
								sixtyCycle: decSc.getName(),
								tenGod: dayMaster.getTenStar(decSc.getHeavenStem()).getName(),
							};
							break;
						}
						dec = dec.next(1);
					}

					results.push({
						year,
						age,
						daYun: decadeInfo,
						xiaoYun: { sixtyCycle: fortuneSc.getName(), tenGod: fortuneTenGod },
						liuNian: { sixtyCycle: yearSc.getName(), tenGod: yearTenGod },
					});

					fortune = fortune.next(1);
				}

				return jsonResult({
					birthYear,
					dayMaster: dayMaster.getName(),
					queryRange: { startYear, count },
					fortunes: results,
				});
			} catch (e) {
				return errResult(`小运流年错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerFlowMonthTool(server: McpServer) {
	server.tool(
		'get_bazi_flow_month',
		'八字流月：输入出生日期和指定年份，获取该年12个月的干支及十神（流月）。',
		{
			datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
			year: z.number().describe('查询年份（公历年份）'),
		},
		async ({ datetime, year }) => {
			try {
				const { dayMaster } = buildBaziContext(datetime);
				const scYear = SixtyCycleYear.fromYear(year);
				const yearSc = scYear.getSixtyCycle();
				const months = scYear.getMonths();

				const flowMonths = months.map((m, i) => {
					const sc = m.getSixtyCycle();
					const eb = sc.getEarthBranch();
					const firstDay = m.getFirstDay();
					const solarDay = firstDay.getSolarDay();
					const solarStart = `${solarDay.getYear()}-${pad(solarDay.getMonth())}-${pad(solarDay.getDay())}`;

					// Get end date: next month's first day - 1, or next year's first month - 1
					let solarEnd: string;
					if (i < months.length - 1) {
						const nextFirst = months[i + 1].getFirstDay().getSolarDay();
						const endDay = nextFirst.next(-1);
						solarEnd = `${endDay.getYear()}-${pad(endDay.getMonth())}-${pad(endDay.getDay())}`;
					} else {
						const nextYearFirst = SixtyCycleYear.fromYear(year + 1).getFirstMonth().getFirstDay().getSolarDay();
						const endDay = nextYearFirst.next(-1);
						solarEnd = `${endDay.getYear()}-${pad(endDay.getMonth())}-${pad(endDay.getDay())}`;
					}

					return {
						monthName: `${eb.getName()}月`,
						solarDateRange: `${solarStart} ~ ${solarEnd}`,
						sixtyCycle: sc.getName(),
						tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
						nayin: sc.getSound().getName(),
					};
				});

				return jsonResult({
					year,
					yearSixtyCycle: yearSc.getName(),
					dayMaster: dayMaster.getName(),
					flowMonths,
				});
			} catch (e) {
				return errResult(`流月错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerFlowDayTool(server: McpServer) {
	server.tool(
		'get_bazi_flow_day',
		'八字流日：输入出生日期和指定年月，获取该月每日的干支及十神（流日）。',
		{
			datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
			year: z.number().describe('查询年份（公历年份）'),
			month: z.number().describe('查询月份（公历月份 1-12）'),
		},
		async ({ datetime, year, month }) => {
			try {
				const { dayMaster } = buildBaziContext(datetime);

				// Determine days in the Gregorian month
				const daysInMonth = new Date(year, month, 0).getDate();
				const flowDays: unknown[] = [];

				for (let d = 1; d <= daysInMonth; d++) {
					const solarDay = SolarDay.fromYmd(year, month, d);
					const scDay = SixtyCycleDay.fromSolarDay(solarDay);
					const sc = scDay.getSixtyCycle();
					flowDays.push({
						date: `${year}-${pad(month)}-${pad(d)}`,
						sixtyCycle: sc.getName(),
						tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
						nayin: sc.getSound().getName(),
					});
				}

				return jsonResult({
					year,
					month,
					dayMaster: dayMaster.getName(),
					flowDays,
				});
			} catch (e) {
				return errResult(`流日错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

// ===== Server Creation =====

function createServer() {
	const server = new McpServer({
		name: 'Lunar Calendar MCP',
		version: '1.0.0',
	});

	registerGanzhiTools(server);
	registerBaziChartTool(server);
	registerBaziFortuneTool(server);
	registerFlowMonthTool(server);
	registerFlowDayTool(server);

	return server;
}

// ===== Export =====

const allToolNames = [
	'convert_to_ganzhi',
	'get_current_ganzhi',
	'get_bazi_chart',
	'get_bazi_fortune',
	'get_bazi_flow_month',
	'get_bazi_flow_day',
];

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/lunar') {
			const server = createServer();
			return createMcpHandler(server, { route: '/lunar' })(request, env, ctx);
		}

		return new Response(
			JSON.stringify({
				name: 'Lunar Calendar MCP Server',
				description: '农历/公历转换、天干地支、八字命盘、大运小运流年流月流日',
				mcp_endpoint: '/lunar',
				tools: allToolNames,
			}),
			{
				headers: { 'Content-Type': 'application/json; charset=utf-8' },
			},
		);
	},
} satisfies ExportedHandler<Env>;
