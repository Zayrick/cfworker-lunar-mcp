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
	SixtyCycleMonth,
	SixtyCycleDay,
	SixtyCycleHour,
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
	const value = g.trim().toLowerCase();
	if (value === '男' || value === 'male' || value === 'm') return Gender.MAN;
	if (value === '女' || value === 'female' || value === 'f') return Gender.WOMAN;
	throw new Error('Invalid gender. Use 男/女 or male/female.');
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
		['序', '宫位', '干支', '标记', '空宫', '主星', '辅星', '杂耀', '长生/博士/将前/岁前', '大限', '小限年龄'],
		astrolabe.palaces.map((palace) => [
			palace.index + 1,
			palace.name,
			`${palace.heavenlyStem}${palace.earthlyBranch}`,
			palaceFlags(palace),
			palace.isEmpty() ? '是' : '否',
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
	const targetSolarTime = SolarTime.fromYmdHms(target.year, target.month, target.day, target.hour, target.minute, 0);
	const horoscope = chart.astrolabe.horoscope(ziweiDateString(target), targetTimeIndex);
	return {
		...chart,
		target,
		targetDatetime,
		targetTimeIndex,
		targetSolarTime,
		horoscope,
	};
}

function ziweiScopeSolarRange(scope: ZiweiScope, targetSolarTime: SolarTime) {
	const hour = targetSolarTime.getSixtyCycleHour();
	const day = hour.getSixtyCycleDay();
	const month = day.getSixtyCycleMonth();
	if (scope === 'yearly') return sixtyCycleYearSolarRange(month.getSixtyCycleYear());
	if (scope === 'monthly') return sixtyCycleMonthSolarRange(month);
	if (scope === 'daily') return sixtyCycleDaySolarRange(day);
	if (scope === 'hourly') return sixtyCycleHourSolarRange(hour);
	return '-';
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

function solarTimeSecondText(t: SolarTime) {
	return `${solarTimeMinuteText(t)}:${pad(t.getSecond())}`;
}

function solarRangeText(start: SolarTime, end: SolarTime) {
	return `${solarTimeSecondText(start)} 至 ${solarTimeSecondText(end)}`;
}

function sixtyCycleMonthStartTime(month: SixtyCycleMonth) {
	return SolarTerm
		.fromIndex(month.getSixtyCycleYear().getYear(), 3 + month.getIndexInYear() * 2)
		.getJulianDay()
		.getSolarTime();
}

function sixtyCycleYearSolarRange(year: SixtyCycleYear) {
	const start = sixtyCycleMonthStartTime(year.getFirstMonth());
	const end = sixtyCycleMonthStartTime(year.next(1).getFirstMonth()).next(-1);
	return solarRangeText(start, end);
}

function sixtyCycleMonthSolarRange(month: SixtyCycleMonth) {
	const start = sixtyCycleMonthStartTime(month);
	const end = sixtyCycleMonthStartTime(month.next(1)).next(-1);
	return solarRangeText(start, end);
}

function sixtyCycleDaySolarRange(day: SixtyCycleDay) {
	const hours = day.getHours();
	if (hours.length === 0) return '-';
	const start = hours[0].getSolarTime();
	const end = hours[hours.length - 1].getSolarTime().next(7199);
	return solarRangeText(start, end);
}

function startOfSixtyCycleHour(solarTime: SolarTime) {
	const hour = solarTime.getHour();
	if (hour === 0) {
		return SolarTime
			.fromYmdHms(solarTime.getYear(), solarTime.getMonth(), solarTime.getDay(), 0, 0, 0)
			.next(-3600);
	}
	const startHour = hour === 23 ? 23 : Math.floor((hour + 1) / 2) * 2 - 1;
	return SolarTime.fromYmdHms(solarTime.getYear(), solarTime.getMonth(), solarTime.getDay(), startHour, 0, 0);
}

function sixtyCycleHourSolarRange(hour: SixtyCycleHour) {
	const start = startOfSixtyCycleHour(hour.getSolarTime());
	return solarRangeText(start, start.next(7199));
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

const baziPeriodScopes = ['year', 'month', 'day', 'hour'] as const;
type BaziPeriodScope = typeof baziPeriodScopes[number];

const ziweiTopics = ['self', 'career', 'wealth', 'relationship', 'health', 'family'] as const;
type ZiweiTopic = typeof ziweiTopics[number];

const mutagenNames = ['禄', '权', '科', '忌'] as const;

function normalizeBaziPeriodScope(scope: string): BaziPeriodScope {
	if (isOneOf(scope, baziPeriodScopes)) return scope;
	throw new Error('Unsupported scope. Use year, month, day, or hour.');
}

function normalizeZiweiTopic(topic: string): ZiweiTopic {
	if (isOneOf(topic, ziweiTopics)) return topic;
	throw new Error('Unsupported topic. Use self, career, wealth, relationship, health, or family.');
}

function buildFourPillars(eightChar: EightChar, dayMaster: HeavenStem) {
	return {
		year: pillarDetail(eightChar.getYear(), dayMaster, false),
		month: pillarDetail(eightChar.getMonth(), dayMaster, false),
		day: pillarDetail(eightChar.getDay(), dayMaster, true),
		hour: pillarDetail(eightChar.getHour(), dayMaster, false),
	};
}

function pillarRecord(label: string, info: PillarInfo) {
	return {
		label,
		pillar: info.pillar,
		tenGod: info.tenGod,
		heavenStem: info.heavenStem,
		earthBranch: info.earthBranch,
		hiddenStems: info.hiddenStems,
		terrain: info.terrain,
		selfSitting: info.selfSitting,
		kongwang: info.kongwang,
		nayin: info.nayin,
	};
}

function pillarRecords(fourPillars: Record<PillarKey, PillarInfo>) {
	return pillarKeys.map((key) => pillarRecord(pillarLabels[key], fourPillars[key]));
}

function buildMajorLuck(childLimit: ChildLimit, birthYear: number, dayMaster: HeavenStem) {
	const majorLuck: Array<{
		type: string;
		sixtyCycle?: string;
		tenGod?: string;
		nayin?: string;
		startAge: number;
		endAge: number;
		startYear: number;
		endYear: number;
		ageRange: string;
	}> = [{
		type: '童限',
		startAge: childLimit.getStartAge(),
		endAge: childLimit.getEndAge(),
		startYear: birthYear + childLimit.getStartAge() - 1,
		endYear: birthYear + childLimit.getEndAge(),
		ageRange: `${childLimit.getStartAge()}-${childLimit.getEndAge()}岁`,
	}];

	let decade = childLimit.getStartDecadeFortune();
	for (let i = 0; i < 10; i++) {
		const sc = decade.getSixtyCycle();
		majorLuck.push({
			type: `第${i + 1}步大运`,
			sixtyCycle: sc.getName(),
			tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
			nayin: sc.getSound().getName(),
			startAge: decade.getStartAge(),
			endAge: decade.getEndAge(),
			startYear: birthYear + decade.getStartAge() - 1,
			endYear: birthYear + decade.getEndAge() - 1,
			ageRange: `${decade.getStartAge()}-${decade.getEndAge()}岁`,
		});
		decade = decade.next(1);
	}

	return majorLuck;
}

function buildBaziChartData(datetime: string, gender: string) {
	const ctx = buildBaziContext(datetime);
	const { dt, solarTime, solarDay, lunarDay, eightChar, dayMaster } = ctx;
	const g = toGender(gender);
	const fourPillars = buildFourPillars(eightChar, dayMaster);
	const solarTerms = findBracketingJie(dt.year, dt.month, dt.day, dt.hour, dt.minute);
	const childLimit = ChildLimit.fromSolarTime(solarTime, g);
	const endTime = childLimit.getEndTime();
	const startLuck = {
		description: `${childLimit.getYearCount()}年${childLimit.getMonthCount()}个月${childLimit.getDayCount()}天${childLimit.getHourCount()}时${childLimit.getMinuteCount()}分后起运`,
		startDate: `公历${endTime.getYear()}年${endTime.getMonth()}月${endTime.getDay()}日 ${pad(endTime.getHour())}:${pad(endTime.getMinute())}:${pad(endTime.getSecond())}`,
		isForward: childLimit.isForward(),
		years: childLimit.getYearCount(),
		months: childLimit.getMonthCount(),
		days: childLimit.getDayCount(),
		hours: childLimit.getHourCount(),
		minutes: childLimit.getMinuteCount(),
	};

	return {
		ctx,
		input: { datetime, gender },
		solar: solarDay.toString(),
		lunar: `${lunarDay.toString()} ${eightChar.getHour().getName()}时`,
		dayMaster: dayMaster.getName(),
		fourPillars,
		pillars: pillarRecords(fourPillars),
		solarTerms,
		specialCycles: {
			fetalOrigin: sixtyCycleWithNayin(eightChar.getFetalOrigin()),
			fetalBreath: sixtyCycleWithNayin(eightChar.getFetalBreath()),
			lifePalace: sixtyCycleWithNayin(eightChar.getOwnSign()),
			bodyPalace: sixtyCycleWithNayin(eightChar.getBodySign()),
		},
		startLuck,
		majorLuck: buildMajorLuck(childLimit, dt.year, dayMaster),
	};
}

function formatBaziChartMarkdown(data: ReturnType<typeof buildBaziChartData>) {
	return joinSections([
		'八字本命基础盘',
		`输入: ${data.input.datetime}\n公历: ${data.solar}\n农历: ${data.lunar}\n日主: ${data.dayMaster}`,
		formatPillarsTable(data.fourPillars),
		mdTable(['节气', '时间'], [
			[`当前${data.solarTerms.current.name}`, data.solarTerms.current.time],
			[`下个${data.solarTerms.next.name}`, data.solarTerms.next.time],
		]),
		mdTable(['胎元', '胎息', '命宫', '身宫'], [[
			cycleNayinText(data.specialCycles.fetalOrigin),
			cycleNayinText(data.specialCycles.fetalBreath),
			cycleNayinText(data.specialCycles.lifePalace),
			cycleNayinText(data.specialCycles.bodyPalace),
		]]),
		`起运: ${data.startLuck.description}\n起运日期: ${data.startLuck.startDate}\n顺逆: ${data.startLuck.isForward ? '顺行' : '逆行'}`,
		mdTable(
			['运', '干支', '十神', '纳音', '年龄', '年份'],
			data.majorLuck.map((luck) => [
				luck.type,
				luck.sixtyCycle,
				luck.tenGod,
				luck.nayin,
				luck.ageRange,
				`${luck.startYear}-${luck.endYear}`,
			]),
		),
		'边界: 此工具只提供本命基础盘。判断旺衰取用请继续调用 bazi_structure；看阶段触发请调用 bazi_timeline 或 bazi_period_detail。',
	]);
}

function calculateRelationRows(eightChar: EightChar) {
	const pillars = getPillarCycles(eightChar);
	const rows: Array<{ type: string; relation: string }> = [];
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
				rows.push({
					type: '天干五合',
					relation: `${formatCycleLabel(pillarLabels[leftKey], left)} 与 ${formatCycleLabel(pillarLabels[rightKey], right)}: ${left.getHeavenStem().getName()}${right.getHeavenStem().getName()}合${stemCombine.getName()}`,
				});
			}

			for (const relation of branchPairRelations(leftBranch, right.getEarthBranch())) {
				rows.push({
					type: '地支关系',
					relation: `${formatCycleLabel(pillarLabels[leftKey], left)} 与 ${formatCycleLabel(pillarLabels[rightKey], right)}: ${relation}`,
				});
			}
		}
	}

	for (const [branchName, labels] of branchMap.entries()) {
		if (labels.length > 1 && ['辰', '午', '酉', '亥'].includes(branchName)) {
			rows.push({ type: '地支自刑', relation: `${labels.join('、')}: ${branchName}${branchName}自刑` });
		}
	}

	for (const combo of branchTripleCombos) {
		if (combo.branches.every((branch) => branchMap.has(branch))) {
			const locations = combo.branches.map((branch) => `${branch}:${(branchMap.get(branch) ?? []).join('/')}`).join('；');
			rows.push({ type: combo.type, relation: `${combo.branches.join('')}成${combo.element}局（${locations}）` });
		}
	}

	return rows;
}

function relationRowsMarkdown(rows: Array<{ type: string; relation: string }>) {
	if (rows.length === 0) return '刑冲合害: 未见明显天干五合、六合、三合、三会、六冲、六害、相刑、破。';
	return mdTable(['类型', '关系'], rows.map((row) => [row.type, row.relation]));
}

function collectTenGodDistribution(fourPillars: Record<PillarKey, PillarInfo>) {
	const counts = new Map<string, number>();
	const add = (tenGod: string, value = 1) => counts.set(tenGod, (counts.get(tenGod) ?? 0) + value);
	for (const key of pillarKeys) {
		add(fourPillars[key].tenGod);
		for (const hidden of fourPillars[key].hiddenStems) add(hidden.tenGod, 0.5);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([tenGod, score]) => ({ tenGod, score: Number(score.toFixed(1)) }));
}

function collectRootEvidence(fourPillars: Record<PillarKey, PillarInfo>, dayMaster: HeavenStem) {
	const dayElement = dayMaster.getElement().getName();
	return pillarKeys.map((key) => {
		const hiddenMatches = fourPillars[key].hiddenStems.filter((hidden) => {
			const stem = HeavenStem.fromName(hidden.stem);
			return stem.getElement().getName() === dayElement;
		});
		return {
			pillar: pillarLabels[key],
			branch: fourPillars[key].earthBranch,
			matches: hiddenMatches,
			hasSameElementRoot: hiddenMatches.length > 0,
			hasExactRoot: hiddenMatches.some((hidden) => hidden.stem === dayMaster.getName()),
		};
	});
}

function seasonHint(branch: string) {
	if (['寅', '卯', '辰'].includes(branch)) return '春令木气，需结合透干、通根、寒暖燥湿继续判断。';
	if (['巳', '午', '未'].includes(branch)) return '夏令火气，需结合燥热、调候与泄耗继续判断。';
	if (['申', '酉', '戌'].includes(branch)) return '秋令金气，需结合肃杀、通关与扶抑继续判断。';
	return '冬令水气，需结合寒湿、调候与通根继续判断。';
}

function buildBaziStructureData(datetime: string, gender: string) {
	const chart = buildBaziChartData(datetime, gender);
	const { eightChar, dayMaster } = chart.ctx;
	const scores = calculateElementScores(eightChar);
	const totalScore = elementNames.reduce((sum, name) => sum + scores[name], 0);
	const relations = calculateRelationRows(eightChar);
	const monthBranch = eightChar.getMonth().getEarthBranch();
	const checkpoints = [
		{ item: '月令', evidence: `月支${monthBranch.getName()}，${seasonHint(monthBranch.getName())}` },
		{ item: '通根', evidence: '查看四支藏干中是否有日主同五行或同干根气。' },
		{ item: '透干', evidence: '查看年月时天干十神是否帮扶、耗泄、克制或生扶日主。' },
		{ item: '组合', evidence: relations.length > 0 ? '原局存在合冲刑害触发点，需看位置与远近。' : '原局未见明显合冲刑害触发点。' },
		{ item: '取用边界', evidence: '此工具只给证据，不直接判定身强身弱、格局、用神或忌神。' },
	];

	return {
		chart,
		monthCommand: {
			branch: monthBranch.getName(),
			element: monthBranch.getElement().getName(),
			hint: seasonHint(monthBranch.getName()),
		},
		elementScores: elementNames.map((name) => ({
			element: name,
			score: Number(scores[name].toFixed(1)),
			percent: Number(((scores[name] / totalScore) * 100).toFixed(1)),
			isDayMasterElement: name === dayMaster.getElement().getName(),
		})),
		tenGodDistribution: collectTenGodDistribution(chart.fourPillars),
		rootEvidence: collectRootEvidence(chart.fourPillars, dayMaster),
		visibleStemEvidence: pillarKeys
			.filter((key) => key !== 'day')
			.map((key) => ({
				pillar: pillarLabels[key],
				stem: chart.fourPillars[key].heavenStem,
				tenGod: chart.fourPillars[key].tenGod,
			})),
		relations,
		checkpoints,
	};
}

function formatBaziStructureMarkdown(data: ReturnType<typeof buildBaziStructureData>) {
	return joinSections([
		'八字命局结构证据',
		`输入: ${data.chart.input.datetime}\n日主: ${data.chart.dayMaster}\n月令: ${data.monthCommand.branch}(${data.monthCommand.element})\n说明: 此工具不输出最终断命结论，不直接判定身强身弱、格局或用神。`,
		mdTable(['五行', '分数', '占比', '日主五行'], data.elementScores.map((item) => [
			item.element,
			item.score,
			`${item.percent}%`,
			item.isDayMasterElement ? '是' : '',
		])),
		mdTable(['十神', '权重'], data.tenGodDistribution.map((item) => [item.tenGod, item.score])),
		mdTable(['柱', '地支', '同五行根气', '同干根气', '命中藏干'], data.rootEvidence.map((item) => [
			item.pillar,
			item.branch,
			item.hasSameElementRoot ? '有' : '无',
			item.hasExactRoot ? '有' : '无',
			item.matches.map((match) => `${match.stem}(${match.tenGod})`).join('、') || '-',
		])),
		mdTable(['透干位置', '天干', '十神'], data.visibleStemEvidence.map((item) => [
			item.pillar,
			item.stem,
			item.tenGod,
		])),
		relationRowsMarkdown(data.relations),
		mdTable(['检查项', '证据'], data.checkpoints.map((item) => [item.item, item.evidence])),
		'下一步: 看阶段触发调用 bazi_timeline；看单一年/月/日/时调用 bazi_period_detail。',
	]);
}

function relationAgainstOriginal(target: SixtyCycle, eightChar: EightChar) {
	const pillars = getPillarCycles(eightChar);
	return pillarKeys.map((key) => ({
		pillar: pillarLabels[key],
		original: pillars[key].getName(),
		relation: pairRelationSummary(pillars[key], target),
	}));
}

function buildBaziTimelineData(datetime: string, gender: string, startYear: number, count: number) {
	const chart = buildBaziChartData(datetime, gender);
	const { dt, solarTime, eightChar, dayMaster } = chart.ctx;
	const childLimit = ChildLimit.fromSolarTime(solarTime, toGender(gender));
	const birthYear = dt.year;
	const startAge = startYear - birthYear + 1;
	const rows: Array<Record<string, unknown>> = [];
	let fortune = childLimit.getStartFortune();
	const firstAge = fortune.getAge();
	if (startAge > firstAge) fortune = fortune.next(startAge - firstAge);

	for (let i = 0; i < count; i++) {
		const age = fortune.getAge();
		const year = birthYear + age - 1;
		const sixtyCycleYear = fortune.getSixtyCycleYear();
		const xiaoYunSc = fortune.getSixtyCycle();
		const yearSc = sixtyCycleYear.getSixtyCycle();
		let decadeInfo: Record<string, unknown> | null = null;
		let dec = childLimit.getStartDecadeFortune();
		for (let d = 0; d < 10; d++) {
			if (age >= dec.getStartAge() && age <= dec.getEndAge()) {
				const decSc = dec.getSixtyCycle();
				decadeInfo = {
					sixtyCycle: decSc.getName(),
					tenGod: dayMaster.getTenStar(decSc.getHeavenStem()).getName(),
					startAge: dec.getStartAge(),
					endAge: dec.getEndAge(),
				};
				break;
			}
			dec = dec.next(1);
		}

		rows.push({
			year,
			solarRange: sixtyCycleYearSolarRange(sixtyCycleYear),
			age,
			decade: decadeInfo,
			xiaoYun: {
				sixtyCycle: xiaoYunSc.getName(),
				tenGod: dayMaster.getTenStar(xiaoYunSc.getHeavenStem()).getName(),
			},
			liuNian: {
				sixtyCycle: yearSc.getName(),
				tenGod: dayMaster.getTenStar(yearSc.getHeavenStem()).getName(),
			},
			originalRelations: relationAgainstOriginal(yearSc, eightChar),
			specialRelations: formatSpecialCycleRelations(yearSc, eightChar),
		});
		fortune = fortune.next(1);
	}

	return { chart, startYear, count, rows };
}

function formatBaziTimelineMarkdown(data: ReturnType<typeof buildBaziTimelineData>) {
	return joinSections([
		'八字大运流年时间轴',
		`出生: ${data.chart.input.datetime}\n日主: ${data.chart.dayMaster}\n查询: ${data.startYear} 起 ${data.count} 年`,
		mdTable(
			['年份', '公历实际对应范围', '年龄', '大运', '小运', '流年'],
			data.rows.map((row) => {
				const decade = row.decade as Record<string, unknown> | null;
				const xiaoYun = row.xiaoYun as Record<string, unknown>;
				const liuNian = row.liuNian as Record<string, unknown>;
				return [
					row.year,
					row.solarRange,
					`${row.age}岁`,
					decade ? `${decade.sixtyCycle}(${decade.tenGod}) ${decade.startAge}-${decade.endAge}岁` : '-',
					`${xiaoYun.sixtyCycle}(${xiaoYun.tenGod})`,
					`${liuNian.sixtyCycle}(${liuNian.tenGod})`,
				];
			}),
		),
		mdTable(
			['年份', '流年', '与原局四柱关系'],
			data.rows.map((row) => {
				const liuNian = row.liuNian as Record<string, unknown>;
				const relations = (row.originalRelations as Array<Record<string, unknown>>)
					.map((item) => `${item.pillar}${item.original}:${item.relation}`)
					.join('；');
				return [row.year, liuNian.sixtyCycle, relations || '-'];
			}),
		),
		mdTable(
			['年份', '流年', '胎元/命宫/身宫关系'],
			data.rows.map((row) => {
				const liuNian = row.liuNian as Record<string, unknown>;
				return [row.year, liuNian.sixtyCycle, row.specialRelations];
			}),
		),
		'边界: 此工具只给阶段时间轴和触发关系。若要展开某个年/月/日/时，请继续调用 bazi_period_detail。',
	]);
}

function buildBaziPeriodData(
	datetime: string,
	gender: string,
	scopeInput: string,
	year?: number,
	month?: number,
	date?: string,
	hour?: number,
) {
	const chart = buildBaziChartData(datetime, gender);
	const { eightChar, dayMaster } = chart.ctx;
	const scope = normalizeBaziPeriodScope(scopeInput);
	let target: Record<string, unknown>;

	if (scope === 'year') {
		if (!year) throw new Error('scope=year requires year.');
		const scYear = SixtyCycleYear.fromYear(year);
		const sc = scYear.getSixtyCycle();
		target = {
			scope,
			label: `${year}年`,
			sixtyCycle: sc.getName(),
			tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
			nayin: sc.getSound().getName(),
			solarRange: sixtyCycleYearSolarRange(scYear),
			originalRelations: relationAgainstOriginal(sc, eightChar),
			timeline: buildBaziTimelineData(datetime, gender, year, 1).rows[0],
		};
	} else if (scope === 'month') {
		if (!year || !month) throw new Error('scope=month requires year and month.');
		if (month < 1 || month > 12) throw new Error('month must be 1-12.');
		const scMonth = SixtyCycleYear.fromYear(year).getMonths()[month - 1];
		const sc = scMonth.getSixtyCycle();
		target = {
			scope,
			label: `${year}年第${month}个干支月`,
			sixtyCycle: sc.getName(),
			tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
			nayin: sc.getSound().getName(),
			solarRange: sixtyCycleMonthSolarRange(scMonth),
			originalRelations: relationAgainstOriginal(sc, eightChar),
			specialRelations: formatSpecialCycleRelations(sc, eightChar),
		};
	} else if (scope === 'day') {
		const targetDate = parseDate(date ?? '');
		if (!targetDate) throw new Error('scope=day requires date in YYYY-MM-DD.');
		const scDay = SixtyCycleDay.fromSolarDay(SolarDay.fromYmd(targetDate.year, targetDate.month, targetDate.day));
		const sc = scDay.getSixtyCycle();
		target = {
			scope,
			label: date,
			sixtyCycle: sc.getName(),
			tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
			nayin: sc.getSound().getName(),
			twelveStar: scDay.getTwelveStar().getName(),
			nineStar: scDay.getNineStar().toString(),
			solarRange: sixtyCycleDaySolarRange(scDay),
			recommends: scDay.getRecommends().map((item) => item.getName()),
			avoids: scDay.getAvoids().map((item) => item.getName()),
			originalRelations: relationAgainstOriginal(sc, eightChar),
			specialRelations: formatSpecialCycleRelations(sc, eightChar),
		};
	} else {
		const targetDate = parseDate(date ?? '');
		if (!targetDate) throw new Error('scope=hour requires date in YYYY-MM-DD.');
		if (hour === undefined || hour < 0 || hour > 23) throw new Error('scope=hour requires hour 0-23.');
		const scHour = SolarTime.fromYmdHms(targetDate.year, targetDate.month, targetDate.day, hour, 0, 0).getSixtyCycleHour();
		const sc = scHour.getSixtyCycle();
		target = {
			scope,
			label: `${date} ${pad(hour)}:00`,
			sixtyCycle: sc.getName(),
			tenGod: dayMaster.getTenStar(sc.getHeavenStem()).getName(),
			nayin: sc.getSound().getName(),
			twelveStar: scHour.getTwelveStar().getName(),
			nineStar: scHour.getNineStar().toString(),
			solarRange: sixtyCycleHourSolarRange(scHour),
			recommends: scHour.getRecommends().map((item) => item.getName()),
			avoids: scHour.getAvoids().map((item) => item.getName()),
			originalRelations: relationAgainstOriginal(sc, eightChar),
			specialRelations: formatSpecialCycleRelations(sc, eightChar),
		};
	}

	return { chart, target };
}

function formatBaziPeriodMarkdown(data: ReturnType<typeof buildBaziPeriodData>) {
	const relations = data.target.originalRelations as Array<Record<string, unknown>>;
	const timeline = data.target.timeline as Record<string, unknown> | undefined;
	const decade = timeline?.decade as Record<string, unknown> | null | undefined;
	const xiaoYun = timeline?.xiaoYun as Record<string, unknown> | undefined;
	const liuNian = timeline?.liuNian as Record<string, unknown> | undefined;
	return joinSections([
		'八字单一周期详盘',
		`出生: ${data.chart.input.datetime}\n日主: ${data.chart.dayMaster}\n周期层级: ${data.target.scope}\n周期: ${data.target.label}\n干支: ${data.target.sixtyCycle}(${data.target.tenGod})\n纳音: ${data.target.nayin}\n公历实际对应范围: ${data.target.solarRange}`,
		data.target.twelveStar || data.target.nineStar ? `十二建星: ${data.target.twelveStar ?? '-'}\n九星: ${data.target.nineStar ?? '-'}` : undefined,
		timeline ? mdTable(['年份', '年龄', '大运', '小运', '流年', '胎元/命宫/身宫关系'], [[
			timeline.year,
			`${timeline.age}岁`,
			decade ? `${decade.sixtyCycle}(${decade.tenGod}) ${decade.startAge}-${decade.endAge}岁` : '-',
			xiaoYun ? `${xiaoYun.sixtyCycle}(${xiaoYun.tenGod})` : '-',
			liuNian ? `${liuNian.sixtyCycle}(${liuNian.tenGod})` : '-',
			timeline.specialRelations ?? '-',
		]]) : undefined,
		mdTable(['原局柱', '原局干支', '与周期关系'], relations.map((row) => [row.pillar, row.original, row.relation])),
		data.target.specialRelations ? `胎元/命宫/身宫关系: ${data.target.specialRelations}` : undefined,
		Array.isArray(data.target.recommends) ? mdTable(['宜', '忌'], [[(data.target.recommends as string[]).join('、'), (data.target.avoids as string[]).join('、')]]) : undefined,
		'边界: 此工具只展开指定周期证据，不替代 bazi_structure 的命局结构判断。',
	]);
}

function starRecord(star: IFunctionalStar) {
	return {
		name: star.name,
		type: star.type,
		scope: star.scope,
		brightness: star.brightness ?? '',
		mutagen: star.mutagen ?? '',
	};
}

type StarRecord = ReturnType<typeof starRecord>;
type CompactStarRecord = ReturnType<typeof compactZiweiStarRecord>;

function starRecordText(star: Pick<StarRecord, 'name' | 'brightness' | 'mutagen'> | Pick<CompactStarRecord, 'name' | 'brightness' | 'mutagen'>) {
	return [
		star.name,
		star.brightness ? `(${star.brightness})` : undefined,
		star.mutagen ? `[${star.mutagen}]` : undefined,
	].filter(Boolean).join('');
}

function starRecordsText(
	stars: Array<Pick<StarRecord, 'name' | 'brightness' | 'mutagen'> | Pick<CompactStarRecord, 'name' | 'brightness' | 'mutagen'>> | undefined,
	empty = '-',
) {
	return stars && stars.length > 0 ? stars.map(starRecordText).join('、') : empty;
}

function palaceRecord(palace: IFunctionalPalace) {
	return {
		index: palace.index,
		name: palace.name,
		heavenlyStem: palace.heavenlyStem,
		earthlyBranch: palace.earthlyBranch,
		isBodyPalace: palace.isBodyPalace,
		isOriginalPalace: palace.isOriginalPalace,
		isEmpty: palace.isEmpty(),
		flags: palaceFlags(palace),
		majorStars: palace.majorStars.map(starRecord),
		minorStars: palace.minorStars.map(starRecord),
		adjectiveStars: palace.adjectiveStars.map(starRecord),
		changsheng12: palace.changsheng12,
		boshi12: palace.boshi12,
		jiangqian12: palace.jiangqian12,
		suiqian12: palace.suiqian12,
		decadal: palace.decadal,
		ages: palace.ages,
	};
}

function ziweiPalaceRef(palace: IFunctionalPalace) {
	return {
		index: palace.index,
		name: palace.name,
		heavenlyStem: palace.heavenlyStem,
		earthlyBranch: palace.earthlyBranch,
		stemBranch: `${palace.heavenlyStem}${palace.earthlyBranch}`,
	};
}

function compactZiweiStarRecord(star: IFunctionalStar) {
	return {
		name: star.name,
		brightness: star.brightness ?? '',
		mutagen: star.mutagen ?? '',
	};
}

function compactZiweiPalaceEvidence(palace: IFunctionalPalace) {
	return {
		...ziweiPalaceRef(palace),
		isBodyPalace: palace.isBodyPalace,
		isEmpty: palace.isEmpty(),
		flags: palaceFlags(palace),
		majorStars: palace.majorStars.map(compactZiweiStarRecord),
		minorStars: palace.minorStars.map(compactZiweiStarRecord),
		mutagenStars: [...palace.majorStars, ...palace.minorStars, ...palace.adjectiveStars]
			.filter((star) => Boolean(star.mutagen))
			.map(compactZiweiStarRecord),
	};
}

function compactZiweiSurroundedEvidence(surrounded: ReturnType<IFunctionalAstrolabe['surroundedPalaces']>) {
	return [
		{ relation: '本宫', palace: ziweiPalaceRef(surrounded.target), majorStars: surrounded.target.majorStars.map(compactZiweiStarRecord) },
		{ relation: '对宫', palace: ziweiPalaceRef(surrounded.opposite), majorStars: surrounded.opposite.majorStars.map(compactZiweiStarRecord) },
		{ relation: '财帛位', palace: ziweiPalaceRef(surrounded.wealth), majorStars: surrounded.wealth.majorStars.map(compactZiweiStarRecord) },
		{ relation: '官禄位', palace: ziweiPalaceRef(surrounded.career), majorStars: surrounded.career.majorStars.map(compactZiweiStarRecord) },
	];
}

function compactZiweiFlyEvidence(palace: IFunctionalPalace) {
	const places = palace.mutagedPlaces();
	return mutagenNames.map((mutagen, index) => ({
		mutagen,
		toPalace: places[index] ? ziweiPalaceRef(places[index] as IFunctionalPalace) : null,
		isSelfMutaged: palace.selfMutaged(mutagen as never),
	}));
}

function ziweiSummaryRecord(chart: ReturnType<typeof buildZiweiChart>, datetime: string) {
	const astrolabe = chart.astrolabe;
	return {
		inputDatetime: datetime,
		calendar: chart.calendar,
		profile: chart.profile,
		timeIndex: chart.option.timeIndex,
		solarDate: astrolabe.solarDate,
		lunarDate: astrolabe.lunarDate,
		chineseDate: astrolabe.chineseDate,
		soul: astrolabe.soul,
		body: astrolabe.body,
		fiveElementsClass: astrolabe.fiveElementsClass,
		zodiac: astrolabe.zodiac,
		sign: astrolabe.sign,
		soulPalaceBranch: astrolabe.earthlyBranchOfSoulPalace,
		bodyPalaceBranch: astrolabe.earthlyBranchOfBodyPalace,
	};
}

function ziweiSurroundedRecord(surrounded: ReturnType<IFunctionalAstrolabe['surroundedPalaces']>) {
	return [
		{ relation: '本宫', palace: palaceRecord(surrounded.target) },
		{ relation: '对宫', palace: palaceRecord(surrounded.opposite) },
		{ relation: '财帛位', palace: palaceRecord(surrounded.wealth) },
		{ relation: '官禄位', palace: palaceRecord(surrounded.career) },
	];
}

function ziweiFlyRecord(palace: IFunctionalPalace) {
	const places = palace.mutagedPlaces();
	return mutagenNames.map((mutagen, index) => ({
		mutagen,
		toPalace: places[index] ? palaceRecord(places[index] as IFunctionalPalace) : null,
		isSelfMutaged: palace.selfMutaged(mutagen as never),
	}));
}

function buildZiweiChartData(
	datetime: string,
	gender: string,
	profile?: string,
	calendar?: string,
	isLeapMonth?: boolean,
	language?: string,
) {
	const chart = buildZiweiChart(datetime, gender, profile, calendar, isLeapMonth, language);
	return {
		chart,
		summary: ziweiSummaryRecord(chart, datetime),
		palaces: chart.astrolabe.palaces.map(palaceRecord),
		transforms: ziweiFourTransforms(chart.astrolabe),
	};
}

function formatZiweiChartMarkdown(data: ReturnType<typeof buildZiweiChartData>) {
	return joinSections([
		'紫微斗数本命全盘',
		formatZiweiSummary(data.chart.astrolabe, data.summary.inputDatetime, data.chart.calendar, data.chart.profile, data.chart.option.timeIndex),
		joinSections(['十二宫星曜', formatZiweiPalacesTable(data.chart.astrolabe)]),
		joinSections(['生年四化', formatZiweiTransformsTable(data.chart.astrolabe)]),
		'边界: 本工具只给本命全盘。看单宫三方四正、夹宫、空宫借星与飞化自化，请调用 ziwei_palace_detail；看运限请调用 ziwei_horoscope_overview。',
	]);
}

function buildZiweiPalaceDetailData(
	datetime: string,
	gender: string,
	palaceName: string,
	profile?: string,
	calendar?: string,
	isLeapMonth?: boolean,
	language?: string,
) {
	const data = buildZiweiChartData(datetime, gender, profile, calendar, isLeapMonth, language);
	const palace = data.chart.astrolabe.palace(palaceName as never);
	if (!palace) throw new Error(`Unknown palace: ${palaceName}`);
	const surrounded = data.chart.astrolabe.surroundedPalaces(palaceName as never);
	const left = data.chart.astrolabe.palaces[(palace.index + 11) % 12];
	const right = data.chart.astrolabe.palaces[(palace.index + 1) % 12];
	return {
		...data,
		palace: palaceRecord(palace),
		surrounded: ziweiSurroundedRecord(surrounded),
		adjacent: [
			{ relation: '前一宫', palace: palaceRecord(left) },
			{ relation: '后一宫', palace: palaceRecord(right) },
		],
		borrowedFromOpposite: palace.isEmpty() ? palaceRecord(surrounded.opposite) : null,
		flyingTransforms: ziweiFlyRecord(palace),
	};
}

function formatZiweiPalaceDetailMarkdown(data: ReturnType<typeof buildZiweiPalaceDetailData>) {
	const palace = data.palace;
	return joinSections([
		'紫微斗数单宫详盘',
		`输入: ${data.summary.inputDatetime}\n历法: ${data.summary.calendar === 'solar' ? '公历' : '农历'}\n流派: ${ziweiProfileLabels[data.summary.profile as ZiweiProfile]} (${data.summary.profile})\n公历: ${data.summary.solarDate}\n农历: ${data.summary.lunarDate}`,
		`宫位: ${palace.name}(${palace.heavenlyStem}${palace.earthlyBranch})\n标记: ${palace.flags}\n空宫: ${palace.isEmpty ? '是' : '否'}`,
		mdTable(['项目', '主星', '辅星', '杂曜', '长生/博士/将前/岁前', '大限', '小限年龄'], [[
			`${palace.name}(${palace.heavenlyStem}${palace.earthlyBranch})`,
			starRecordsText(palace.majorStars as StarRecord[]),
			starRecordsText(palace.minorStars as StarRecord[]),
			starRecordsText(palace.adjectiveStars as StarRecord[]),
			`${palace.changsheng12}/${palace.boshi12}/${palace.jiangqian12}/${palace.suiqian12}`,
			palace.decadal ? `${palace.decadal.range?.[0] ?? '-'}-${palace.decadal.range?.[1] ?? '-'}岁 ${palace.decadal.heavenlyStem}${palace.decadal.earthlyBranch}` : '-',
			Array.isArray(palace.ages) && palace.ages.length > 0 ? palace.ages.join('、') : '-',
		]]),
		mdTable(['关系', '宫位', '干支', '主星', '辅星'], data.surrounded.map((item) => [
			item.relation,
			item.palace.name,
			`${item.palace.heavenlyStem}${item.palace.earthlyBranch}`,
			starRecordsText(item.palace.majorStars as StarRecord[]),
			starRecordsText(item.palace.minorStars as StarRecord[]),
		])),
		mdTable(['夹宫', '宫位', '干支', '主星'], data.adjacent.map((item) => [
			item.relation,
			item.palace.name,
			`${item.palace.heavenlyStem}${item.palace.earthlyBranch}`,
			starRecordsText(item.palace.majorStars as StarRecord[]),
		])),
		data.borrowedFromOpposite ? `空宫借星参考: 对宫 ${data.borrowedFromOpposite.name} 主星 ${starRecordsText(data.borrowedFromOpposite.majorStars as StarRecord[])}` : undefined,
		mdTable(['宫干四化', '飞入宫位', '自化'], data.flyingTransforms.map((item) => [
			item.mutagen,
			item.toPalace ? `${item.toPalace.name}(${item.toPalace.heavenlyStem}${item.toPalace.earthlyBranch})` : '-',
			item.isSelfMutaged ? '是' : '否',
		])),
		'边界: 此工具只给单宫证据，不直接给最终吉凶断语。需要运限叠盘时调用 ziwei_scope_detail 或 ziwei_topic_context。',
	]);
}

function buildZiweiHoroscopeOverviewData(
	birthDatetime: string,
	gender: string,
	targetDatetime: string,
	profile?: string,
	calendar?: string,
	isLeapMonth?: boolean,
	language?: string,
) {
	const ctx = buildZiweiHoroscope(birthDatetime, gender, targetDatetime, profile, calendar, isLeapMonth, language);
	return {
		ctx,
		birthDatetime,
		targetDatetime,
		overview: ziweiScopes.map((scope) => {
			const item = scopeItem(ctx.horoscope, scope);
			return {
				scope,
				label: scope === 'age' ? `${ziweiScopeLabels[scope]}(${ctx.horoscope.age.nominalAge}虚岁)` : ziweiScopeLabels[scope],
				branch: horoscopeItemBranch(item),
				solarRange: ziweiScopeSolarRange(scope, ctx.targetSolarTime),
				originPalace: palaceLabel(ctx.astrolabe, item.index),
				mutagens: item.mutagen,
				starPalaceCount: item.stars ? item.stars.filter((stars) => stars.length > 0).length : 0,
			};
		}),
	};
}

function formatZiweiHoroscopeOverviewMarkdown(data: ReturnType<typeof buildZiweiHoroscopeOverviewData>) {
	return joinSections([
		'紫微运限总览',
		`出生: ${data.birthDatetime} (${data.ctx.calendar === 'solar' ? '公历' : '农历'})\n目标: ${data.targetDatetime}\n目标公历: ${data.ctx.horoscope.solarDate}\n目标农历: ${data.ctx.horoscope.lunarDate}\n流派: ${ziweiProfileLabels[data.ctx.profile]} (${data.ctx.profile})\n目标时辰索引: ${data.ctx.targetTimeIndex}`,
		mdTable(['层级', '干支', '公历实际对应范围', '所在原盘宫', '四化', '流耀提示'], data.overview.map((item) => [
			item.label,
			item.branch,
			item.solarRange,
			item.originPalace,
			item.mutagens.length > 0 ? item.mutagens.join('、') : '-',
			item.starPalaceCount > 0 ? `有流耀宫位 ${item.starPalaceCount}/12` : '-',
		])),
		'边界: 这个工具只做导航总览，不展开十二宫。下一步必须调用 ziwei_scope_detail 展开单层运限，或调用 ziwei_topic_context 做专题取证。',
	]);
}

function buildZiweiScopeDetailData(
	birthDatetime: string,
	gender: string,
	targetDatetime: string,
	scopeInput: string,
	focusPalace: string,
	profile?: string,
	calendar?: string,
	isLeapMonth?: boolean,
	language?: string,
) {
	const ctx = buildZiweiHoroscope(birthDatetime, gender, targetDatetime, profile, calendar, isLeapMonth, language);
	const scope = normalizeZiweiScope(scopeInput);
	const item = scopeItem(ctx.horoscope, scope);
	const palaces = ctx.astrolabe.palaces.map((palace, index) => ({
		index: index + 1,
		runtimePalace: item.palaceNames[index] ?? '-',
		originPalace: palaceRecord(palace),
		horoscopeStars: item.stars?.[index]?.map(starRecord) ?? [],
	}));
	let focus: { agePalace: ReturnType<typeof palaceRecord> | null } | { surrounded: ReturnType<typeof ziweiSurroundedRecord> };
	if (scope === 'age') {
		const agePalace = ctx.horoscope.agePalace();
		focus = { agePalace: agePalace ? palaceRecord(agePalace) : null };
	} else {
		const focusSurrounded = ctx.horoscope.surroundPalaces(focusPalace as never, scope as ZiweiRuntimeScope);
		if (!focusSurrounded) throw new Error(`Unknown focusPalace: ${focusPalace}`);
		focus = { surrounded: ziweiSurroundedRecord(focusSurrounded) };
	}
	return {
		ctx,
		birthDatetime,
		targetDatetime,
		scope,
		focusPalace,
		item: {
			branch: horoscopeItemBranch(item),
			solarRange: ziweiScopeSolarRange(scope, ctx.targetSolarTime),
			originPalace: palaceLabel(ctx.astrolabe, item.index),
			mutagens: item.mutagen,
			nominalAge: scope === 'age' ? ctx.horoscope.age.nominalAge : null,
		},
		palaces,
		focus, 
	};
}

function formatZiweiScopeDetailMarkdown(data: ReturnType<typeof buildZiweiScopeDetailData>) {
	return joinSections([
		'紫微单层运限详盘',
		`层级: ${ziweiScopeLabels[data.scope]}\n重点宫位: ${data.focusPalace}\n出生: ${data.birthDatetime}\n目标: ${data.targetDatetime}\n目标公历: ${data.ctx.horoscope.solarDate}\n目标农历: ${data.ctx.horoscope.lunarDate}\n流派: ${ziweiProfileLabels[data.ctx.profile]} (${data.ctx.profile})`,
		mdTable(['层级', '干支', '公历实际对应范围', '所在原盘宫', '四化', '虚岁'], [[
			ziweiScopeLabels[data.scope],
			data.item.branch,
			data.item.solarRange,
			data.item.originPalace,
			data.item.mutagens.length > 0 ? data.item.mutagens.join('、') : '-',
			data.item.nominalAge ? `${data.item.nominalAge}虚岁` : '-',
		]]),
		mdTable(['序', '运限宫位', '原盘宫位', '原盘干支', '标记', '空宫', '原盘主星', '原盘辅星', '原盘杂曜', '流耀'], data.palaces.map((item) => [
			item.index,
			item.runtimePalace,
			item.originPalace.name,
			`${item.originPalace.heavenlyStem}${item.originPalace.earthlyBranch}`,
			item.originPalace.flags,
			item.originPalace.isEmpty ? '是' : '否',
			starRecordsText(item.originPalace.majorStars as StarRecord[]),
			starRecordsText(item.originPalace.minorStars as StarRecord[]),
			starRecordsText(item.originPalace.adjectiveStars as StarRecord[]),
			starRecordsText(item.horoscopeStars as StarRecord[]),
		])),
		data.scope === 'age'
			? `小限宫位: ${(data.focus as { agePalace: ReturnType<typeof palaceRecord> | null }).agePalace?.name ?? '-'}`
			: mdTable(['关系', '原盘宫位', '干支', '主星', '辅星'], ((data.focus as { surrounded: ReturnType<typeof ziweiSurroundedRecord> }).surrounded).map((item) => [
				item.relation,
				item.palace.name,
				`${item.palace.heavenlyStem}${item.palace.earthlyBranch}`,
				starRecordsText(item.palace.majorStars as StarRecord[]),
				starRecordsText(item.palace.minorStars as StarRecord[]),
			])),
		'边界: 此工具只展开一个运限层级。专题整合请调用 ziwei_topic_context。',
	]);
}

const ziweiTopicPalaces: Record<ZiweiTopic, string[]> = {
	self: ['命宫', '迁移', '福德'],
	career: ['官禄', '迁移', '财帛', '福德'],
	wealth: ['财帛', '田宅', '官禄', '兄弟'],
	relationship: ['夫妻', '子女', '福德', '命宫'],
	health: ['疾厄', '福德', '命宫', '父母'],
	family: ['田宅', '父母', '兄弟', '子女', '夫妻'],
};

function buildZiweiTopicContextData(
	birthDatetime: string,
	gender: string,
	targetDatetime: string,
	topicInput: string,
	profile?: string,
	calendar?: string,
	isLeapMonth?: boolean,
	language?: string,
) {
	const topic = normalizeZiweiTopic(topicInput);
	const overview = buildZiweiHoroscopeOverviewData(birthDatetime, gender, targetDatetime, profile, calendar, isLeapMonth, language);
	const yearlyItem = scopeItem(overview.ctx.horoscope, 'yearly');
	const palaces = ziweiTopicPalaces[topic].map((name) => {
		const origin = overview.ctx.astrolabe.palace(name as never);
		if (!origin) throw new Error(`Unknown topic palace: ${name}`);
		const yearlyPalace = overview.ctx.horoscope.palace(name as never, 'yearly');
		const yearlyMutagenHits = mutagenNames.filter((mutagen) => overview.ctx.horoscope.hasHoroscopeMutagen(name as never, 'yearly', mutagen as never));
		return {
			name,
			natal: compactZiweiPalaceEvidence(origin),
			natalSurrounded: compactZiweiSurroundedEvidence(overview.ctx.astrolabe.surroundedPalaces(name as never)),
			natalFlyingTransforms: compactZiweiFlyEvidence(origin),
			yearly: yearlyPalace ? compactZiweiPalaceEvidence(yearlyPalace as IFunctionalPalace) : null,
			yearlyStars: yearlyItem.stars?.[origin.index]?.map(compactZiweiStarRecord) ?? [],
			yearlyMutagenHits,
			nextCalls: [
				{ tool: 'ziwei_palace_detail', arguments: { palace: name } },
				{ tool: 'ziwei_scope_detail', arguments: { scope: 'yearly', focusPalace: name } },
			],
		};
	});

	return {
		birthDatetime,
		targetDatetime,
		topic,
		topicPalaces: ziweiTopicPalaces[topic],
		runtime: {
			profile: overview.ctx.profile,
			calendar: overview.ctx.calendar,
			targetSolarDate: overview.ctx.horoscope.solarDate,
			targetLunarDate: overview.ctx.horoscope.lunarDate,
			targetTimeIndex: overview.ctx.targetTimeIndex,
		},
		overview: overview.overview,
		palaces,
		warnings: ['专题取证只返回索引级证据，不输出最终断语；单宫细节调用 ziwei_palace_detail，运限叠盘调用 ziwei_scope_detail。'],
	};
}

function formatZiweiTopicContextMarkdown(data: ReturnType<typeof buildZiweiTopicContextData>) {
	return joinSections([
		'紫微专题取证',
		`专题: ${data.topic}\n出生: ${data.birthDatetime}\n目标: ${data.targetDatetime}\n相关宫位: ${data.topicPalaces.join('、')}\n流派: ${ziweiProfileLabels[data.runtime.profile]} (${data.runtime.profile})\n历法: ${data.runtime.calendar === 'solar' ? '公历' : '农历'}\n目标公历: ${data.runtime.targetSolarDate}\n目标农历: ${data.runtime.targetLunarDate}\n目标时辰索引: ${data.runtime.targetTimeIndex}`,
		mdTable(['层级', '干支', '公历实际对应范围', '所在原盘宫', '四化', '流耀提示'], data.overview.map((item) => [
			item.label,
			item.branch,
			item.solarRange,
			item.originPalace,
			item.mutagens.length > 0 ? item.mutagens.join('、') : '-',
			item.starPalaceCount > 0 ? `有流耀宫位 ${item.starPalaceCount}/12` : '-',
		])),
		mdTable(['宫位', '本命干支', '本命主星', '本命辅星', '本命四化星', '流年宫位', '流年流耀', '流年四化命中'], data.palaces.map((item) => [
			item.name,
			item.natal.stemBranch,
			starRecordsText(item.natal.majorStars),
			starRecordsText(item.natal.minorStars),
			starRecordsText(item.natal.mutagenStars),
			item.yearly ? `${item.yearly.name}(${item.yearly.stemBranch})` : '-',
			starRecordsText(item.yearlyStars),
			item.yearlyMutagenHits.join('、') || '-',
		])),
		mdTable(['宫位', '本命三方四正', '本命飞化', '建议调用'], data.palaces.map((item) => [
			item.name,
			item.natalSurrounded.map((surrounded) => `${surrounded.relation}:${surrounded.palace.name}(${starRecordsText(surrounded.majorStars)})`).join('；'),
			item.natalFlyingTransforms.map((fly) => `${fly.mutagen}->${fly.toPalace ? `${fly.toPalace.name}(${fly.toPalace.stemBranch})` : '-'}${fly.isSelfMutaged ? '[自化]' : ''}`).join('；'),
			item.nextCalls.map((call) => `${call.tool}(${Object.entries(call.arguments).map(([key, value]) => `${key}=${value}`).join(', ')})`).join('；'),
		])),
		`边界: ${data.warnings.join(' ')}`,
	]);
}

function registerBaziTools(server: McpServer) {
	server.registerTool(
		'bazi_chart',
		{
			title: '八字排盘',
			description: '适用场景: 第一步获取八字客观基础盘。不要用于直接判断身强身弱、格局或用神。下一步: 调用 bazi_structure 做命局结构取证，或 bazi_timeline 看阶段触发。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM，按出生地当地民用时间输入'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
			},
		},
		async ({ datetime, gender }) => {
			try {
				const data = buildBaziChartData(datetime, gender);
				return textResult(formatBaziChartMarkdown(data));
			} catch (e) {
				return errResult(`bazi_chart 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'bazi_structure',
		{
			title: '八字命局分析',
			description: '适用场景: 在 bazi_chart 后分析日主、月令、通根、透干、五行、十神、刑冲合害与旺衰取用证据。不要输出最终断命结论。下一步: 调用 bazi_timeline 或 bazi_period_detail 验证阶段。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
			},
		},
		async ({ datetime, gender }) => {
			try {
				const data = buildBaziStructureData(datetime, gender);
				return textResult(formatBaziStructureMarkdown(data));
			} catch (e) {
				return errResult(`bazi_structure 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'bazi_timeline',
		{
			title: '八字大运流年',
			description: '适用场景: 在本命结构后查看大运、流年、小运、年龄、年份和原局触发。不要用于单独断某一年细节。下一步: 对重点年份调用 bazi_period_detail。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
				startYear: z.number().int().describe('起始公历年份'),
				count: z.number().int().min(1).max(60).optional().default(10).describe('查询年数，1-60，默认10'),
			},
		},
		async ({ datetime, gender, startYear, count }) => {
			try {
				const data = buildBaziTimelineData(datetime, gender, startYear, count);
				return textResult(formatBaziTimelineMarkdown(data));
			} catch (e) {
				return errResult(`bazi_timeline 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'bazi_period_detail',
		{
			title: '八字周期详盘',
			description: '适用场景: 展开某一年、干支月、日或小时与原局/大运流年的叠加证据。不要替代 bazi_structure 的命局结构判断。下一步: 回到用户专题问题组织解读。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
				scope: z.enum(baziPeriodScopes).describe('周期层级: year/month/day/hour'),
				year: z.number().int().optional().describe('scope=year/month 时必填，公历年份'),
				month: z.number().int().min(1).max(12).optional().describe('scope=month 时必填，干支月序号 1-12'),
				date: z.string().optional().describe('scope=day/hour 时必填，YYYY-MM-DD'),
				hour: z.number().int().min(0).max(23).optional().describe('scope=hour 时必填，0-23'),
			},
		},
		async ({ datetime, gender, scope, year, month, date, hour }) => {
			try {
				const data = buildBaziPeriodData(datetime, gender, scope, year, month, date, hour);
				return textResult(formatBaziPeriodMarkdown(data));
			} catch (e) {
				return errResult(`bazi_period_detail 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'bazi_shensha',
		{
			title: '八字神煞参考',
			description: '适用场景: 需要神煞作为附加证据时调用。不要单独用神煞断事或替代 bazi_structure。下一步: 回到 bazi_structure 或 bazi_period_detail 与主结构合看。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM'),
			},
		},
		async ({ datetime }) => {
			try {
				const { eightChar } = buildBaziContext(datetime);
				return textResult(joinSections([
					'常用八字神煞辅助表',
					`输入: ${datetime}`,
					formatShenshaTable(eightChar),
					'边界: 神煞为辅助参考，不可单独断事。',
				]));
			} catch (e) {
				return errResult(`bazi_shensha 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);
}

function registerZiweiTools(server: McpServer) {
	server.registerTool(
		'ziwei_chart',
		{
			title: '紫微斗数排盘',
			description: '适用场景: 第一步获取紫微本命十二宫全盘。不要用于展开单宫飞化或运限叠盘。下一步: 调用 ziwei_palace_detail 看单宫，或 ziwei_horoscope_overview 看运限。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM；calendar=lunar 时日期部分按农历解释'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
				profile: z.enum(ziweiProfiles).optional().default('sanhe').describe('排盘配置: sanhe（三合）或 feixing-sihua（飞星四化）'),
				calendar: z.enum(['solar', 'lunar']).optional().default('solar').describe('输入日期历法: solar=公历，lunar=农历'),
				isLeapMonth: z.boolean().optional().default(false).describe('calendar=lunar 时是否为农历闰月'),
				language: z.enum(ziweiLanguages).optional().default('zh-CN').describe('输出语言，默认 zh-CN'),
			},
		},
		async ({ datetime, gender, profile, calendar, isLeapMonth, language }) => {
			try {
				const data = buildZiweiChartData(datetime, gender, profile, calendar, isLeapMonth, language);
				return textResult(formatZiweiChartMarkdown(data));
			} catch (e) {
				return errResult(`ziwei_chart 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'ziwei_palace_detail',
		{
			title: '紫微宫位详盘',
			description: '适用场景: 展开某个本命宫位的本宫、对宫、三方四正、夹宫、空宫借星、飞化和自化证据。不要用于运限总览。下一步: 要叠运限调用 ziwei_scope_detail 或 ziwei_topic_context。',
			inputSchema: {
				datetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM；calendar=lunar 时日期部分按农历解释'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
				palace: z.string().describe('宫位名称，如 命宫、夫妻、财帛、官禄、疾厄'),
				profile: z.enum(ziweiProfiles).optional().default('sanhe').describe('排盘配置: sanhe 或 feixing-sihua'),
				calendar: z.enum(['solar', 'lunar']).optional().default('solar').describe('出生日期历法'),
				isLeapMonth: z.boolean().optional().default(false).describe('calendar=lunar 时是否为农历闰月'),
				language: z.enum(ziweiLanguages).optional().default('zh-CN').describe('输出语言，默认 zh-CN'),
			},
		},
		async ({ datetime, gender, palace, profile, calendar, isLeapMonth, language }) => {
			try {
				const data = buildZiweiPalaceDetailData(datetime, gender, palace, profile, calendar, isLeapMonth, language);
				return textResult(formatZiweiPalaceDetailMarkdown(data));
			} catch (e) {
				return errResult(`ziwei_palace_detail 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'ziwei_horoscope_overview',
		{
			title: '紫微运限概览',
			description: '适用场景: 只做大限、小限、流年、流月、流日、流时入口级导航。不要作为最终运势分析。下一步: 必须调用 ziwei_scope_detail 展开单层，或 ziwei_topic_context 做专题取证。',
			inputSchema: {
				birthDatetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM；calendar=lunar 时日期部分按农历解释'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
				targetDatetime: z.string().describe('目标日期时间 YYYY-MM-DD HH:MM'),
				profile: z.enum(ziweiProfiles).optional().default('sanhe').describe('排盘配置: sanhe 或 feixing-sihua'),
				calendar: z.enum(['solar', 'lunar']).optional().default('solar').describe('出生日期历法'),
				isLeapMonth: z.boolean().optional().default(false).describe('calendar=lunar 时出生日期是否为农历闰月'),
				language: z.enum(ziweiLanguages).optional().default('zh-CN').describe('输出语言，默认 zh-CN'),
			},
		},
		async ({ birthDatetime, gender, targetDatetime, profile, calendar, isLeapMonth, language }) => {
			try {
				const data = buildZiweiHoroscopeOverviewData(birthDatetime, gender, targetDatetime, profile, calendar, isLeapMonth, language);
				return textResult(formatZiweiHoroscopeOverviewMarkdown(data));
			} catch (e) {
				return errResult(`ziwei_horoscope_overview 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'ziwei_scope_detail',
		{
			title: '紫微运限详盘',
			description: '适用场景: 展开一个层级的大限/小限/流年/流月/流日/流时十二宫映射、流耀、四化与重点宫位三方四正。不要一次请求全部层级。下一步: 专题整合调用 ziwei_topic_context。',
			inputSchema: {
				birthDatetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM；calendar=lunar 时日期部分按农历解释'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
				targetDatetime: z.string().describe('目标日期时间 YYYY-MM-DD HH:MM'),
				scope: z.enum(ziweiScopes).describe('层级: decadal/age/yearly/monthly/daily/hourly'),
				focusPalace: z.string().optional().default('命宫').describe('重点宫位，默认命宫；age 层级只返回小限宫位'),
				profile: z.enum(ziweiProfiles).optional().default('sanhe').describe('排盘配置: sanhe 或 feixing-sihua'),
				calendar: z.enum(['solar', 'lunar']).optional().default('solar').describe('出生日期历法'),
				isLeapMonth: z.boolean().optional().default(false).describe('calendar=lunar 时出生日期是否为农历闰月'),
				language: z.enum(ziweiLanguages).optional().default('zh-CN').describe('输出语言，默认 zh-CN'),
			},
		},
		async ({ birthDatetime, gender, targetDatetime, scope, focusPalace, profile, calendar, isLeapMonth, language }) => {
			try {
				const data = buildZiweiScopeDetailData(birthDatetime, gender, targetDatetime, scope, focusPalace, profile, calendar, isLeapMonth, language);
				return textResult(formatZiweiScopeDetailMarkdown(data));
			} catch (e) {
				return errResult(`ziwei_scope_detail 错误: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	);

	server.registerTool(
		'ziwei_topic_context',
		{
			title: '紫微专题分析',
			description: '适用场景: 针对自我、事业、财富、关系、健康、家庭聚合本命与流年证据。不要直接输出最终断语。下一步: 对关键宫位调用 ziwei_palace_detail 或 ziwei_scope_detail。',
			inputSchema: {
				birthDatetime: z.string().describe('出生日期时间 YYYY-MM-DD HH:MM；calendar=lunar 时日期部分按农历解释'),
				gender: z.string().describe('性别: 男/女 或 male/female'),
				targetDatetime: z.string().describe('目标日期时间 YYYY-MM-DD HH:MM'),
				topic: z.enum(ziweiTopics).describe('专题: self/career/wealth/relationship/health/family'),
				profile: z.enum(ziweiProfiles).optional().default('sanhe').describe('排盘配置: sanhe 或 feixing-sihua'),
				calendar: z.enum(['solar', 'lunar']).optional().default('solar').describe('出生日期历法'),
				isLeapMonth: z.boolean().optional().default(false).describe('calendar=lunar 时出生日期是否为农历闰月'),
				language: z.enum(ziweiLanguages).optional().default('zh-CN').describe('输出语言，默认 zh-CN'),
			},
		},
		async ({ birthDatetime, gender, targetDatetime, topic, profile, calendar, isLeapMonth, language }) => {
			try {
				const data = buildZiweiTopicContextData(birthDatetime, gender, targetDatetime, topic, profile, calendar, isLeapMonth, language);
				return textResult(formatZiweiTopicContextMarkdown(data));
			} catch (e) {
				return errResult(`ziwei_topic_context 错误: ${e instanceof Error ? e.message : String(e)}`);
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

	registerBaziTools(server);
	registerZiweiTools(server);

	return server;
}

// ===== Export =====

const allTools = [
	{ name: 'bazi_chart', title: '八字排盘' },
	{ name: 'bazi_structure', title: '八字命局分析' },
	{ name: 'bazi_timeline', title: '八字大运流年' },
	{ name: 'bazi_period_detail', title: '八字周期详盘' },
	{ name: 'bazi_shensha', title: '八字神煞参考' },
	{ name: 'ziwei_chart', title: '紫微斗数排盘' },
	{ name: 'ziwei_palace_detail', title: '紫微宫位详盘' },
	{ name: 'ziwei_horoscope_overview', title: '紫微运限概览' },
	{ name: 'ziwei_scope_detail', title: '紫微运限详盘' },
	{ name: 'ziwei_topic_context', title: '紫微专题分析' },
];

function serverInfoText() {
	return joinSections([
		'Lunar Calendar MCP Server',
		`${allTools.map((tool) => tool.title).join('、')}。`,
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
