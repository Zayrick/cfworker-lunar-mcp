import { createMcpHandler } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { astro } from 'iztro';
import type { HoroscopeItem, Option as ZiweiOption } from 'iztro/lib/data/types';
import type { IFunctionalAstrolabe } from 'iztro/lib/astro/FunctionalAstrolabe';
import type { IFunctionalHoroscope } from 'iztro/lib/astro/FunctionalHoroscope';
import type { IFunctionalPalace } from 'iztro/lib/astro/FunctionalPalace';
import type { IFunctionalStar } from 'iztro/lib/star/FunctionalStar';
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

function parseDate(date: string) {
	const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return null;
	return {
		year: parseInt(match[1]),
		month: parseInt(match[2]),
		day: parseInt(match[3]),
	};
}

function toGender(g: string): Gender {
	return g === '男' || g.toLowerCase() === 'male' ? Gender.MAN : Gender.WOMAN;
}

function pad(n: number, len = 2) {
	return String(n).padStart(len, '0');
}

function textResult(text: string) {
	return { content: [{ type: 'text' as const, text }] };
}

function errResult(msg: string) {
	return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

function mdValue(value: unknown) {
	const text = value === undefined || value === null || value === '' ? '-' : String(value);
	return text.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|');
}

function mdTable(headers: string[], rows: unknown[][]) {
	return [
		`| ${headers.map(mdValue).join(' | ')} |`,
		`| ${headers.map(() => '---').join(' | ')} |`,
		...rows.map((row) => `| ${row.map(mdValue).join(' | ')} |`),
	].join('\n');
}

function joinSections(sections: Array<string | undefined | null | false>) {
	return sections.filter(Boolean).join('\n\n');
}

// ===== Ziwei Doushu Helpers =====

const ziweiProfiles = ['sanhe', 'feixing-sihua'] as const;
type ZiweiProfile = typeof ziweiProfiles[number];

const ziweiProfileLabels: Record<ZiweiProfile, string> = {
	sanhe: '三合',
	'feixing-sihua': '飞星四化',
};

const ziweiLanguages = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN'] as const;
type ZiweiLanguage = typeof ziweiLanguages[number];

type ZiweiCalendar = 'solar' | 'lunar';

const ziweiScopes = ['decadal', 'age', 'yearly', 'monthly', 'daily', 'hourly'] as const;
type ZiweiScope = typeof ziweiScopes[number];
type ZiweiRuntimeScope = Exclude<ZiweiScope, 'age'>;

const ziweiScopeLabels: Record<ZiweiScope, string> = {
	decadal: '大限',
	age: '小限',
	yearly: '流年',
	monthly: '流月',
	daily: '流日',
	hourly: '流时',
};

function isOneOf<T extends readonly string[]>(value: string, options: T): value is T[number] {
	return (options as readonly string[]).includes(value);
}

function normalizeZiweiProfile(profile?: string): ZiweiProfile {
	if (!profile) return 'sanhe';
	if (isOneOf(profile, ziweiProfiles)) return profile;
	throw new Error('Unsupported profile. Use sanhe or feixing-sihua.');
}

function normalizeZiweiCalendar(calendar?: string): ZiweiCalendar {
	const value = (calendar ?? 'solar').toLowerCase();
	if (value === 'solar' || value === '公历' || value === '阳历') return 'solar';
	if (value === 'lunar' || value === '农历' || value === '阴历') return 'lunar';
	throw new Error('Unsupported calendar. Use solar or lunar.');
}

function normalizeZiweiLanguage(language?: string): ZiweiLanguage {
	if (!language) return 'zh-CN';
	if (isOneOf(language, ziweiLanguages)) return language;
	throw new Error('Unsupported language. Use zh-CN, zh-TW, en-US, ja-JP, ko-KR, or vi-VN.');
}

function normalizeZiweiScope(scope: string): ZiweiScope {
	if (isOneOf(scope, ziweiScopes)) return scope;
	throw new Error('Unsupported scope. Use decadal, age, yearly, monthly, daily, or hourly.');
}

function toZiweiGender(gender: string): '男' | '女' {
	const value = gender.trim().toLowerCase();
	if (value === '男' || value === 'male' || value === 'm') return '男';
	if (value === '女' || value === 'female' || value === 'f') return '女';
	throw new Error('Invalid gender. Use 男/女 or male/female.');
}

function ziweiTimeIndex(dt: ReturnType<typeof parseDatetime>) {
	if (!dt) throw new Error('Invalid format. Use YYYY-MM-DD HH:MM');
	if (dt.hour === 0) return 0;
	if (dt.hour === 23) return 12;
	return Math.floor((dt.hour + 1) / 2);
}

function ziweiProfileConfig(profile: ZiweiProfile): ZiweiOption['config'] {
	return {
		algorithm: profile === 'feixing-sihua' ? 'zhongzhou' : 'default',
		yearDivide: profile === 'feixing-sihua' ? 'exact' : 'normal',
		horoscopeDivide: profile === 'feixing-sihua' ? 'exact' : 'normal',
		dayDivide: profile === 'feixing-sihua' ? 'forward' : 'current',
	};
}

function ziweiDateString(dt: NonNullable<ReturnType<typeof parseDatetime>>) {
	return `${dt.year}-${pad(dt.month)}-${pad(dt.day)}`;
}

function starText(star: IFunctionalStar) {
	return [
		star.name,
		star.brightness ? `(${star.brightness})` : undefined,
		star.mutagen ? `[${star.mutagen}]` : undefined,
	].filter(Boolean).join('');
}

function starListText(stars: IFunctionalStar[], empty = '-') {
	return stars.length > 0 ? stars.map(starText).join('、') : empty;
}

function starNamesText(stars: IFunctionalStar[] | undefined, empty = '-') {
	return stars && stars.length > 0 ? stars.map((star) => star.name).join('、') : empty;
}

function mutagenText(item: Pick<HoroscopeItem, 'mutagen'>) {
	return item.mutagen.length > 0 ? item.mutagen.join('、') : '-';
}

function horoscopeStarsText(item: Pick<HoroscopeItem, 'stars'>, index: number) {
	return starNamesText(item.stars?.[index]);
}

function horoscopeItemBranch(item: Pick<HoroscopeItem, 'heavenlyStem' | 'earthlyBranch'>) {
	return `${item.heavenlyStem}${item.earthlyBranch}`;
}

function decadalText(palace: IFunctionalPalace) {
	const range = palace.decadal?.range;
	if (!range) return '-';
	return `${range[0]}-${range[1]}岁 ${palace.decadal.heavenlyStem}${palace.decadal.earthlyBranch}`;
}

function agesText(palace: IFunctionalPalace) {
	return palace.ages.length > 0 ? palace.ages.join('、') : '-';
}

function palaceFlags(palace: IFunctionalPalace) {
	return [
		palace.isBodyPalace ? '身宫' : undefined,
		palace.isOriginalPalace ? '来因宫' : undefined,
	].filter(Boolean).join('、') || '-';
}

function palaceLabel(astrolabe: IFunctionalAstrolabe, index: number) {
	const palace = astrolabe.palaces[index];
	if (!palace) return `第${index + 1}宫`;
	return `${palace.name}(${palace.heavenlyStem}${palace.earthlyBranch})`;
}

function scopeItem(horoscope: IFunctionalHoroscope, scope: ZiweiScope) {
	return horoscope[scope];
}

function ziweiFourTransforms(astrolabe: IFunctionalAstrolabe) {
	return astrolabe.palaces.flatMap((palace) =>
		palace.majorStars
			.filter((star) => star.mutagen)
			.map((star) => ({ palace: palace.name, star: star.name, transform: star.mutagen ?? '' })),
	);
}

function formatZiweiSummary(
	astrolabe: IFunctionalAstrolabe,
	datetime: string,
	calendar: ZiweiCalendar,
	profile: ZiweiProfile,
	timeIndex: number,
) {
	return joinSections([
		[
			`输入: ${datetime}`,
			`历法: ${calendar === 'solar' ? '公历' : '农历'}`,
			`流派: ${ziweiProfileLabels[profile]} (${profile})`,
			`时辰索引: ${timeIndex}`,
			`公历: ${astrolabe.solarDate}`,
			`农历: ${astrolabe.lunarDate}`,
			`干支: ${astrolabe.chineseDate}`,
		].join('\n'),
		mdTable(['命主', '身主', '五行局', '生肖', '星座', '命宫地支', '身宫地支'], [[
			astrolabe.soul,
			astrolabe.body,
			astrolabe.fiveElementsClass,
			astrolabe.zodiac,
			astrolabe.sign,
			astrolabe.earthlyBranchOfSoulPalace,
			astrolabe.earthlyBranchOfBodyPalace,
		]]),
	]);
}

function formatZiweiPalacesTable(astrolabe: IFunctionalAstrolabe) {
	return mdTable(
		['宫位', '干支', '标记', '主星', '辅星', '杂耀', '长生/博士/将前/岁前', '大限', '小限年龄'],
		astrolabe.palaces.map((palace) => [
			palace.name,
			`${palace.heavenlyStem}${palace.earthlyBranch}`,
			palaceFlags(palace),
			starListText(palace.majorStars),
			starListText(palace.minorStars),
			starListText(palace.adjectiveStars),
			`${palace.changsheng12}/${palace.boshi12}/${palace.jiangqian12}/${palace.suiqian12}`,
			decadalText(palace),
			agesText(palace),
		]),
	);
}

function formatZiweiTransformsTable(astrolabe: IFunctionalAstrolabe) {
	const transforms = ziweiFourTransforms(astrolabe);
	if (transforms.length === 0) return '四化: 未见主星四化。';
	return mdTable(
		['宫位', '星曜', '四化'],
		transforms.map((item) => [item.palace, item.star, item.transform]),
	);
}

function formatZiweiHoroscopeOverview(chart: ReturnType<typeof buildZiweiChart>, horoscope: IFunctionalHoroscope) {
	return mdTable(
		['层级', '干支', '所在原盘宫', '四化', '流耀提示'],
		ziweiScopes.map((scope) => {
			const item = scopeItem(horoscope, scope);
			return [
				scope === 'age' ? `${ziweiScopeLabels[scope]}(${horoscope.age.nominalAge}虚岁)` : ziweiScopeLabels[scope],
				horoscopeItemBranch(item),
				palaceLabel(chart.astrolabe, item.index),
				mutagenText(item),
				item.stars ? `有流耀宫位 ${item.stars.filter((stars) => stars.length > 0).length}/12` : '-',
			];
		}),
	);
}

function formatZiweiScopePalacesTable(
	astrolabe: IFunctionalAstrolabe,
	item: HoroscopeItem,
) {
	const headers = ['序', '运限宫位', '原盘宫位', '原盘干支', '原盘主星', '原盘辅星', '流耀'];
	const rows = astrolabe.palaces.map((palace, index) => {
		return [
			index + 1,
			item.palaceNames[index] ?? '-',
			palace.name,
			`${palace.heavenlyStem}${palace.earthlyBranch}`,
			starListText(palace.majorStars),
			starListText(palace.minorStars),
			horoscopeStarsText(item, index),
		];
	});
	return mdTable(headers, rows);
}

function formatZiweiScopeFocus(
	horoscope: IFunctionalHoroscope,
	scope: ZiweiScope,
	focusPalace: string,
) {
	if (scope === 'age') {
		const palace = horoscope.agePalace();
		if (!palace) return '小限宫位: -';
		return mdTable(['项目', '宫位', '干支', '主星', '辅星'], [[
			'小限',
			palace.name,
			`${palace.heavenlyStem}${palace.earthlyBranch}`,
			starListText(palace.majorStars),
			starListText(palace.minorStars),
		]]);
	}

	const runtimeScope = scope as ZiweiRuntimeScope;
	const target = horoscope.palace(focusPalace as never, runtimeScope);
	const surrounded = horoscope.surroundPalaces(focusPalace as never, runtimeScope);
	if (!target || !surrounded) {
		throw new Error(`Unknown focusPalace: ${focusPalace}`);
	}
	const rows = [
		['本宫', target],
		['对宫', surrounded.opposite],
		['财帛位', surrounded.wealth],
		['官禄位', surrounded.career],
	].map(([label, palace]) => {
		const item = palace as IFunctionalPalace | undefined;
		return [
			label,
			item?.name ?? '-',
			item ? `${item.heavenlyStem}${item.earthlyBranch}` : '-',
			item ? starListText(item.majorStars) : '-',
			item ? starListText(item.minorStars) : '-',
		];
	});
	return mdTable(['关系', '原盘宫位', '干支', '主星', '辅星'], rows);
}

function buildZiweiChart(
	datetime: string,
	gender: string,
	profileInput?: string,
	calendarInput?: string,
	isLeapMonth?: boolean,
	languageInput?: string,
) {
	const dt = parseDatetime(datetime);
	if (!dt) throw new Error('Invalid format. Use YYYY-MM-DD HH:MM');
	const profile = normalizeZiweiProfile(profileInput);
	const calendar = normalizeZiweiCalendar(calendarInput);
	const language = normalizeZiweiLanguage(languageInput);
	const option: ZiweiOption = {
		type: calendar,
		dateStr: ziweiDateString(dt),
		timeIndex: ziweiTimeIndex(dt),
		gender: toZiweiGender(gender),
		fixLeap: true,
		language,
		config: ziweiProfileConfig(profile),
		...(calendar === 'lunar' ? { isLeapMonth: isLeapMonth ?? false } : {}),
	};

	return {
		profile,
		calendar,
		option,
		astrolabe: astro.withOptions(option),
	};
}

function buildZiweiHoroscope(
	birthDatetime: string,
	gender: string,
	targetDatetime: string,
	profileInput?: string,
	calendarInput?: string,
	isLeapMonth?: boolean,
	languageInput?: string,
) {
	const target = parseDatetime(targetDatetime);
	if (!target) throw new Error('Invalid targetDatetime format. Use YYYY-MM-DD HH:MM');
	const chart = buildZiweiChart(birthDatetime, gender, profileInput, calendarInput, isLeapMonth, languageInput);
	const targetTimeIndex = ziweiTimeIndex(target);
	const horoscope = chart.astrolabe.horoscope(ziweiDateString(target), targetTimeIndex);
	return {
		...chart,
		target,
		targetDatetime,
		targetTimeIndex,
		horoscope,
	};
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

type PillarInfo = ReturnType<typeof pillarDetail>;
type CycleWithNayin = ReturnType<typeof sixtyCycleWithNayin>;

function hiddenStemsText(pillar: PillarInfo) {
	return pillar.hiddenStems.map(({ stem, tenGod }) => `${stem}(${tenGod})`).join(' ');
}

function cycleNayinText(item: CycleWithNayin) {
	return `${item.sixtyCycle}(${item.nayin})`;
}

function solarTimeMinuteText(t: SolarTime) {
	return `${t.getYear()}-${pad(t.getMonth())}-${pad(t.getDay())} ${pad(t.getHour())}:${pad(t.getMinute())}`;
}

function formatGanzhiResult(title: string, datetime: string, solar: string, lunar: string, eightChar: EightChar) {
	return joinSections([
		`${title}: ${datetime}\n公历: ${solar}\n农历: ${lunar}`,
		mdTable(['年柱', '月柱', '日柱', '时柱', '完整四柱'], [
			[
				eightChar.getYear().getName(),
				eightChar.getMonth().getName(),
				eightChar.getDay().getName(),
				eightChar.getHour().getName(),
				eightChar.toString(),
			],
		]),
	]);
}

function formatPillarsTable(fourPillars: Record<'year' | 'month' | 'day' | 'hour', PillarInfo>) {
	return mdTable(
		['柱', '干支', '十神', '天干', '地支', '藏干', '星运', '自坐', '空亡', '纳音'],
		[
			['年柱', fourPillars.year.pillar, fourPillars.year.tenGod, fourPillars.year.heavenStem, fourPillars.year.earthBranch, hiddenStemsText(fourPillars.year), fourPillars.year.terrain, fourPillars.year.selfSitting, fourPillars.year.kongwang.join(''), fourPillars.year.nayin],
			['月柱', fourPillars.month.pillar, fourPillars.month.tenGod, fourPillars.month.heavenStem, fourPillars.month.earthBranch, hiddenStemsText(fourPillars.month), fourPillars.month.terrain, fourPillars.month.selfSitting, fourPillars.month.kongwang.join(''), fourPillars.month.nayin],
			['日柱', fourPillars.day.pillar, fourPillars.day.tenGod, fourPillars.day.heavenStem, fourPillars.day.earthBranch, hiddenStemsText(fourPillars.day), fourPillars.day.terrain, fourPillars.day.selfSitting, fourPillars.day.kongwang.join(''), fourPillars.day.nayin],
			['时柱', fourPillars.hour.pillar, fourPillars.hour.tenGod, fourPillars.hour.heavenStem, fourPillars.hour.earthBranch, hiddenStemsText(fourPillars.hour), fourPillars.hour.terrain, fourPillars.hour.selfSitting, fourPillars.hour.kongwang.join(''), fourPillars.hour.nayin],
		],
	);
}

const pillarKeys = ['year', 'month', 'day', 'hour'] as const;
type PillarKey = typeof pillarKeys[number];

const pillarLabels: Record<PillarKey, string> = {
	year: '年柱',
	month: '月柱',
	day: '日柱',
	hour: '时柱',
};

function getPillarCycles(eightChar: EightChar): Record<PillarKey, SixtyCycle> {
	return {
		year: eightChar.getYear(),
		month: eightChar.getMonth(),
		day: eightChar.getDay(),
		hour: eightChar.getHour(),
	};
}

function formatCycleLabel(label: string, cycle: SixtyCycle) {
	return `${label}${cycle.getName()}`;
}

type TargetToken = { type: 'stem' | 'branch'; name: string };

interface ShenshaRow {
	name: string;
	basis: string;
	target: string;
	hits: string[];
}

const stemBranchShenshaRules: Array<{
	name: string;
	basis: Array<'yearStem' | 'dayStem'>;
	targets: Record<string, string[]>;
}> = [
	{
		name: '天乙贵人',
		basis: ['yearStem', 'dayStem'],
		targets: {
			甲: ['丑', '未'],
			戊: ['丑', '未'],
			庚: ['丑', '未'],
			乙: ['子', '申'],
			己: ['子', '申'],
			丙: ['亥', '酉'],
			丁: ['亥', '酉'],
			壬: ['卯', '巳'],
			癸: ['卯', '巳'],
			辛: ['寅', '午'],
		},
	},
	{
		name: '文昌贵人',
		basis: ['yearStem', 'dayStem'],
		targets: {
			甲: ['巳'],
			乙: ['午'],
			丙: ['申'],
			丁: ['酉'],
			戊: ['申'],
			己: ['酉'],
			庚: ['亥'],
			辛: ['子'],
			壬: ['寅'],
			癸: ['卯'],
		},
	},
	{
		name: '羊刃',
		basis: ['dayStem'],
		targets: {
			甲: ['卯'],
			乙: ['寅'],
			丙: ['午'],
			丁: ['巳'],
			戊: ['午'],
			己: ['巳'],
			庚: ['酉'],
			辛: ['申'],
			壬: ['子'],
			癸: ['亥'],
		},
	},
	{
		name: '禄神',
		basis: ['dayStem'],
		targets: {
			甲: ['寅'],
			乙: ['卯'],
			丙: ['巳'],
			丁: ['午'],
			戊: ['巳'],
			己: ['午'],
			庚: ['申'],
			辛: ['酉'],
			壬: ['亥'],
			癸: ['子'],
		},
	},
];

const branchGroupShenshaRules: Array<{
	name: string;
	basis: Array<'yearBranch' | 'dayBranch'>;
	targetsByGroup: Record<string, string>;
}> = [
	{ name: '桃花/咸池', basis: ['yearBranch', 'dayBranch'], targetsByGroup: { 申子辰: '酉', 寅午戌: '卯', 巳酉丑: '午', 亥卯未: '子' } },
	{ name: '驿马', basis: ['yearBranch', 'dayBranch'], targetsByGroup: { 申子辰: '寅', 寅午戌: '申', 巳酉丑: '亥', 亥卯未: '巳' } },
	{ name: '华盖', basis: ['yearBranch', 'dayBranch'], targetsByGroup: { 申子辰: '辰', 寅午戌: '戌', 巳酉丑: '丑', 亥卯未: '未' } },
	{ name: '劫煞', basis: ['yearBranch', 'dayBranch'], targetsByGroup: { 申子辰: '巳', 寅午戌: '亥', 巳酉丑: '寅', 亥卯未: '申' } },
	{ name: '将星', basis: ['yearBranch', 'dayBranch'], targetsByGroup: { 申子辰: '子', 寅午戌: '午', 巳酉丑: '酉', 亥卯未: '卯' } },
];

const monthBranchShenshaRules: Array<{
	name: string;
	targets: Record<string, TargetToken[]>;
}> = [
	{
		name: '天德贵人',
		targets: {
			寅: [{ type: 'stem', name: '丁' }],
			卯: [{ type: 'branch', name: '申' }],
			辰: [{ type: 'stem', name: '壬' }],
			巳: [{ type: 'stem', name: '辛' }],
			午: [{ type: 'branch', name: '亥' }],
			未: [{ type: 'stem', name: '甲' }],
			申: [{ type: 'stem', name: '癸' }],
			酉: [{ type: 'branch', name: '寅' }],
			戌: [{ type: 'stem', name: '丙' }],
			亥: [{ type: 'stem', name: '乙' }],
			子: [{ type: 'branch', name: '巳' }],
			丑: [{ type: 'stem', name: '庚' }],
		},
	},
	{
		name: '月德贵人',
		targets: {
			寅: [{ type: 'stem', name: '丙' }],
			午: [{ type: 'stem', name: '丙' }],
			戌: [{ type: 'stem', name: '丙' }],
			申: [{ type: 'stem', name: '壬' }],
			子: [{ type: 'stem', name: '壬' }],
			辰: [{ type: 'stem', name: '壬' }],
			亥: [{ type: 'stem', name: '甲' }],
			卯: [{ type: 'stem', name: '甲' }],
			未: [{ type: 'stem', name: '甲' }],
			巳: [{ type: 'stem', name: '庚' }],
			酉: [{ type: 'stem', name: '庚' }],
			丑: [{ type: 'stem', name: '庚' }],
		},
	},
];

function groupTarget(originBranch: string, targetsByGroup: Record<string, string>) {
	const group = Object.keys(targetsByGroup).find((item) => item.includes(originBranch));
	if (!group) return undefined;
	return targetsByGroup[group];
}

function targetText(targets: TargetToken[]) {
	const stems = targets.filter((target) => target.type === 'stem').map((target) => target.name);
	const branches = targets.filter((target) => target.type === 'branch').map((target) => target.name);
	return [
		stems.length > 0 ? `干:${stems.join('/')}` : undefined,
		branches.length > 0 ? `支:${branches.join('/')}` : undefined,
	].filter(Boolean).join(' ');
}

function matchTargets(pillars: Record<PillarKey, SixtyCycle>, targets: TargetToken[]) {
	const hits: string[] = [];
	for (const key of pillarKeys) {
		const cycle = pillars[key];
		const stemName = cycle.getHeavenStem().getName();
		const branchName = cycle.getEarthBranch().getName();
		const parts: string[] = [];
		for (const target of targets) {
			if (target.type === 'stem' && stemName === target.name) parts.push(`干${target.name}`);
			if (target.type === 'branch' && branchName === target.name) parts.push(`支${target.name}`);
		}
		if (parts.length > 0) hits.push(`${formatCycleLabel(pillarLabels[key], cycle)}(${parts.join('/')})`);
	}
	return hits;
}

function calculateShensha(eightChar: EightChar) {
	const pillars = getPillarCycles(eightChar);
	const rows: ShenshaRow[] = [];
	const basisValues = {
		yearStem: { label: '年干', value: eightChar.getYear().getHeavenStem().getName() },
		dayStem: { label: '日干', value: eightChar.getDay().getHeavenStem().getName() },
		yearBranch: { label: '年支', value: eightChar.getYear().getEarthBranch().getName() },
		dayBranch: { label: '日支', value: eightChar.getDay().getEarthBranch().getName() },
	};

	for (const rule of stemBranchShenshaRules) {
		for (const basis of rule.basis) {
			const basisValue = basisValues[basis];
			const targets = (rule.targets[basisValue.value] ?? []).map((name) => ({ type: 'branch' as const, name }));
			rows.push({
				name: rule.name,
				basis: `${basisValue.label}${basisValue.value}`,
				target: targetText(targets),
				hits: matchTargets(pillars, targets),
			});
		}
	}

	for (const rule of branchGroupShenshaRules) {
		for (const basis of rule.basis) {
			const basisValue = basisValues[basis];
			const target = groupTarget(basisValue.value, rule.targetsByGroup);
			const targets = target ? [{ type: 'branch' as const, name: target }] : [];
			rows.push({
				name: rule.name,
				basis: `${basisValue.label}${basisValue.value}`,
				target: targetText(targets),
				hits: matchTargets(pillars, targets),
			});
		}
	}

	const monthBranch = eightChar.getMonth().getEarthBranch().getName();
	for (const rule of monthBranchShenshaRules) {
		const targets = rule.targets[monthBranch] ?? [];
		rows.push({
			name: rule.name,
			basis: `月支${monthBranch}`,
			target: targetText(targets),
			hits: matchTargets(pillars, targets),
		});
	}

	return rows;
}

function formatShenshaTable(eightChar: EightChar, onlyHits = false) {
	const rows = calculateShensha(eightChar)
		.filter((row) => !onlyHits || row.hits.length > 0)
		.map((row) => [row.name, row.basis, row.target, row.hits.length > 0 ? row.hits.join('；') : '-']);
	if (rows.length === 0) return '命中神煞: 无';
	return mdTable(['神煞', '起法', '目标', '命中位置'], rows);
}

const branchOrder = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

function branchPairKey(a: string, b: string) {
	return [a, b].sort((left, right) => branchOrder.indexOf(left) - branchOrder.indexOf(right)).join('');
}

const punishmentPairs: Record<string, string> = {
	子卯: '无礼刑',
	寅巳: '无恩刑',
	寅申: '无恩刑',
	巳申: '无恩刑',
	丑未: '恃势刑',
	丑戌: '恃势刑',
	未戌: '恃势刑',
};

const breakPairs: Record<string, string> = {
	子酉: '破',
	丑辰: '破',
	寅亥: '破',
	卯午: '破',
	巳申: '破',
	未戌: '破',
};

const branchTripleCombos = [
	{ type: '三合', branches: ['申', '子', '辰'], element: '水' },
	{ type: '三合', branches: ['亥', '卯', '未'], element: '木' },
	{ type: '三合', branches: ['寅', '午', '戌'], element: '火' },
	{ type: '三合', branches: ['巳', '酉', '丑'], element: '金' },
	{ type: '三会', branches: ['寅', '卯', '辰'], element: '木' },
	{ type: '三会', branches: ['巳', '午', '未'], element: '火' },
	{ type: '三会', branches: ['申', '酉', '戌'], element: '金' },
	{ type: '三会', branches: ['亥', '子', '丑'], element: '水' },
];

function branchPairRelations(a: EarthBranch, b: EarthBranch) {
	const relations: string[] = [];
	const pairName = `${a.getName()}${b.getName()}`;
	const pairKey = branchPairKey(a.getName(), b.getName());
	const combine = a.combine(b);
	if (combine) relations.push(`六合${combine.getName()}(${pairName})`);
	if (a.getOpposite().equals(b)) relations.push(`六冲(${pairName})`);
	if (a.getHarm().equals(b)) relations.push(`六害(${pairName})`);
	if (punishmentPairs[pairKey]) relations.push(`${punishmentPairs[pairKey]}(${pairName})`);
	if (breakPairs[pairKey]) relations.push(`破(${pairName})`);
	return relations;
}

function formatRelationsTable(eightChar: EightChar) {
	const pillars = getPillarCycles(eightChar);
	const rows: string[][] = [];
	const branchMap = new Map<string, string[]>();

	for (let i = 0; i < pillarKeys.length; i++) {
		const leftKey = pillarKeys[i];
		const left = pillars[leftKey];
		const leftBranch = left.getEarthBranch();
		const branchName = leftBranch.getName();
		branchMap.set(branchName, [...(branchMap.get(branchName) ?? []), formatCycleLabel(pillarLabels[leftKey], left)]);

		for (let j = i + 1; j < pillarKeys.length; j++) {
			const rightKey = pillarKeys[j];
			const right = pillars[rightKey];
			const stemCombine = left.getHeavenStem().combine(right.getHeavenStem());
			if (stemCombine) {
				rows.push(['天干五合', `${formatCycleLabel(pillarLabels[leftKey], left)} 与 ${formatCycleLabel(pillarLabels[rightKey], right)}: ${left.getHeavenStem().getName()}${right.getHeavenStem().getName()}合${stemCombine.getName()}`]);
			}

			for (const relation of branchPairRelations(leftBranch, right.getEarthBranch())) {
				rows.push(['地支关系', `${formatCycleLabel(pillarLabels[leftKey], left)} 与 ${formatCycleLabel(pillarLabels[rightKey], right)}: ${relation}`]);
			}
		}
	}

	for (const [branchName, labels] of branchMap.entries()) {
		if (labels.length > 1 && ['辰', '午', '酉', '亥'].includes(branchName)) {
			rows.push(['地支自刑', `${labels.join('、')}: ${branchName}${branchName}自刑`]);
		}
	}

	for (const combo of branchTripleCombos) {
		if (combo.branches.every((branch) => branchMap.has(branch))) {
			const locations = combo.branches.map((branch) => `${branch}:${(branchMap.get(branch) ?? []).join('/')}`).join('；');
			rows.push([combo.type, `${combo.branches.join('')}成${combo.element}局（${locations}）`]);
		}
	}

	if (rows.length === 0) return '刑冲合害: 未见明显天干五合、六合、三合、三会、六冲、六害、相刑、破。';
	return mdTable(['类型', '关系'], rows);
}

function pairRelationSummary(left: SixtyCycle, right: SixtyCycle) {
	const relations: string[] = [];
	const stemCombine = left.getHeavenStem().combine(right.getHeavenStem());
	if (stemCombine) relations.push(`${left.getHeavenStem().getName()}${right.getHeavenStem().getName()}合${stemCombine.getName()}`);
	relations.push(...branchPairRelations(left.getEarthBranch(), right.getEarthBranch()));
	return relations.length > 0 ? relations.join('、') : '无';
}

function specialCycles(eightChar: EightChar) {
	return [
		{ label: '胎元', cycle: eightChar.getFetalOrigin() },
		{ label: '命宫', cycle: eightChar.getOwnSign() },
		{ label: '身宫', cycle: eightChar.getBodySign() },
	];
}

function formatSpecialCycleRelations(target: SixtyCycle, eightChar: EightChar) {
	return specialCycles(eightChar)
		.map((item) => `${item.label}${item.cycle.getName()}:${pairRelationSummary(item.cycle, target)}`)
		.join('；');
}

type ElementName = '木' | '火' | '土' | '金' | '水';
const elementNames: ElementName[] = ['木', '火', '土', '金', '水'];

function calculateElementScores(eightChar: EightChar) {
	const scores: Record<ElementName, number> = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
	const add = (name: string, value: number) => {
		scores[name as ElementName] += value;
	};

	for (const cycle of Object.values(getPillarCycles(eightChar))) {
		add(cycle.getHeavenStem().getElement().getName(), 1);
		const branch = cycle.getEarthBranch();
		add(branch.getElement().getName(), 1);
		add(branch.getHideHeavenStemMain().getElement().getName(), 0.6);
		const middle = branch.getHideHeavenStemMiddle();
		if (middle) add(middle.getElement().getName(), 0.3);
		const residual = branch.getHideHeavenStemResidual();
		if (residual) add(residual.getElement().getName(), 0.1);
	}

	return scores;
}

function formatElementScoresTable(eightChar: EightChar) {
	const scores = calculateElementScores(eightChar);
	const total = elementNames.reduce((sum, name) => sum + scores[name], 0);
	const dayElement = eightChar.getDay().getHeavenStem().getElement().getName();
	const rows = elementNames.map((name) => [
		name,
		scores[name].toFixed(1),
		`${((scores[name] / total) * 100).toFixed(1)}%`,
		name === dayElement ? '日主五行' : '',
	]);
	return joinSections([
		'计分: 天干=1，地支本五行=1，藏干本气/中气/余气=0.6/0.3/0.1',
		mdTable(['五行', '分数', '占比', '备注'], rows),
	]);
}

// ===== Tool Registration =====

function registerGanzhiTools(server: McpServer) {
	server.registerTool(
		'convert_to_ganzhi',
		{
			title: '公历转干支',
			description: '将公历日期时间转换为天干地支（四柱/八字）及农历日期。Convert Gregorian date-time to 天干地支 four pillars.',
			inputSchema: { datetime: z.string().describe('日期时间 YYYY-MM-DD HH:MM，如 "2024-01-15 08:30"') },
		},
		async ({ datetime }) => {
			try {
				const { solarDay, lunarDay, eightChar } = buildBaziContext(datetime);
				return textResult(formatGanzhiResult('输入', datetime, solarDay.toString(), lunarDay.toString(), eightChar));
			} catch (e) {
				return errResult(`转换错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'get_current_ganzhi',
		{
			title: '获取当前干支',
			description: '获取当前日期时间的天干地支（四柱/八字）。Get current date-time\'s 天干地支 four pillars.',
			inputSchema: {},
		},
		async () => {
			// Use UTC+8 (China Standard Time) instead of UTC
			const now = new Date(Date.now() + 8 * 3600_000);
			const datetime = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
			const { solarDay, lunarDay, eightChar } = buildBaziContext(datetime);
			return textResult(formatGanzhiResult('当前', datetime, solarDay.toString(), lunarDay.toString(), eightChar));
		},
	);
}

function registerBaziChartTool(server: McpServer) {
	server.registerTool(
		'get_bazi_chart',
		{
			title: '八字排盘',
			description: '八字命盘：获取四柱详情、农历、节气、神煞、刑冲合害、五行力量统计、胎元、胎息、命宫、身宫、起运时间、大运列表。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
				gender: z.string().describe('性别：男/女 或 male/female'),
			},
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
				const majorLuck: Array<{
					type?: string;
					sixtyCycle?: string;
					tenGod?: string;
					nayin?: string;
					startAge?: number;
					endAge?: number;
					startYear: number;
					endYear: number;
					ageRange: string;
				}> = [];

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

				return textResult(joinSections([
					`输入: ${datetime}\n公历: ${solarDay.toString()}\n农历: ${lunar}`,
					formatPillarsTable(fourPillars),
					joinSections(['命中神煞', formatShenshaTable(eightChar, true)]),
					joinSections(['刑冲合害关系', formatRelationsTable(eightChar)]),
					joinSections(['五行力量统计', formatElementScoresTable(eightChar)]),
					mdTable(['节气', '时间'], [
						[`当前${solarTerms.current.name}`, solarTerms.current.time],
						[`下个${solarTerms.next.name}`, solarTerms.next.time],
					]),
					mdTable(['胎元', '胎息', '命宫', '身宫'], [[
						cycleNayinText(fetalOrigin),
						cycleNayinText(fetalBreath),
						cycleNayinText(lifePalace),
						cycleNayinText(bodyPalace),
					]]),
					`起运: ${startLuck.description}\n起运日期: ${startLuck.startDate}`,
					mdTable(
						['运', '干支', '十神', '纳音', '年龄', '年份'],
						majorLuck.map((luck, index) => [
							luck.type ?? `第${index}步`,
							luck.sixtyCycle,
							luck.tenGod,
							luck.nayin,
							luck.ageRange,
							`${luck.startYear}-${luck.endYear}`,
						]),
					),
				]));
			} catch (e) {
				return errResult(`八字命盘错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerBaziShenshaTool(server: McpServer) {
	server.registerTool(
		'get_bazi_shensha',
		{
			title: '八字神煞',
			description: '按年干/日干、年支/日支、月支起常用八字神煞，输出天乙贵人、文昌、羊刃、禄神、桃花、驿马、华盖、劫煞、将星、天德、月德等命中位置。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
			},
		},
		async ({ datetime }) => {
			try {
				const { solarDay, lunarDay, eightChar } = buildBaziContext(datetime);
				return textResult(joinSections([
					`输入: ${datetime}\n公历: ${solarDay.toString()}\n农历: ${lunarDay.toString()}\n四柱: ${eightChar.toString()}`,
					formatShenshaTable(eightChar),
				]));
			} catch (e) {
				return errResult(`八字神煞错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerBaziFortuneTool(server: McpServer) {
	server.registerTool(
		'get_bazi_fortune',
		{
			title: '推算大运流年',
			description: '八字小运与流年：输入出生信息和年份范围，获取每年的大运、小运、流年、十神，以及流年与胎元/命宫/身宫的刑冲合害关系。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
				gender: z.string().describe('性别：男/女 或 male/female'),
				startYear: z.number().describe('起始年份（公历年份）'),
				count: z.number().optional().default(10).describe('查询年数，默认10'),
			},
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
				const results: Array<{
					year: number;
					age: number;
					daYun: { sixtyCycle: string; tenGod: string } | null;
					xiaoYun: { sixtyCycle: string; tenGod: string };
					liuNian: { sixtyCycle: string; tenGod: string };
					specialRelations: string;
				}> = [];

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
						specialRelations: formatSpecialCycleRelations(yearSc, eightChar),
					});

					fortune = fortune.next(1);
				}

				return textResult(joinSections([
					`出生年: ${birthYear}\n日主: ${dayMaster.getName()}\n查询: ${startYear}起 ${count}年`,
					mdTable(
						['年份', '年龄', '大运', '小运', '流年'],
						results.map((item) => [
							item.year,
							`${item.age}岁`,
							item.daYun ? `${item.daYun.sixtyCycle}(${item.daYun.tenGod})` : '-',
							`${item.xiaoYun.sixtyCycle}(${item.xiaoYun.tenGod})`,
							`${item.liuNian.sixtyCycle}(${item.liuNian.tenGod})`,
						]),
					),
					mdTable(
						['年份', '流年', '胎元/命宫/身宫流年关系'],
						results.map((item) => [item.year, item.liuNian.sixtyCycle, item.specialRelations]),
					),
				]));
			} catch (e) {
				return errResult(`小运流年错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerFlowMonthTool(server: McpServer) {
	server.registerTool(
		'get_bazi_flow_month',
		{
			title: '流月排盘',
			description: '八字流月：输入出生日期和指定年份，获取该年12个月的干支及十神（流月）。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
				year: z.number().describe('查询年份（公历年份）'),
			},
		},
		async ({ datetime, year }) => {
			try {
				const { eightChar, dayMaster } = buildBaziContext(datetime);
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
						specialRelations: formatSpecialCycleRelations(sc, eightChar),
					};
				});

				return textResult(joinSections([
					`年份: ${year} ${yearSc.getName()}\n日主: ${dayMaster.getName()}`,
					mdTable(
						['流月', '公历范围', '干支', '十神', '纳音'],
						flowMonths.map((item) => [
							item.monthName,
							item.solarDateRange,
							item.sixtyCycle,
							item.tenGod,
							item.nayin,
						]),
					),
					mdTable(
						['流月', '干支', '胎元/命宫/身宫关系'],
						flowMonths.map((item) => [item.monthName, item.sixtyCycle, item.specialRelations]),
					),
				]));
			} catch (e) {
				return errResult(`流月错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerFlowDayTool(server: McpServer) {
	server.registerTool(
		'get_bazi_flow_day',
		{
			title: '流日排盘',
			description: '八字流日：输入出生日期和指定年月，获取该月每日的干支及十神（流日）。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
				year: z.number().describe('查询年份（公历年份）'),
				month: z.number().describe('查询月份（公历月份 1-12）'),
			},
		},
		async ({ datetime, year, month }) => {
			try {
				const { dayMaster } = buildBaziContext(datetime);

				// Determine days in the Gregorian month
				const daysInMonth = new Date(year, month, 0).getDate();
				const flowDays: Array<{
					date: string;
					sixtyCycle: string;
					tenGod: string;
					nayin: string;
				}> = [];

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

				return textResult(joinSections([
					`月份: ${year}-${pad(month)}\n日主: ${dayMaster.getName()}`,
					mdTable(
						['日期', '干支', '十神', '纳音'],
						flowDays.map((item) => [item.date, item.sixtyCycle, item.tenGod, item.nayin]),
					),
				]));
			} catch (e) {
				return errResult(`流日错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerFlowHourTool(server: McpServer) {
	server.registerTool(
		'get_bazi_flow_hour',
		{
			title: '流时排盘',
			description: '八字流时：输入出生日期和指定公历日期，获取当日12时辰的干支、十神、纳音、黄道十二神、九星与时辰宜忌。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
				date: z.string().describe('查询日期 YYYY-MM-DD，如 "2024-01-15"'),
			},
		},
		async ({ datetime, date }) => {
			try {
				const target = parseDate(date);
				if (!target) throw new Error('Invalid date format. Use YYYY-MM-DD');
				const { dayMaster } = buildBaziContext(datetime);
				const solarDay = SolarDay.fromYmd(target.year, target.month, target.day);
				const flowDay = SixtyCycleDay.fromSolarDay(solarDay);
				const daySc = flowDay.getSixtyCycle();
				const hours = flowDay.getHours().map((hour) => {
					const sc = hour.getSixtyCycle();
					const start = hour.getSolarTime();
					const end = hour.next(7199).getSolarTime();
					return {
						timeRange: `${solarTimeMinuteText(start)} ~ ${solarTimeMinuteText(end)}`,
						hourName: `${sc.getEarthBranch().getName()}时`,
						sixtyCycle: sc.getName(),
						tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
						nayin: sc.getSound().getName(),
						twelveStar: hour.getTwelveStar().getName(),
						nineStar: hour.getNineStar().toString(),
						recommends: hour.getRecommends().map((item) => item.getName()).join('、'),
						avoids: hour.getAvoids().map((item) => item.getName()).join('、'),
					};
				});

				return textResult(joinSections([
					`日期: ${date}\n流日: ${daySc.getName()}(${dayMaster.getTenStar(daySc.getHeavenStem()).getName()})\n日主: ${dayMaster.getName()}`,
					mdTable(
						['时间范围', '时辰', '干支', '十神', '纳音', '十二神', '九星', '宜', '忌'],
						hours.map((item) => [
							item.timeRange,
							item.hourName,
							item.sixtyCycle,
							item.tenGod,
							item.nayin,
							item.twelveStar,
							item.nineStar,
							item.recommends,
							item.avoids,
						]),
					),
				]));
			} catch (e) {
				return errResult(`流时错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerZiweiChartTool(server: McpServer) {
	server.registerTool(
		'get_ziwei_chart',
		{
			title: '紫微斗数排盘',
			description: '紫微斗数本命盘：输出命主身主、五行局、十二宫主辅杂曜、大限、小限年龄与生年四化。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM；calendar=lunar 时日期部分按农历解释'),
				gender: z.string().describe('性别：男/女 或 male/female'),
				profile: z.enum(ziweiProfiles).optional().default('sanhe').describe('排盘配置：sanhe（三合）或 feixing-sihua（飞星四化）'),
				calendar: z.enum(['solar', 'lunar']).optional().default('solar').describe('输入日期历法：solar=公历，lunar=农历'),
				isLeapMonth: z.boolean().optional().default(false).describe('calendar=lunar 时是否为农历闰月'),
				language: z.enum(ziweiLanguages).optional().default('zh-CN').describe('输出语言，默认 zh-CN'),
			},
		},
		async ({ datetime, gender, profile, calendar, isLeapMonth, language }) => {
			try {
				const chart = buildZiweiChart(datetime, gender, profile, calendar, isLeapMonth, language);
				return textResult(joinSections([
					'紫微斗数排盘',
					formatZiweiSummary(chart.astrolabe, datetime, chart.calendar, chart.profile, chart.option.timeIndex),
					joinSections(['十二宫星曜', formatZiweiPalacesTable(chart.astrolabe)]),
					joinSections(['生年四化', formatZiweiTransformsTable(chart.astrolabe)]),
					'说明: 本命盘固定输出完整十二宫信息；需要流年/月/日/时用 get_ziwei_horoscope，总览后再用 get_ziwei_scope_detail 深入单层运限。',
				]));
			} catch (e) {
				return errResult(`紫微斗数排盘错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerZiweiHoroscopeTool(server: McpServer) {
	server.registerTool(
		'get_ziwei_horoscope',
		{
			title: '紫微运限总览',
			description: '紫微斗数运限：输入出生信息和目标时间，紧凑输出大限、小限、流年、流月、流日、流时的宫位、干支、四化和流耀数量提示。',
			inputSchema: {
				birthDatetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM；calendar=lunar 时日期部分按农历解释'),
				gender: z.string().describe('性别：男/女 或 male/female'),
				targetDatetime: z.string().describe('目标日期时间 YYYY-MM-DD HH:MM，用于推大限/小限/流年/流月/流日/流时'),
				profile: z.enum(ziweiProfiles).optional().default('sanhe').describe('排盘配置：sanhe（三合）或 feixing-sihua（飞星四化）'),
				calendar: z.enum(['solar', 'lunar']).optional().default('solar').describe('出生日期历法：solar=公历，lunar=农历'),
				isLeapMonth: z.boolean().optional().default(false).describe('calendar=lunar 时出生日期是否为农历闰月'),
				language: z.enum(ziweiLanguages).optional().default('zh-CN').describe('输出语言，默认 zh-CN'),
			},
		},
		async ({ birthDatetime, gender, targetDatetime, profile, calendar, isLeapMonth, language }) => {
			try {
				const ctx = buildZiweiHoroscope(birthDatetime, gender, targetDatetime, profile, calendar, isLeapMonth, language);
				return textResult(joinSections([
					'紫微运限总览',
					`出生: ${birthDatetime} (${ctx.calendar === 'solar' ? '公历' : '农历'})\n目标: ${targetDatetime}\n目标公历: ${ctx.horoscope.solarDate}\n目标农历: ${ctx.horoscope.lunarDate}\n流派: ${ziweiProfileLabels[ctx.profile]} (${ctx.profile})\n目标时辰索引: ${ctx.targetTimeIndex}`,
					formatZiweiHoroscopeOverview(ctx, ctx.horoscope),
					'使用建议: 这个工具只给总览。若要展开某一层的十二宫映射和流耀，继续调用 get_ziwei_scope_detail，并指定 scope=decadal/yearly/monthly/daily/hourly/age。',
				]));
			} catch (e) {
				return errResult(`紫微运限错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerZiweiScopeDetailTool(server: McpServer) {
	server.registerTool(
		'get_ziwei_scope_detail',
		{
			title: '紫微单层运限详盘',
			description: '紫微斗数单层运限详盘：只展开一个层级的大限/小限/流年/流月/流日/流时，避免一次返回全部运限导致上下文过大。',
			inputSchema: {
				birthDatetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM；calendar=lunar 时日期部分按农历解释'),
				gender: z.string().describe('性别：男/女 或 male/female'),
				targetDatetime: z.string().describe('目标日期时间 YYYY-MM-DD HH:MM'),
				scope: z.enum(ziweiScopes).describe('要展开的层级：decadal/age/yearly/monthly/daily/hourly'),
				focusPalace: z.string().optional().default('命宫').describe('重点宫位，默认命宫；仅 decadal/yearly/monthly/daily/hourly 用于三方四正'),
				profile: z.enum(ziweiProfiles).optional().default('sanhe').describe('排盘配置：sanhe（三合）或 feixing-sihua（飞星四化）'),
				calendar: z.enum(['solar', 'lunar']).optional().default('solar').describe('出生日期历法：solar=公历，lunar=农历'),
				isLeapMonth: z.boolean().optional().default(false).describe('calendar=lunar 时出生日期是否为农历闰月'),
				language: z.enum(ziweiLanguages).optional().default('zh-CN').describe('输出语言，默认 zh-CN'),
			},
		},
		async ({ birthDatetime, gender, targetDatetime, scope, focusPalace, profile, calendar, isLeapMonth, language }) => {
			try {
				const ctx = buildZiweiHoroscope(birthDatetime, gender, targetDatetime, profile, calendar, isLeapMonth, language);
				const normalizedScope = normalizeZiweiScope(scope);
				const item = scopeItem(ctx.horoscope, normalizedScope);
				return textResult(joinSections([
					`${ziweiScopeLabels[normalizedScope]}详盘`,
					`出生: ${birthDatetime}\n目标: ${targetDatetime}\n目标公历: ${ctx.horoscope.solarDate}\n目标农历: ${ctx.horoscope.lunarDate}\n流派: ${ziweiProfileLabels[ctx.profile]} (${ctx.profile})`,
					mdTable(['层级', '干支', '所在原盘宫', '四化', '虚岁'], [[
						ziweiScopeLabels[normalizedScope],
						horoscopeItemBranch(item),
						palaceLabel(ctx.astrolabe, item.index),
						mutagenText(item),
						normalizedScope === 'age' ? `${ctx.horoscope.age.nominalAge}虚岁` : '-',
					]]),
					joinSections([`${ziweiScopeLabels[normalizedScope]}十二宫映射`, formatZiweiScopePalacesTable(ctx.astrolabe, item)]),
					joinSections([normalizedScope === 'age' ? '小限宫位' : `${focusPalace}三方四正`, formatZiweiScopeFocus(ctx.horoscope, normalizedScope, focusPalace)]),
				]));
			} catch (e) {
				return errResult(`紫微单层运限错误: ${e instanceof Error ? e.message : String(e)}`);
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
	registerBaziShenshaTool(server);
	registerBaziFortuneTool(server);
	registerFlowMonthTool(server);
	registerFlowDayTool(server);
	registerFlowHourTool(server);
	registerZiweiChartTool(server);
	registerZiweiHoroscopeTool(server);
	registerZiweiScopeDetailTool(server);

	return server;
}

// ===== Export =====

const allTools = [
	{ name: 'convert_to_ganzhi', title: '公历转干支' },
	{ name: 'get_current_ganzhi', title: '获取当前干支' },
	{ name: 'get_bazi_chart', title: '八字排盘' },
	{ name: 'get_bazi_shensha', title: '八字神煞' },
	{ name: 'get_bazi_fortune', title: '推算大运流年' },
	{ name: 'get_bazi_flow_month', title: '流月排盘' },
	{ name: 'get_bazi_flow_day', title: '流日排盘' },
	{ name: 'get_bazi_flow_hour', title: '流时排盘' },
	{ name: 'get_ziwei_chart', title: '紫微斗数排盘' },
	{ name: 'get_ziwei_horoscope', title: '紫微运限总览' },
	{ name: 'get_ziwei_scope_detail', title: '紫微单层运限详盘' },
];

function serverInfoText() {
	return joinSections([
		'Lunar Calendar MCP Server',
		'农历/公历转换、天干地支、八字命盘、大运小运流年流月流日流时、神煞、刑冲合害、五行统计、紫微斗数排盘与运限',
		'MCP endpoint: /lunar',
		mdTable(['Tool', 'Title'], allTools.map((tool) => [tool.name, tool.title])),
	]);
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/lunar') {
			const server = createServer();
			return createMcpHandler(server, { route: '/lunar' })(request, env, ctx);
		}

		return new Response(serverInfoText(), {
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	},
} satisfies ExportedHandler<Env>;
