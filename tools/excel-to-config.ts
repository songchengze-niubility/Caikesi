// Excel → 配置导出脚本（多源驱动）
// 一张「源清单」(SOURCES) 描述：哪个 xlsx → 哪个 parser → 生成哪个产物。
// `npm run config` 会遍历所有源依次导出，每源独立校验、独立产物。
//
// 目前包含 battle/equip/drop/chest/offline/craft 六个模块：
// - tools/config-xlsx/battle.xlsx → battle.config.generated.ts
// - tools/config-xlsx/equip.xlsx  → equip.config.generated.ts
// - tools/config-xlsx/drop.xlsx   → drop.config.generated.ts
// - tools/config-xlsx/chest.xlsx  → chest.config.generated.ts
// - tools/config-xlsx/offline.xlsx → offline.config.generated.ts
// - tools/config-xlsx/craft.xlsx  → craft.config.generated.ts
// 【加新模块（如掉装备）】：① 写一个 buildXxxConfig(wb) 解析函数；
//   ② 在 SOURCES 末尾加一行 {name,xlsxRel,outRel,exportVar,build}。主流程不用改。
//
// 用法：npm run config   （或 npx tsx tools/excel-to-config.ts）
// 改完 Excel 必须跑这个脚本，生成的 .generated.ts 才会更新。

import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEffectList, parseStatMods, parseDelivery } from '../assets/scripts/config/EffectTypes';

// ============ 校验错误/警告收集（每个源独立，跑前清空）============
// err   = 会让产物坏掉的硬错误（缺字段、引用不存在、键不一致）→ 阻断该源导出。
// warn  = 数值越界等可疑但不一定致命的问题（如概率 > 1、count = 0）→ 只提示，不阻断。
const errors: string[] = [];
const warnings: string[] = [];
function err(msg: string) { errors.push(msg); }
function warn(msg: string) { warnings.push(msg); }
function resetIssues() { errors.length = 0; warnings.length = 0; }
// 某源解析完后调用：有错误则打印全部并退出；无错则把警告打出来后继续。
function reportIssues(source: string): void {
    if (warnings.length > 0) {
        console.warn(`\n⚠️  [${source}] ${warnings.length} 个数值警告（不阻断，建议核对）：`);
        for (const w of warnings) console.warn('  - ' + w);
    }
    if (errors.length === 0) return;
    console.error(`\n❌ [${source}] 配置导出失败，共 ${errors.length} 个问题：`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
}

// —— 数值范围兜底（呼应 ai/skills/性能约束.md 的「极端值兜底」）——
// 概率/比例类必须落在 [0,1]；critDmg/dmgBonus 是「加成倍率」可超过 1，故只查非负。
function checkStatRanges(st: Record<string, number>, where: string) {
    const prob01 = ['critRate', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgReduce'];
    for (const k of prob01) {
        const v = st[k];
        if (v < 0 || v > 1) warn(`${where}.${k} = ${v} 超出 [0,1]（概率/比例应在 0~1）`);
    }
    const nonNeg = ['hp', 'atk', 'def', 'range', 'attackSpeed', 'critDmg', 'dmgBonus', 'moveSpeed',
        'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus'];
    for (const k of nonNeg) {
        if (st[k] < 0) warn(`${where}.${k} = ${st[k]} 为负`);
    }
    if (st['attackSpeed'] <= 0) warn(`${where}.attackSpeed = ${st['attackSpeed']} 必须 > 0（否则攻击间隔除零）`);
}

// ============ 通用小工具（任意模块解析器复用）============
type Cell = unknown;
const STAT_KEYS = ['hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce', 'moveSpeed',
    'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus'];
const STAT_KEY_SET = new Set(STAT_KEYS);
// 装备侧合法键 = CombatStats 键 + 叠算层百分比键（EquipStatKey，见 EquipDefs 2026-07-11 双层叠算扩键）
const EQUIP_STAT_KEY_SET = new Set([...STAT_KEYS, 'hpPct', 'atkPct', 'defPct', 'moveSpeedPct']);

// 把单元格转成数字；空/非法 → null
function num(c: Cell): number | null {
    if (c === '' || c === null || c === undefined) return null;
    const n = Number(c);
    if (!Number.isFinite(n)) return null;
    return n;
}
function reqNum(c: Cell, where: string): number {
    const n = num(c);
    if (n === null) err(`${where}: 不是合法数字（得到 ${JSON.stringify(c)}）`);
    return n ?? 0;
}
function reqStr(c: Cell, where: string): string {
    if (c === '' || c === null || c === undefined) {
        err(`${where}: 缺少必填字符串`);
        return '';
    }
    return String(c);
}
// "r,g,b" → [r,g,b]
function parseColor(c: Cell, where: string): [number, number, number] {
    const s = String(c ?? '').trim();
    const parts = s.split(',').map(p => Number(p.trim()));
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
        err(`${where}: 颜色格式应为 "r,g,b"（得到 ${JSON.stringify(c)}）`);
        return [0, 0, 0];
    }
    if (parts.some(n => n < 0 || n > 255)) {
        warn(`${where}: 颜色分量应在 0~255（得到 ${parts.join(',')}）`);
    }
    return [parts[0], parts[1], parts[2]];
}

// 点分 key → 嵌套对象（如 "cloud.speed" → root.cloud.speed）
function setPath(root: Record<string, unknown>, dotted: string, value: unknown) {
    const parts = dotted.split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (cur[k] === undefined) cur[k] = {};
        cur = cur[k] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
}

// 读某 sheet 成「表头行 + 数据行」的二维数组（首行表头）
function sheetToRows(wb: XLSX.WorkBook, name: string): { header: string[]; rows: Record<string, Cell>[] } {
    const ws = wb.Sheets[name];
    if (!ws) {
        err(`缺少 sheet: ${name}`);
        return { header: [], rows: [] };
    }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as Cell[][];
    if (aoa.length === 0) {
        err(`sheet ${name} 为空`);
        return { header: [], rows: [] };
    }
    const header = (aoa[0] as unknown[]).map(h => String(h));
    const rows: Record<string, Cell>[] = [];
    for (let i = 1; i < aoa.length; i++) {
        const raw = aoa[i] as unknown[];
        // 整行空 → 跳过
        if (!raw || raw.every(c => c === '' || c === null || c === undefined)) continue;
        const row: Record<string, Cell> = {};
        header.forEach((h, idx) => { row[h] = raw[idx]; });
        rows.push(row);
    }
    return { header, rows };
}

// ============ battle 模块解析器 ============
// 读 battle.xlsx 的 6 sheet → 战斗配置对象（结构与 BattleConfig 类型完全一致）。
function buildBattleConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    // —— Stats ——
    const { rows: statsRows } = sheetToRows(wb, 'Stats');
    const stats: Record<string, Record<string, number>> = {};
    for (const r of statsRows) {
        const cls = reqStr(r['class'], `Stats`);
        if (cls in stats) err(`Stats: class "${cls}" 重复定义`);
        const obj: Record<string, number> = {};
        for (const k of STAT_KEYS) obj[k] = reqNum(r[k], `Stats[${cls}].${k}`);
        checkStatRanges(obj, `Stats[${cls}]`);
        stats[cls] = obj;
    }

    // —— EnemyTypes ——
    const { rows: enemyRows } = sheetToRows(wb, 'EnemyTypes');
    const enemyTypes: Record<string, unknown> = {};
    const knownEnemyTypes = new Set<string>();
    for (const r of enemyRows) {
        const type = reqStr(r['type'], `EnemyTypes`);
        if (knownEnemyTypes.has(type)) err(`EnemyTypes: type "${type}" 重复定义`);
        knownEnemyTypes.add(type);
        const eStats: Record<string, number> = {};
        for (const k of STAT_KEYS) eStats[k] = reqNum(r[k], `EnemyTypes[${type}].stats.${k}`);
        checkStatRanges(eStats, `EnemyTypes[${type}].stats`);
        enemyTypes[type] = {
            name: reqStr(r['name'], `EnemyTypes[${type}].name`),
            radius: reqNum(r['radius'], `EnemyTypes[${type}].radius`),
            attackInterval: reqNum(r['attackInterval'], `EnemyTypes[${type}].attackInterval`),
            color: parseColor(r['color'], `EnemyTypes[${type}].color`),
            exp: reqNum(r['exp'], `EnemyTypes[${type}].exp`),
            stats: eStats,
        };
    }

    // —— Classes ——
    const { rows: classRows } = sheetToRows(wb, 'Classes');
    const classes: Record<string, unknown> = {};
    const VALID_ATTACK = new Set(['melee', 'ranged', 'heal']);
    for (const r of classRows) {
        const cls = reqStr(r['class'], `Classes`);
        if (cls in classes) err(`Classes: class "${cls}" 重复定义`);
        const at = reqStr(r['attackType'], `Classes[${cls}].attackType`);
        if (!VALID_ATTACK.has(at)) err(`Classes[${cls}].attackType 必须是 melee/ranged/heal（得到 ${at}）`);
        classes[cls] = {
            attackType: at,
            fireInterval: reqNum(r['fireInterval'], `Classes[${cls}].fireInterval`),
            advanceLimit: reqNum(r['advanceLimit'], `Classes[${cls}].advanceLimit`),
            healPerSec: reqNum(r['healPerSec'], `Classes[${cls}].healPerSec`),
            size: reqNum(r['size'], `Classes[${cls}].size`),
        };
    }

    // —— Levels（拍平行 → 嵌套 Level[]）——
    const { rows: lvlRows } = sheetToRows(wb, 'Levels');
    // 先按 levelIndex 聚合（同时校验同关 levelName/dropGroup/enemyScale 一致、同波 distance 一致）
    const levelMap = new Map<number, { name: string; dropGroup: string; enemyScale: number; waves: Map<number, { spawns: unknown[]; distance: number }> }>();
    for (const r of lvlRows) {
        const li = reqNum(r['levelIndex'], `Levels.levelIndex`);
        const name = reqStr(r['levelName'], `Levels@level${li}.levelName`);
        const distance = reqNum(r['distance'], `Levels@level${li}.distance`);
        if (distance < 0) err(`Levels@level${li}.distance = ${distance} 不可为负`);
        const dropGroup = reqStr(r['dropGroup'], `Levels@level${li}.dropGroup`);
        // enemyScale：本关怪物 hp/atk 统一缩放（难度导出列，2026-07-12）；缺省 1
        const enemyScale = num(r['enemyScale']) ?? 1;
        if (enemyScale <= 0) err(`Levels@level${li}.enemyScale = ${enemyScale} 必须 > 0`);
        const wi = reqNum(r['waveIndex'], `Levels@level${li} wave${r['waveIndex']}.waveIndex`);
        const type = reqStr(r['type'], `Levels@level${li} wave${wi}.type`);
        const count = reqNum(r['count'], `Levels@level${li} wave${wi}.count`);
        const interval = reqNum(r['interval'], `Levels@level${li} wave${wi}.interval`);
        if (!knownEnemyTypes.has(type)) err(`Levels@level${li} wave${wi}: type "${type}" 在 EnemyTypes 里不存在`);
        if (count < 1) warn(`Levels@level${li} wave${wi}: count = ${count}（应 ≥ 1，否则该组不出怪）`);
        if (interval <= 0) warn(`Levels@level${li} wave${wi}: interval = ${interval}（应 > 0，否则每帧出怪）`);
        const hpCell = num(r['hp']);

        let lvl = levelMap.get(li);
        if (!lvl) {
            lvl = { name, dropGroup, enemyScale, waves: new Map() };
            levelMap.set(li, lvl);
        } else {
            // 同关一致性
            if (lvl.name !== name) err(`Levels: level${li} 的 levelName 不一致（${lvl.name} vs ${name}）`);
            if (lvl.dropGroup !== dropGroup) err(`Levels: level${li} 的 dropGroup 不一致（${lvl.dropGroup} vs ${dropGroup}）`);
            if (lvl.enemyScale !== enemyScale) err(`Levels: level${li} 的 enemyScale 不一致（${lvl.enemyScale} vs ${enemyScale}）`);
        }
        let wv = lvl.waves.get(wi);
        if (!wv) { wv = { spawns: [], distance }; lvl.waves.set(wi, wv); }
        else if (wv.distance !== distance) err(`Levels@level${li} wave${wi}: distance 不一致（${wv.distance} vs ${distance}）`);
        const group: Record<string, unknown> = { type, count, interval };
        if (hpCell !== null) group.hp = hpCell;   // 空 → 不带 hp 字段
        wv.spawns.push(group);
    }
    // 按 levelIndex 数值排序（不靠 Excel 行顺序），并校验从 0 连续递增——
    // 因为 BattleManager 是按数组下标取关（levels[levelIndex]），跳号/乱序会让选关错位。
    const sortedLi = [...levelMap.keys()].sort((a, b) => a - b);
    sortedLi.forEach((li, idx) => {
        if (li !== idx) err(`Levels: levelIndex 必须从 0 连续递增（期望 ${idx}，得到 ${li}）`);
    });
    const levels = sortedLi.map(li => {
        const lvl = levelMap.get(li)!;
        // wave 同样按 waveIndex 排序 + 校验连续
        const wiSorted = [...lvl.waves.keys()].sort((a, b) => a - b);
        wiSorted.forEach((wi, idx) => {
            if (wi !== idx) err(`Levels@level${li}: waveIndex 必须从 0 连续递增（期望 ${idx}，得到 ${wi}）`);
        });
        const waves = wiSorted.map(wi => {
            const wv = lvl.waves.get(wi)!;
            return { spawns: wv.spawns, distance: wv.distance };
        });
        return { name: lvl.name, dropGroup: lvl.dropGroup, enemyScale: lvl.enemyScale, waves };
    });
    if (levels.length === 0) err('Levels: 没有任何关卡');

    // —— Misc（点分 key → 嵌套）——
    const { rows: miscRows } = sheetToRows(wb, 'Misc');
    const misc: Record<string, unknown> = {};
    const miscKeys = new Set<string>();
    for (const r of miscRows) {
        const key = reqStr(r['key'], `Misc.key`);
        if (miscKeys.has(key)) err(`Misc: key "${key}" 重复定义`);
        miscKeys.add(key);
        const v = r['value'];
        const n = num(v);
        setPath(misc, key, n !== null ? n : v);   // 是数字就用数字，否则原样（字符串）
    }
    // 必填键校验：缺了会让游戏代码读到 undefined（如 combat.minDamageRate 缺失 → 伤害 NaN）
    const MISC_REQUIRED = ['startLevel', 'combat.minDamageRate', 'layout.frontMargin',
        'layout.spacing', 'bullet.speed', 'bullet.radius', 'formation.contactGap'];
    for (const k of MISC_REQUIRED) if (!miscKeys.has(k)) err(`Misc: 缺少必填 key "${k}"`);

    // —— Scene（点分 key → 嵌套；颜色列自动判定：值是 "r,g,b" 字符串就转数组）——
    const { rows: sceneRows } = sheetToRows(wb, 'Scene');
    const scene: Record<string, unknown> = {};
    const sceneKeys = new Set<string>();
    for (const r of sceneRows) {
        const key = reqStr(r['key'], `Scene.key`);
        if (sceneKeys.has(key)) err(`Scene: key "${key}" 重复定义`);
        sceneKeys.add(key);
        const v = r['value'];
        const s = String(v ?? '');
        // 颜色判定：形如 "数字,数字,数字"
        if (/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(s)) {
            setPath(scene, key, parseColor(v, `Scene.${key}`));
        } else {
            const n = num(v);
            setPath(scene, key, n !== null ? n : reqStr(v, `Scene.${key}`));
        }
    }
    const SCENE_REQUIRED = ['horizonY', 'skyTop', 'skyBottom', 'groundTop', 'groundBottom',
        'cloud.count', 'cloud.color', 'cloud.speed', 'hill.color', 'hill.speed', 'groundScroll'];
    for (const k of SCENE_REQUIRED) if (!sceneKeys.has(k)) err(`Scene: 缺少必填 key "${k}"`);

    // —— roster：默认用 Stats 表行顺序；Misc.roster 可临时指定当前出战阵容（逗号分隔）——
    const rosterText = misc['roster'];
    const roster = rosterText === undefined || rosterText === ''
        ? statsRows.map(r => reqStr(r['class'], `Stats(用于 roster)`))
        : String(rosterText).split(',').map(s => s.trim()).filter(Boolean);
    if (roster.length === 0) err('roster: 至少需要 1 个职业');

    // —— 引用完整性：roster 里每个职业都必须在 Stats 和 Classes 同时有定义 ——
    // （_setupSquad 同时读 stats[cls] 和 classes[cls]，缺一边会运行时崩）
    const statsKeys = new Set(Object.keys(stats));
    const classKeys = new Set(Object.keys(classes));
    for (const cls of roster) {
        if (!statsKeys.has(cls)) err(`一致性: roster 职业 "${cls}" 在 Stats 缺失`);
        if (!classKeys.has(cls)) err(`一致性: roster 职业 "${cls}" 在 Classes 缺失`);
    }
    for (const cls of classKeys) {
        if (!statsKeys.has(cls)) err(`一致性: 职业 "${cls}" 在 Classes 有、Stats 缺失`);
    }

    // —— 组装最终对象 ——
    const config = {
        stats,
        enemyTypes,
        levels,
        startLevel: misc['startLevel'] ?? 0,
        squadCap: misc['squadCap'] ?? 2,
        charGrowth: misc['charGrowth'] ?? {},
        combat: misc['combat'] ?? {},
        classes,
        roster,
        layout: misc['layout'] ?? {},
        bullet: misc['bullet'] ?? {},
        formation: misc['formation'] ?? {},
        scene,
    };

    const summary = `stats=${Object.keys(stats).length} enemyTypes=${Object.keys(enemyTypes).length} ` +
        `classes=${Object.keys(classes).length} levels=${levels.length} roster=${roster.length}`;
    return { config, summary };
}

// ============ equip 模块解析器 ============
// 读 equip.xlsx 的 3 sheet → 装备属性配置。结构：
// qualities[quality] = { label, multiplier, rollMin, rollMax, extraStats }
// slotBonuses[slot][stat] = baseValue
// affixes[] = { stat, value }
function buildEquipConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_QUALITIES = new Set(['common', 'fine', 'rare', 'epic', 'legend']);
    const VALID_SLOTS = new Set(['weapon', 'helmet', 'chest', 'pants', 'shoes']);

    const { rows: qualityRows } = sheetToRows(wb, 'Qualities');
    const qualities: Record<string, unknown> = {};
    const qualityKeys = new Set<string>();
    for (const r of qualityRows) {
        const q = reqStr(r['quality'], 'Qualities.quality');
        if (!VALID_QUALITIES.has(q)) err(`Qualities: quality "${q}" 非法`);
        if (qualityKeys.has(q)) err(`Qualities: quality "${q}" 重复定义`);
        qualityKeys.add(q);
        const multiplier = reqNum(r['multiplier'], `Qualities[${q}].multiplier`);
        const rollMin = reqNum(r['rollMin'], `Qualities[${q}].rollMin`);
        const rollMax = reqNum(r['rollMax'], `Qualities[${q}].rollMax`);
        const extraStats = reqNum(r['extraStats'], `Qualities[${q}].extraStats`);
        if (multiplier <= 0) warn(`Qualities[${q}].multiplier = ${multiplier} 应 > 0`);
        if (rollMin <= 0 || rollMax <= 0 || rollMin > rollMax) err(`Qualities[${q}]: rollMin/rollMax 必须 >0 且 min<=max`);
        if (extraStats < 0) warn(`Qualities[${q}].extraStats = ${extraStats} 为负`);
        qualities[q] = {
            label: reqStr(r['label'], `Qualities[${q}].label`),
            multiplier,
            rollMin,
            rollMax,
            extraStats,
        };
    }
    for (const q of VALID_QUALITIES) if (!qualityKeys.has(q)) err(`Qualities: 缺少品质 "${q}"`);

    const { rows: bonusRows } = sheetToRows(wb, 'SlotBonuses');
    const slotBonuses: Record<string, Record<string, number>> = {};
    let bonusCount = 0;
    for (const r of bonusRows) {
        const slot = reqStr(r['slot'], 'SlotBonuses.slot');
        const stat = reqStr(r['stat'], `SlotBonuses[${slot}].stat`);
        const value = reqNum(r['value'], `SlotBonuses[${slot}.${stat}].value`);
        if (!VALID_SLOTS.has(slot)) err(`SlotBonuses: slot "${slot}" 非法`);
        if (!EQUIP_STAT_KEY_SET.has(stat)) err(`SlotBonuses: stat "${stat}" 不是合法装备属性键`);
        if (value < 0) warn(`SlotBonuses[${slot}.${stat}].value = ${value} 为负`);
        if (!slotBonuses[slot]) slotBonuses[slot] = {};
        if (slotBonuses[slot][stat] !== undefined) err(`SlotBonuses: ${slot}.${stat} 重复定义`);
        slotBonuses[slot][stat] = value;
        bonusCount++;
    }
    for (const slot of VALID_SLOTS) if (!slotBonuses[slot]) err(`SlotBonuses: 缺少部位 "${slot}"`);

    const { rows: affixRows } = sheetToRows(wb, 'Affixes');
    const affixes: unknown[] = [];
    const affixStats = new Set<string>();
    for (const r of affixRows) {
        const stat = reqStr(r['stat'], 'Affixes.stat');
        const value = reqNum(r['value'], `Affixes[${stat}].value`);
        if (!EQUIP_STAT_KEY_SET.has(stat)) err(`Affixes: stat "${stat}" 不是合法装备属性键`);
        if (value <= 0) warn(`Affixes[${stat}].value = ${value} 应 > 0`);
        if (affixStats.has(stat)) err(`Affixes: stat "${stat}" 重复定义`);
        affixStats.add(stat);
        affixes.push({ stat, value });
    }
    if (affixes.length === 0) err('Affixes: 至少需要 1 条可抽取词条');

    const { rows: levelScalingRows } = sheetToRows(wb, 'LevelScaling');
    const levelScaling: Record<string, number> = {};
    const levelScalingKeys = new Set<string>();
    for (const r of levelScalingRows) {
        const key = reqStr(r['key'], 'LevelScaling.key');
        if (levelScalingKeys.has(key)) err(`LevelScaling: key "${key}" 重复定义`);
        levelScalingKeys.add(key);
        levelScaling[key] = reqNum(r['value'], `LevelScaling[${key}].value`);
    }
    const LEVEL_SCALING_REQUIRED = ['growthPerLevel', 'maxLevel'];
    for (const k of LEVEL_SCALING_REQUIRED) if (!levelScalingKeys.has(k)) err(`LevelScaling: 缺少必填 key "${k}"`);
    if ((levelScaling.growthPerLevel ?? 0) < 0) warn(`LevelScaling.growthPerLevel = ${levelScaling.growthPerLevel} 为负`);
    if ((levelScaling.maxLevel ?? 0) < 1) err(`LevelScaling.maxLevel = ${levelScaling.maxLevel} 必须 >= 1`);

    const config = {
        qualities,
        slotBonuses,
        affixes,
        levelScaling: {
            growthPerLevel: levelScaling.growthPerLevel,
            maxLevel: levelScaling.maxLevel,
        },
    };
    const summary = `qualities=${Object.keys(qualities).length} slots=${Object.keys(slotBonuses).length} bonuses=${bonusCount} affixes=${affixes.length} maxLevel=${levelScaling.maxLevel}`;
    return { config, summary };
}

// ============ drop 模块解析器 ============
// 读 drop.xlsx 的 3 sheet → 掉落配置。
// DropGroups: group, itemCount, qualityGroup, slotGroup
// QualityWeights: group, quality, weight
// SlotWeights: group, slot, weight
function buildDropConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_QUALITIES = ['common', 'fine', 'rare', 'epic', 'legend'];
    const VALID_SLOTS = ['weapon', 'helmet', 'chest', 'pants', 'shoes'];
    const validQualitySet = new Set(VALID_QUALITIES);
    const validSlotSet = new Set(VALID_SLOTS);

    const { rows: groupRows } = sheetToRows(wb, 'DropGroups');
    const groupDefs: Record<string, { itemCount: number; qualityGroup: string; slotGroup: string; levelMin: number; levelMax: number }> = {};
    for (const r of groupRows) {
        const group = reqStr(r['group'], 'DropGroups.group');
        if (groupDefs[group]) err(`DropGroups: group "${group}" 重复定义`);
        const itemCount = reqNum(r['itemCount'], `DropGroups[${group}].itemCount`);
        if (itemCount < 1) warn(`DropGroups[${group}].itemCount = ${itemCount}（胜利奖励通常应 ≥ 1）`);
        const levelMin = reqNum(r['levelMin'], `DropGroups[${group}].levelMin`);
        const levelMax = reqNum(r['levelMax'], `DropGroups[${group}].levelMax`);
        if (levelMin < 1) err(`DropGroups[${group}].levelMin 必须 >= 1`);
        if (levelMax < levelMin) err(`DropGroups[${group}]: levelMax 必须 >= levelMin`);
        groupDefs[group] = {
            itemCount,
            qualityGroup: reqStr(r['qualityGroup'], `DropGroups[${group}].qualityGroup`),
            slotGroup: reqStr(r['slotGroup'], `DropGroups[${group}].slotGroup`),
            levelMin,
            levelMax,
        };
    }
    if (Object.keys(groupDefs).length === 0) err('DropGroups: 至少需要 1 个掉落组');

    const { rows: qualityRows } = sheetToRows(wb, 'QualityWeights');
    const qualityWeightGroups: Record<string, Record<string, number>> = {};
    const qualitySeen = new Set<string>();
    for (const r of qualityRows) {
        const group = reqStr(r['group'], 'QualityWeights.group');
        const quality = reqStr(r['quality'], `QualityWeights[${group}].quality`);
        const key = `${group}.${quality}`;
        if (!validQualitySet.has(quality)) err(`QualityWeights[${group}]: quality "${quality}" 非法`);
        if (qualitySeen.has(key)) err(`QualityWeights: ${key} 重复定义`);
        qualitySeen.add(key);
        const weight = reqNum(r['weight'], `QualityWeights[${key}].weight`);
        if (weight < 0) err(`QualityWeights[${key}].weight 不可为负`);
        if (!qualityWeightGroups[group]) qualityWeightGroups[group] = {};
        qualityWeightGroups[group][quality] = weight;
    }

    const { rows: slotRows } = sheetToRows(wb, 'SlotWeights');
    const slotWeightGroups: Record<string, Record<string, number>> = {};
    const slotSeen = new Set<string>();
    for (const r of slotRows) {
        const group = reqStr(r['group'], 'SlotWeights.group');
        const slot = reqStr(r['slot'], `SlotWeights[${group}].slot`);
        const key = `${group}.${slot}`;
        if (!validSlotSet.has(slot)) err(`SlotWeights[${group}]: slot "${slot}" 非法`);
        if (slotSeen.has(key)) err(`SlotWeights: ${key} 重复定义`);
        slotSeen.add(key);
        const weight = reqNum(r['weight'], `SlotWeights[${key}].weight`);
        if (weight < 0) err(`SlotWeights[${key}].weight 不可为负`);
        if (!slotWeightGroups[group]) slotWeightGroups[group] = {};
        slotWeightGroups[group][slot] = weight;
    }

    function completeWeights(kind: 'QualityWeights' | 'SlotWeights', group: string, keys: string[], src: Record<string, Record<string, number>>) {
        const found = src[group];
        if (!found) {
            err(`${kind}: 缺少权重组 "${group}"`);
            return Object.fromEntries(keys.map(k => [k, 0]));
        }
        const out: Record<string, number> = {};
        let total = 0;
        for (const k of keys) {
            if (found[k] === undefined) err(`${kind}[${group}]: 缺少 "${k}" 权重`);
            const weight = found[k] ?? 0;
            out[k] = weight;
            total += Math.max(0, weight);
        }
        if (total <= 0) err(`${kind}[${group}]: 权重总和必须 > 0`);
        return out;
    }

    const groups: Record<string, unknown> = {};
    for (const [group, def] of Object.entries(groupDefs)) {
        groups[group] = {
            itemCount: def.itemCount,
            levelMin: def.levelMin,
            levelMax: def.levelMax,
            qualityWeights: completeWeights('QualityWeights', def.qualityGroup, VALID_QUALITIES, qualityWeightGroups),
            slotWeights: completeWeights('SlotWeights', def.slotGroup, VALID_SLOTS, slotWeightGroups),
        };
    }

    const config = { groups };
    const summary = `groups=${Object.keys(groups).length} qualityWeightGroups=${Object.keys(qualityWeightGroups).length} slotWeightGroups=${Object.keys(slotWeightGroups).length}`;
    return { config, summary };
}

// ============ offline 模块解析器 ============
// 读 offline.xlsx 的 2 sheet → 离线快速战斗配置。
// Global: key, value
// Levels: levelIndex, avgClearSeconds, winRate, goldPerWin, expPerWin
function buildOfflineConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const { rows: globalRows } = sheetToRows(wb, 'Global');
    const global: Record<string, number> = {};
    const globalKeys = new Set<string>();
    for (const r of globalRows) {
        const key = reqStr(r['key'], 'Global.key');
        if (globalKeys.has(key)) err(`Global: key "${key}" 重复定义`);
        globalKeys.add(key);
        global[key] = reqNum(r['value'], `Global[${key}].value`);
    }
    const GLOBAL_REQUIRED = ['maxHours', 'efficiency', 'maxBattles'];
    for (const k of GLOBAL_REQUIRED) if (!globalKeys.has(k)) err(`Global: 缺少必填 key "${k}"`);
    if ((global.maxHours ?? 0) < 0) err(`Global.maxHours = ${global.maxHours} 不可为负`);
    if ((global.efficiency ?? 0) < 0) err(`Global.efficiency = ${global.efficiency} 不可为负`);
    if ((global.efficiency ?? 0) > 1) warn(`Global.efficiency = ${global.efficiency} 大于 1（离线效率通常 ≤ 1）`);
    if ((global.maxBattles ?? 0) < 0) err(`Global.maxBattles = ${global.maxBattles} 不可为负`);

    const { rows: levelRows } = sheetToRows(wb, 'Levels');
    const levelMap = new Map<number, unknown>();
    for (const r of levelRows) {
        const levelIndex = reqNum(r['levelIndex'], 'Levels.levelIndex');
        if (levelMap.has(levelIndex)) err(`Levels: levelIndex "${levelIndex}" 重复定义`);
        const avgClearSeconds = reqNum(r['avgClearSeconds'], `Levels[${levelIndex}].avgClearSeconds`);
        const winRate = reqNum(r['winRate'], `Levels[${levelIndex}].winRate`);
        const goldPerWin = reqNum(r['goldPerWin'], `Levels[${levelIndex}].goldPerWin`);
        const expPerWin = reqNum(r['expPerWin'], `Levels[${levelIndex}].expPerWin`);
        if (avgClearSeconds <= 0) err(`Levels[${levelIndex}].avgClearSeconds 必须 > 0`);
        if (winRate < 0 || winRate > 1) warn(`Levels[${levelIndex}].winRate = ${winRate} 超出 [0,1]`);
        if (goldPerWin < 0) warn(`Levels[${levelIndex}].goldPerWin = ${goldPerWin} 为负`);
        if (expPerWin < 0) warn(`Levels[${levelIndex}].expPerWin = ${expPerWin} 为负`);
        levelMap.set(levelIndex, {
            avgClearSeconds,
            winRate,
            goldPerWin,
            expPerWin,
        });
    }
    if (levelMap.size === 0) err('Levels: 至少需要 1 行离线关卡配置');
    const sortedLevels = [...levelMap.keys()].sort((a, b) => a - b);
    sortedLevels.forEach((li, idx) => {
        if (li !== idx) err(`Levels: levelIndex 必须从 0 连续递增（期望 ${idx}，得到 ${li}）`);
    });
    const levels = sortedLevels.map(li => levelMap.get(li));

    const config = {
        global: {
            maxHours: global.maxHours ?? 8,
            efficiency: global.efficiency ?? 0.7,
            maxBattles: global.maxBattles ?? 240,
        },
        levels,
    };
    const summary = `levels=${levels.length} maxHours=${config.global.maxHours}`;
    return { config, summary };
}

// ============ chest 模块解析器 ============
// 读 chest.xlsx 的 2 sheet → 宝箱掉落配置。
// Groups: group, mobChance, finalChance, mobWeightGroup, finalWeightGroup
// TypeWeights: group, type, weight
function buildChestConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_CHESTS = ['normal', 'boss', 'chapter'];
    const validChestSet = new Set(VALID_CHESTS);

    const { rows: groupRows } = sheetToRows(wb, 'Groups');
    const groups: Record<string, unknown> = {};
    const usedWeightGroups = new Set<string>();
    for (const r of groupRows) {
        const group = reqStr(r['group'], 'Groups.group');
        if (groups[group]) err(`Groups: group "${group}" 重复定义`);
        const mobChance = reqNum(r['mobChance'], `Groups[${group}].mobChance`);
        const finalChance = reqNum(r['finalChance'], `Groups[${group}].finalChance`);
        if (mobChance < 0 || mobChance > 1) warn(`Groups[${group}].mobChance = ${mobChance} 超出 [0,1]`);
        if (finalChance < 0 || finalChance > 1) warn(`Groups[${group}].finalChance = ${finalChance} 超出 [0,1]`);
        const mobWeightGroup = reqStr(r['mobWeightGroup'], `Groups[${group}].mobWeightGroup`);
        const finalWeightGroup = reqStr(r['finalWeightGroup'], `Groups[${group}].finalWeightGroup`);
        usedWeightGroups.add(mobWeightGroup);
        usedWeightGroups.add(finalWeightGroup);
        groups[group] = { mobChance, finalChance, mobWeightGroup, finalWeightGroup };
    }
    if (Object.keys(groups).length === 0) err('Groups: 至少需要 1 个宝箱掉落组');

    const { rows: weightRows } = sheetToRows(wb, 'TypeWeights');
    const typeWeights: Record<string, Record<string, number>> = {};
    const seen = new Set<string>();
    for (const r of weightRows) {
        const group = reqStr(r['group'], 'TypeWeights.group');
        const type = reqStr(r['type'], `TypeWeights[${group}].type`);
        const key = `${group}.${type}`;
        if (!validChestSet.has(type)) err(`TypeWeights[${group}]: type "${type}" 非法`);
        if (seen.has(key)) err(`TypeWeights: ${key} 重复定义`);
        seen.add(key);
        const weight = reqNum(r['weight'], `TypeWeights[${key}].weight`);
        if (weight < 0) err(`TypeWeights[${key}].weight 不可为负`);
        if (!typeWeights[group]) typeWeights[group] = {};
        typeWeights[group][type] = weight;
    }

    for (const group of usedWeightGroups) {
        const weights = typeWeights[group];
        if (!weights) {
            err(`TypeWeights: 缺少权重组 "${group}"`);
            continue;
        }
        let total = 0;
        for (const type of VALID_CHESTS) total += Math.max(0, weights[type] ?? 0);
        if (total <= 0) err(`TypeWeights[${group}]: 权重总和必须 > 0`);
    }

    // Rewards：开箱内容档案（2026-07-11 表化，取代 ChestService.CHEST_REWARD_PROFILE 硬编码）
    const { rows: rewardRows } = sheetToRows(wb, 'Rewards');
    const rewards: Record<string, unknown> = {};
    for (const r of rewardRows) {
        const chestType = reqStr(r['chestType'], 'Rewards.chestType');
        if (!validChestSet.has(chestType)) err(`Rewards: chestType "${chestType}" 非法`);
        if (rewards[chestType]) err(`Rewards: chestType "${chestType}" 重复定义`);
        const nums: Record<string, number> = {};
        for (const k of ['equipmentRolls', 'forgeStoneMin', 'forgeStoneMax', 'gemCount', 'gemLevelMin', 'gemLevelMax', 'scrollMin', 'scrollMax']) {
            nums[k] = reqNum(r[k], `Rewards[${chestType}].${k}`);
            if (nums[k] < 0) err(`Rewards[${chestType}].${k} 不可为负`);
        }
        if (nums['forgeStoneMin'] > nums['forgeStoneMax']) err(`Rewards[${chestType}]: forgeStoneMin > forgeStoneMax`);
        if (nums['gemLevelMin'] > nums['gemLevelMax']) err(`Rewards[${chestType}]: gemLevelMin > gemLevelMax`);
        if (nums['scrollMin'] > nums['scrollMax']) err(`Rewards[${chestType}]: scrollMin > scrollMax`);
        rewards[chestType] = nums;
    }
    for (const t of VALID_CHESTS) if (!rewards[t]) err(`Rewards: 缺少箱型 "${t}"`);

    const config = { groups, typeWeights, rewards };
    const summary = `groups=${Object.keys(groups).length} typeWeightGroups=${Object.keys(typeWeights).length} rewards=${Object.keys(rewards).length}`;
    return { config, summary };
}

// ============ craft 模块解析器 ============
// 读 craft.xlsx 的 2 sheet → 合成配置。
// Tiers: tierId, label, levelMin, levelMax, costForgeStone
// QualityWeights: tierId, quality, weight
function buildCraftConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_QUALITIES = ['common', 'fine', 'rare', 'epic', 'legend'];
    const validQualitySet = new Set(VALID_QUALITIES);
    const MATERIAL_COLUMNS: [string, string][] = [
        ['forge_stone', 'costForgeStone'],
    ];

    const { rows: tierRows } = sheetToRows(wb, 'Tiers');
    const tierDefs: Record<string, { label: string; levelMin: number; levelMax: number; cost: Record<string, number> }> = {};
    for (const r of tierRows) {
        const tierId = reqStr(r['tierId'], 'Tiers.tierId');
        if (tierDefs[tierId]) err(`Tiers: tierId "${tierId}" 重复定义`);
        const levelMin = reqNum(r['levelMin'], `Tiers[${tierId}].levelMin`);
        const levelMax = reqNum(r['levelMax'], `Tiers[${tierId}].levelMax`);
        if (levelMin < 1) err(`Tiers[${tierId}].levelMin 必须 >= 1`);
        if (levelMax < levelMin) err(`Tiers[${tierId}]: levelMax 必须 >= levelMin`);
        const cost: Record<string, number> = {};
        for (const [materialId, col] of MATERIAL_COLUMNS) {
            const value = reqNum(r[col], `Tiers[${tierId}].${col}`);
            if (value < 0) err(`Tiers[${tierId}].${col} 不可为负`);
            if (value > 0) cost[materialId] = value;
        }
        tierDefs[tierId] = {
            label: reqStr(r['label'], `Tiers[${tierId}].label`),
            levelMin,
            levelMax,
            cost,
        };
    }
    if (Object.keys(tierDefs).length === 0) err('Tiers: 至少需要 1 个合成档位');

    const { rows: weightRows } = sheetToRows(wb, 'QualityWeights');
    const qualityWeightsByTier: Record<string, Record<string, number>> = {};
    const seen = new Set<string>();
    for (const r of weightRows) {
        const tierId = reqStr(r['tierId'], 'QualityWeights.tierId');
        const quality = reqStr(r['quality'], `QualityWeights[${tierId}].quality`);
        const key = `${tierId}.${quality}`;
        if (!validQualitySet.has(quality)) err(`QualityWeights[${tierId}]: quality "${quality}" 非法`);
        if (seen.has(key)) err(`QualityWeights: ${key} 重复定义`);
        seen.add(key);
        const weight = reqNum(r['weight'], `QualityWeights[${key}].weight`);
        if (weight < 0) err(`QualityWeights[${key}].weight 不可为负`);
        if (!qualityWeightsByTier[tierId]) qualityWeightsByTier[tierId] = {};
        qualityWeightsByTier[tierId][quality] = weight;
    }

    const tiers: Record<string, unknown> = {};
    for (const [tierId, def] of Object.entries(tierDefs)) {
        const weights = qualityWeightsByTier[tierId];
        if (!weights) {
            err(`QualityWeights: 缺少档位 "${tierId}"`);
            continue;
        }
        const out: Record<string, number> = {};
        let total = 0;
        for (const q of VALID_QUALITIES) {
            if (weights[q] === undefined) err(`QualityWeights[${tierId}]: 缺少 "${q}" 权重`);
            const w = weights[q] ?? 0;
            out[q] = w;
            total += Math.max(0, w);
        }
        if (total <= 0) err(`QualityWeights[${tierId}]: 权重总和必须 > 0`);
        tiers[tierId] = { label: def.label, levelMin: def.levelMin, levelMax: def.levelMax, cost: def.cost, qualityWeights: out };
    }

    const config = { tiers };
    const summary = `tiers=${Object.keys(tiers).length}`;
    return { config, summary };
}

// ============ buff 模块解析器 ============
// 读 buff.xlsx 的 Buffs sheet → Buff 定义；periodicEffect/statMods 用 EffectTypes 编码解析。
// knownBuffIds 供 skill 源跨表校验 applyBuff 引用（SOURCES 里 buff 必须排在 skill 前）。
// Buffs: id, name, duration, maxStacks, stackRule, period, periodicEffect, statMods, flags, dispelTag
const knownBuffIds = new Set<string>();

function buildBuffConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_STACK_RULES = new Set(['refresh', 'add']);
    const VALID_FLAGS = new Set(['stun', 'taunt', 'silence']);

    const { rows } = sheetToRows(wb, 'Buffs');
    const buffs: unknown[] = [];
    knownBuffIds.clear();
    for (const r of rows) {
        const id = reqStr(r['id'], 'Buffs.id');
        if (knownBuffIds.has(id)) err(`Buffs: id "${id}" 重复定义`);
        knownBuffIds.add(id);
        const duration = reqNum(r['duration'], `Buffs[${id}].duration`);
        if (duration <= 0 && duration !== -1) err(`Buffs[${id}].duration 必须 > 0（或 -1 表示永久）`);
        const maxStacks = reqNum(r['maxStacks'], `Buffs[${id}].maxStacks`);
        if (maxStacks < 1) err(`Buffs[${id}].maxStacks 必须 >= 1`);
        const stackRule = reqStr(r['stackRule'], `Buffs[${id}].stackRule`);
        if (!VALID_STACK_RULES.has(stackRule)) err(`Buffs[${id}].stackRule "${stackRule}" 非法（refresh/add）`);
        const period = num(r['period']) ?? 0;
        const periodicList = parseEffectList(String(r['periodicEffect'] ?? ''), m => err(`Buffs[${id}].periodicEffect: ${m}`));
        if (period > 0 && periodicList.length === 0) err(`Buffs[${id}]: period>0 但没有 periodicEffect`);
        if (period <= 0 && periodicList.length > 0) err(`Buffs[${id}]: 有 periodicEffect 但 period<=0`);
        if (periodicList.length > 1) err(`Buffs[${id}].periodicEffect 只允许一个效果`);
        const statMods = parseStatMods(String(r['statMods'] ?? ''), m => err(`Buffs[${id}].statMods: ${m}`));
        const flags = String(r['flags'] ?? '').split('|').map(s => s.trim()).filter(Boolean);
        for (const f of flags) if (!VALID_FLAGS.has(f)) err(`Buffs[${id}].flags: 未知标记 "${f}"（stun/taunt/silence）`);
        buffs.push({
            id, name: reqStr(r['name'], `Buffs[${id}].name`),
            duration, maxStacks, stackRule, period,
            periodicEffect: periodicList[0] ?? null,
            statMods, flags, dispelTag: String(r['dispelTag'] ?? ''),
        });
    }
    if (buffs.length === 0) err('Buffs: 至少需要 1 个 buff');
    const config = { buffs };
    const summary = `buffs=${buffs.length}`;
    return { config, summary };
}

// ============ skill 模块解析器 ============
// 读 skill.xlsx 的 1 sheet → 技能配置（保持行顺序，UI 按顺序对应按钮）。
// Skills: id, name, cls, trigger, triggerValue, target, radius, maxTargets, dmgMult
function buildSkillConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_CLASSES = new Set(['tank', 'dps', 'healer']);   // 与 BattleConfig.SoldierClass 手写 union 对齐
    const VALID_TRIGGERS = new Set(['timer', 'attackCount']);
    const VALID_TARGETS = new Set(['aoe', 'nearest', 'single']);
    const VALID_PASSIVE_TRIGGERS = new Set(['always', 'onHit', 'onHurt', 'onKill', 'onCast']);
    const VALID_TARGET_MODES = new Set(['trigger', 'self', 'team']);
    const SLOT_CAP = 2;   // 每职业主/被动合计槽位上限

    const { rows } = sheetToRows(wb, 'Skills');
    const skills: unknown[] = [];
    const passives: unknown[] = [];
    const seen = new Set<string>();
    const slotCount = new Map<string, number>();
    for (const r of rows) {
        const id = reqStr(r['id'], 'Skills.id');
        if (seen.has(id)) err(`Skills: id "${id}" 重复定义`);
        seen.add(id);
        const cls = reqStr(r['cls'], `Skills[${id}].cls`);
        if (!VALID_CLASSES.has(cls)) err(`Skills[${id}]: cls "${cls}" 非法（须为 tank/dps/healer）`);
        slotCount.set(cls, (slotCount.get(cls) ?? 0) + 1);
        if ((slotCount.get(cls) ?? 0) > SLOT_CAP) err(`Skills: 职业 "${cls}" 超过 ${SLOT_CAP} 个技能槽`);
        const kind = reqStr(r['kind'], `Skills[${id}].kind`);
        const name = reqStr(r['name'], `Skills[${id}].name`);

        // 效果列表两类通用：非空 + applyBuff 跨表校验 + damage 倍率
        const effects = parseEffectList(String(r['effects'] ?? ''), m => err(`Skills[${id}].effects: ${m}`));
        if (effects.length === 0) err(`Skills[${id}].effects 至少需要一个效果`);
        for (const eff of effects) {
            if (eff.kind === 'applyBuff' && !knownBuffIds.has(eff.buffId)) {
                err(`Skills[${id}].effects: applyBuff 引用了不存在的 buff "${eff.buffId}"（见 buff.xlsx）`);
            }
            if (eff.kind === 'damage' && eff.mult <= 0) err(`Skills[${id}].effects: damage 倍率必须 > 0`);
        }

        if (kind === 'active') {
            for (const col of ['passiveTrigger', 'chance', 'targetMode']) {
                if (String(r[col] ?? '').trim() !== '') err(`Skills[${id}]: 主动技能的被动列 ${col} 必须为空`);
            }
            const trigger = reqStr(r['trigger'], `Skills[${id}].trigger`);
            if (!VALID_TRIGGERS.has(trigger)) err(`Skills[${id}]: trigger "${trigger}" 非法（timer/attackCount）`);
            const target = reqStr(r['target'], `Skills[${id}].target`);
            if (!VALID_TARGETS.has(target)) err(`Skills[${id}]: target "${target}" 非法（aoe/nearest/single）`);
            const triggerValue = reqNum(r['triggerValue'], `Skills[${id}].triggerValue`);
            if (triggerValue <= 0) err(`Skills[${id}].triggerValue 必须 > 0`);
            const radius = reqNum(r['radius'], `Skills[${id}].radius`);
            const maxTargets = reqNum(r['maxTargets'], `Skills[${id}].maxTargets`);
            if (target === 'aoe' && radius <= 0) err(`Skills[${id}]: target=aoe 时 radius 必须 > 0`);
            if (target === 'nearest' && maxTargets <= 0) err(`Skills[${id}]: target=nearest 时 maxTargets 必须 > 0`);
            const delivery = parseDelivery(String(r['delivery'] ?? ''), m => err(`Skills[${id}].delivery: ${m}`));
            skills.push({ id, name, cls, trigger, triggerValue, target, radius, maxTargets, effects, delivery });
        } else if (kind === 'passive') {
            for (const col of ['trigger', 'triggerValue', 'target', 'radius', 'maxTargets', 'delivery']) {
                if (String(r[col] ?? '').trim() !== '') err(`Skills[${id}]: 被动技能的主动列 ${col} 必须为空`);
            }
            const passiveTrigger = reqStr(r['passiveTrigger'], `Skills[${id}].passiveTrigger`);
            if (!VALID_PASSIVE_TRIGGERS.has(passiveTrigger)) err(`Skills[${id}].passiveTrigger "${passiveTrigger}" 非法（always/onHit/onHurt/onKill/onCast）`);
            const chance = reqNum(r['chance'], `Skills[${id}].chance`);
            if (chance < 0 || chance > 1) err(`Skills[${id}].chance 必须在 [0,1]`);
            if (passiveTrigger === 'always' && chance !== 1) err(`Skills[${id}]: always 被动的 chance 必须为 1`);
            const targetMode = reqStr(r['targetMode'], `Skills[${id}].targetMode`);
            if (!VALID_TARGET_MODES.has(targetMode)) err(`Skills[${id}].targetMode "${targetMode}" 非法（trigger/self/team）`);
            if (passiveTrigger === 'onKill' && targetMode === 'trigger') err(`Skills[${id}]: onKill 被动不可用 targetMode=trigger（被杀者已死）`);
            passives.push({ id, name, cls, trigger: passiveTrigger, chance, targetMode, effects });
        } else {
            err(`Skills[${id}].kind "${kind}" 非法（active/passive）`);
        }
    }
    if (skills.length === 0) err('Skills: 至少需要 1 个主动技能');
    const config = { skills, passives };
    const summary = `skills=${skills.length} passives=${passives.length}`;
    return { config, summary };
}

// ============ inlay 模块解析器 ============
// 读 inlay.xlsx 的 3 sheet → 镶嵌配置。
// Gems: type, label, stat, baseValue, maxLevel
// SocketCounts: quality, gemSockets, inscriptionSlots
// Inscriptions: stat, valueMin, valueMax
function buildInlayConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_GEM_TYPES = new Set(['atk', 'hp', 'def', 'crit', 'dmg']);
    const VALID_QUALITIES = ['common', 'fine', 'rare', 'epic', 'legend'];

    const { rows: gemRows } = sheetToRows(wb, 'Gems');
    const gems: Record<string, unknown> = {};
    const gemKeys = new Set<string>();
    for (const r of gemRows) {
        const type = reqStr(r['type'], 'Gems.type');
        if (!VALID_GEM_TYPES.has(type)) err(`Gems: type "${type}" 非法（须为 atk/hp/def/crit/dmg）`);
        if (gemKeys.has(type)) err(`Gems: type "${type}" 重复定义`);
        gemKeys.add(type);
        const stat = reqStr(r['stat'], `Gems[${type}].stat`);
        if (!EQUIP_STAT_KEY_SET.has(stat)) err(`Gems[${type}]: stat "${stat}" 不是合法装备属性键`);
        const baseValue = reqNum(r['baseValue'], `Gems[${type}].baseValue`);
        if (baseValue <= 0) warn(`Gems[${type}].baseValue = ${baseValue} 应 > 0`);
        const maxLevel = reqNum(r['maxLevel'], `Gems[${type}].maxLevel`);
        if (maxLevel < 1) err(`Gems[${type}].maxLevel 必须 >= 1`);
        if (maxLevel > 6) warn(`Gems[${type}].maxLevel = ${maxLevel} 超过 6：MaterialId 联合类型只覆盖 1~6，需同步拓宽 RewardTypes`);
        // levelRatio 可选：等比价值 baseValue × ratio^(lv-1)；缺省不写字段（运行时按 1 兜底）
        const levelRatio = num(r['levelRatio']);
        if (levelRatio !== null && levelRatio < 1) warn(`Gems[${type}].levelRatio = ${levelRatio} 应 >= 1`);
        gems[type] = {
            label: reqStr(r['label'], `Gems[${type}].label`), stat, baseValue, maxLevel,
            ...(levelRatio !== null ? { levelRatio } : {}),
        };
    }
    if (Object.keys(gems).length === 0) err('Gems: 至少需要 1 个宝石类型');

    const { rows: socketRows } = sheetToRows(wb, 'SocketCounts');
    const socketCounts: Record<string, unknown> = {};
    const socketKeys = new Set<string>();
    for (const r of socketRows) {
        const quality = reqStr(r['quality'], 'SocketCounts.quality');
        if (!VALID_QUALITIES.includes(quality)) err(`SocketCounts: quality "${quality}" 非法`);
        if (socketKeys.has(quality)) err(`SocketCounts: quality "${quality}" 重复定义`);
        socketKeys.add(quality);
        const gemSockets = reqNum(r['gemSockets'], `SocketCounts[${quality}].gemSockets`);
        const inscriptionSlots = reqNum(r['inscriptionSlots'], `SocketCounts[${quality}].inscriptionSlots`);
        if (gemSockets < 0) err(`SocketCounts[${quality}].gemSockets 不可为负`);
        if (inscriptionSlots < 0) err(`SocketCounts[${quality}].inscriptionSlots 不可为负`);
        socketCounts[quality] = { gemSockets, inscriptionSlots };
    }
    for (const q of VALID_QUALITIES) if (!socketKeys.has(q)) err(`SocketCounts: 缺少品质 "${q}"`);

    const { rows: inscRows } = sheetToRows(wb, 'Inscriptions');
    const inscriptions: unknown[] = [];
    for (const r of inscRows) {
        const stat = reqStr(r['stat'], 'Inscriptions.stat');
        if (!EQUIP_STAT_KEY_SET.has(stat)) err(`Inscriptions: stat "${stat}" 不是合法装备属性键`);
        const valueMin = reqNum(r['valueMin'], `Inscriptions[${stat}].valueMin`);
        const valueMax = reqNum(r['valueMax'], `Inscriptions[${stat}].valueMax`);
        if (valueMin <= 0) warn(`Inscriptions[${stat}].valueMin = ${valueMin} 应 > 0`);
        if (valueMax < valueMin) err(`Inscriptions[${stat}]: valueMax 必须 >= valueMin`);
        inscriptions.push({ stat, valueMin, valueMax });
    }
    if (inscriptions.length === 0) err('Inscriptions: 至少需要 1 条铭文效果');

    const config = { gems, socketCounts, inscriptions };
    const summary = `gems=${Object.keys(gems).length} socketCounts=${Object.keys(socketCounts).length} inscriptions=${inscriptions.length}`;
    return { config, summary };
}

// ============ balance 模块解析器 ============
// 读 balance.xlsx 的 4 sheet → 养成框架真源（份额/锚点/上限/例外）。游戏运行时不消费，供 balance-model 求解。
function buildBalanceConfig(wb: XLSX.WorkBook): { config: unknown; summary: string } {
    const VALID_MODULES = ['base', 'level', 'equip', 'gem', 'inscription', 'skill'];

    const { rows: shareRows } = sheetToRows(wb, 'Shares');
    const shares: Record<string, number> = {};
    for (const r of shareRows) {
        const module = reqStr(r['module'], 'Shares.module');
        if (!VALID_MODULES.includes(module)) err(`Shares: module "${module}" 非法`);
        if (shares[module] !== undefined) err(`Shares: module "${module}" 重复定义`);
        const share = reqNum(r['share'], `Shares[${module}].share`);
        if (share < 0 || share > 1) err(`Shares[${module}].share = ${share} 超出 [0,1]`);
        shares[module] = share;
    }
    for (const m of VALID_MODULES) if (shares[m] === undefined) err(`Shares: 缺少模块 "${m}"`);
    const shareSum = VALID_MODULES.reduce((acc, m) => acc + (shares[m] ?? 0), 0);
    if (Math.abs(shareSum - 1) > 1e-9) err(`Shares: 份额合计必须 = 1，实际 ${shareSum}`);

    const readKV = (sheet: string): Record<string, number> => {
        const { rows } = sheetToRows(wb, sheet);
        const out: Record<string, number> = {};
        for (const r of rows) {
            const key = reqStr(r['key'], `${sheet}.key`);
            if (out[key] !== undefined) err(`${sheet}: key "${key}" 重复定义`);
            out[key] = reqNum(r['value'], `${sheet}[${key}].value`);
        }
        return out;
    };
    const anchors = readKV('Anchors');
    const caps = readKV('Caps');
    for (const k of Object.keys(caps)) {
        if (caps[k] <= 0 || caps[k] > 2) warn(`Caps[${k}] = ${caps[k]} 超出常识范围 (0,2]`);
    }

    const { rows: overrideRows } = sheetToRows(wb, 'Overrides');
    const overrides: unknown[] = [];
    for (const r of overrideRows) {
        const target = reqStr(r['target'], 'Overrides.target');
        const value = reqNum(r['value'], `Overrides[${target}].value`);
        const reason = reqStr(r['reason'], `Overrides[${target}].reason`);
        overrides.push({ target, value, reason });
    }

    const config = { shares, anchors, caps, overrides };
    const summary = `shares=${Object.keys(shares).length} anchors=${Object.keys(anchors).length} caps=${Object.keys(caps).length} overrides=${overrides.length}`;
    return { config, summary };
}

// ============ 源清单（加模块就在这里加一行）============
interface ConfigSource {
    name: string;        // 模块名（日志/报错用）
    xlsxRel: string;     // 源 xlsx，相对 tools/
    outRel: string;      // 产物 .ts，相对 tools/
    exportVar: string;   // 产物里 export const 的名字（消费端 import 用）
    typeImport?: { name: string; from: string }; // 可选：声明产物导出类型（import type 不产生运行时环）
    build: (wb: XLSX.WorkBook) => { config: unknown; summary: string };
}
const SOURCES: ConfigSource[] = [
    {
        name: 'battle',
        xlsxRel: 'config-xlsx/battle.xlsx',
        outRel: '../assets/scripts/config/battle.config.generated.ts',
        exportVar: 'generatedBattleConfig',
        typeImport: { name: 'BattleConfigData', from: './BattleConfig' },
        build: buildBattleConfig,
    },
    {
        name: 'equip',
        xlsxRel: 'config-xlsx/equip.xlsx',
        outRel: '../assets/scripts/config/equip.config.generated.ts',
        exportVar: 'generatedEquipConfig',
        build: buildEquipConfig,
    },
    {
        name: 'drop',
        xlsxRel: 'config-xlsx/drop.xlsx',
        outRel: '../assets/scripts/config/drop.config.generated.ts',
        exportVar: 'generatedDropConfig',
        build: buildDropConfig,
    },
    {
        name: 'chest',
        xlsxRel: 'config-xlsx/chest.xlsx',
        outRel: '../assets/scripts/config/chest.config.generated.ts',
        exportVar: 'generatedChestConfig',
        build: buildChestConfig,
    },
    {
        name: 'offline',
        xlsxRel: 'config-xlsx/offline.xlsx',
        outRel: '../assets/scripts/config/offline.config.generated.ts',
        exportVar: 'generatedOfflineConfig',
        build: buildOfflineConfig,
    },
    {
        name: 'craft',
        xlsxRel: 'config-xlsx/craft.xlsx',
        outRel: '../assets/scripts/config/craft.config.generated.ts',
        exportVar: 'generatedCraftConfig',
        build: buildCraftConfig,
    },
    {
        name: 'buff',
        xlsxRel: 'config-xlsx/buff.xlsx',
        outRel: '../assets/scripts/config/buff.config.generated.ts',
        exportVar: 'generatedBuffConfig',
        build: buildBuffConfig,
    },
    {
        name: 'skill',
        xlsxRel: 'config-xlsx/skill.xlsx',
        outRel: '../assets/scripts/config/skill.config.generated.ts',
        exportVar: 'generatedSkillConfig',
        build: buildSkillConfig,
    },
    {
        name: 'inlay',
        xlsxRel: 'config-xlsx/inlay.xlsx',
        outRel: '../assets/scripts/config/inlay.config.generated.ts',
        exportVar: 'generatedInlayConfig',
        build: buildInlayConfig,
    },
    {
        name: 'balance',
        xlsxRel: 'config-xlsx/balance.xlsx',
        outRel: '../assets/scripts/config/balance.config.generated.ts',
        exportVar: 'generatedBalanceConfig',
        build: buildBalanceConfig,
    },
];

// 产物代码模板
function genCode(src: ConfigSource, config: unknown): string {
    const now = new Date().toISOString();
    const typeImport = src.typeImport
        ? `import type { ${src.typeImport.name} } from '${src.typeImport.from}';\n`
        : '';
    const typeAnnotation = src.typeImport ? `: ${src.typeImport.name}` : '';
    const typecheckDirective = src.typeImport ? '' : '// @ts-nocheck\n';
    return `// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/${src.xlsxRel}，然后跑：npm run config
// 源文件：tools/${src.xlsxRel}
// 生成时间：${now}

/* eslint-disable */
${typecheckDirective}${typeImport}export const ${src.exportVar}${typeAnnotation} = ${JSON.stringify(config, null, 4)};
`;
}

// ============ 主流程：遍历所有源依次导出 ============
function main() {
    for (const src of SOURCES) {
        resetIssues();
        const xlsxPath = resolve(__dirname, src.xlsxRel);
        const outPath = resolve(__dirname, src.outRel);
        const wb = XLSX.read(readFileSync(xlsxPath));
        const { config, summary } = src.build(wb);
        reportIssues(src.name);   // 该源有 errors 在此打印全部并退出
        writeFileSync(outPath, genCode(src, config), 'utf-8');
        console.log(`✓ [${src.name}] 已生成 ${outPath}`);
        console.log('  ' + summary);
    }
}

main();
