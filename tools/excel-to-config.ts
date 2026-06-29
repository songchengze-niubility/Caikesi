// Excel → 配置导出脚本（多源驱动）
// 一张「源清单」(SOURCES) 描述：哪个 xlsx → 哪个 parser → 生成哪个产物。
// `npm run config` 会遍历所有源依次导出，每源独立校验、独立产物。
//
// 目前包含 battle/equip/drop 三个模块：
// - tools/config-xlsx/battle.xlsx → battle.config.generated.ts
// - tools/config-xlsx/equip.xlsx  → equip.config.generated.ts
// - tools/config-xlsx/drop.xlsx   → drop.config.generated.ts
// 【加新模块（如掉装备）】：① 写一个 buildXxxConfig(wb) 解析函数；
//   ② 在 SOURCES 末尾加一行 {name,xlsxRel,outRel,exportVar,build}。主流程不用改。
//
// 用法：npm run config   （或 npx tsx tools/excel-to-config.ts）
// 改完 Excel 必须跑这个脚本，生成的 .generated.ts 才会更新。

import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    const nonNeg = ['hp', 'atk', 'def', 'range', 'attackSpeed', 'critDmg', 'dmgBonus'];
    for (const k of nonNeg) {
        if (st[k] < 0) warn(`${where}.${k} = ${st[k]} 为负`);
    }
    if (st['attackSpeed'] <= 0) warn(`${where}.attackSpeed = ${st['attackSpeed']} 必须 > 0（否则攻击间隔除零）`);
}

// ============ 通用小工具（任意模块解析器复用）============
type Cell = unknown;
const STAT_KEYS = ['hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce'];
const STAT_KEY_SET = new Set(STAT_KEYS);

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
            speed: reqNum(r['speed'], `EnemyTypes[${type}].speed`),
            radius: reqNum(r['radius'], `EnemyTypes[${type}].radius`),
            attackInterval: reqNum(r['attackInterval'], `EnemyTypes[${type}].attackInterval`),
            color: parseColor(r['color'], `EnemyTypes[${type}].color`),
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
            moveSpeed: reqNum(r['moveSpeed'], `Classes[${cls}].moveSpeed`),
            advanceLimit: reqNum(r['advanceLimit'], `Classes[${cls}].advanceLimit`),
            healPerSec: reqNum(r['healPerSec'], `Classes[${cls}].healPerSec`),
            size: reqNum(r['size'], `Classes[${cls}].size`),
        };
    }

    // —— Levels（拍平行 → 嵌套 Level[]）——
    const { rows: lvlRows } = sheetToRows(wb, 'Levels');
    // 先按 levelIndex 聚合（同时校验同关 waveGap/levelName 一致）
    const levelMap = new Map<number, { name: string; waveGap: number; dropGroup: string; waves: Map<number, { spawns: unknown[] }> }>();
    for (const r of lvlRows) {
        const li = reqNum(r['levelIndex'], `Levels.levelIndex`);
        const name = reqStr(r['levelName'], `Levels@level${li}.levelName`);
        const waveGap = reqNum(r['waveGap'], `Levels@level${li}.waveGap`);
        const dropGroup = reqStr(r['dropGroup'], `Levels@level${li}.dropGroup`);
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
            lvl = { name, waveGap, dropGroup, waves: new Map() };
            levelMap.set(li, lvl);
        } else {
            // 同关一致性
            if (lvl.name !== name) err(`Levels: level${li} 的 levelName 不一致（${lvl.name} vs ${name}）`);
            if (lvl.waveGap !== waveGap) err(`Levels: level${li} 的 waveGap 不一致（${lvl.waveGap} vs ${waveGap}）`);
            if (lvl.dropGroup !== dropGroup) err(`Levels: level${li} 的 dropGroup 不一致（${lvl.dropGroup} vs ${dropGroup}）`);
        }
        let wv = lvl.waves.get(wi);
        if (!wv) { wv = { spawns: [] }; lvl.waves.set(wi, wv); }
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
        const waves = wiSorted.map(wi => ({ spawns: lvl.waves.get(wi)!.spawns }));
        return { name: lvl.name, waveGap: lvl.waveGap, dropGroup: lvl.dropGroup, waves };
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

    // —— roster：用 Stats 表的行顺序（前到后），保证阵型顺序语义 ——
    const roster = statsRows.map(r => reqStr(r['class'], `Stats(用于 roster)`));

    // —— 引用完整性：roster 里每个职业都必须在 Stats 和 Classes 同时有定义 ——
    // （_setupSquad 同时读 stats[cls] 和 classes[cls]，缺一边会运行时崩）
    const statsKeys = new Set(Object.keys(stats));
    const classKeys = new Set(Object.keys(classes));
    for (const cls of roster) {
        if (!classKeys.has(cls)) err(`一致性: 职业 "${cls}" 在 Stats 有、Classes 缺失`);
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
        if (!STAT_KEY_SET.has(stat)) err(`SlotBonuses: stat "${stat}" 不在 CombatStats 中`);
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
        if (!STAT_KEY_SET.has(stat)) err(`Affixes: stat "${stat}" 不在 CombatStats 中`);
        if (value <= 0) warn(`Affixes[${stat}].value = ${value} 应 > 0`);
        if (affixStats.has(stat)) err(`Affixes: stat "${stat}" 重复定义`);
        affixStats.add(stat);
        affixes.push({ stat, value });
    }
    if (affixes.length === 0) err('Affixes: 至少需要 1 条可抽取词条');

    const config = { qualities, slotBonuses, affixes };
    const summary = `qualities=${Object.keys(qualities).length} slots=${Object.keys(slotBonuses).length} bonuses=${bonusCount} affixes=${affixes.length}`;
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
    const groupDefs: Record<string, { itemCount: number; qualityGroup: string; slotGroup: string }> = {};
    for (const r of groupRows) {
        const group = reqStr(r['group'], 'DropGroups.group');
        if (groupDefs[group]) err(`DropGroups: group "${group}" 重复定义`);
        const itemCount = reqNum(r['itemCount'], `DropGroups[${group}].itemCount`);
        if (itemCount < 1) warn(`DropGroups[${group}].itemCount = ${itemCount}（胜利奖励通常应 ≥ 1）`);
        groupDefs[group] = {
            itemCount,
            qualityGroup: reqStr(r['qualityGroup'], `DropGroups[${group}].qualityGroup`),
            slotGroup: reqStr(r['slotGroup'], `DropGroups[${group}].slotGroup`),
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
            qualityWeights: completeWeights('QualityWeights', def.qualityGroup, VALID_QUALITIES, qualityWeightGroups),
            slotWeights: completeWeights('SlotWeights', def.slotGroup, VALID_SLOTS, slotWeightGroups),
        };
    }

    const config = { groups };
    const summary = `groups=${Object.keys(groups).length} qualityWeightGroups=${Object.keys(qualityWeightGroups).length} slotWeightGroups=${Object.keys(slotWeightGroups).length}`;
    return { config, summary };
}

// ============ 源清单（加模块就在这里加一行）============
interface ConfigSource {
    name: string;        // 模块名（日志/报错用）
    xlsxRel: string;     // 源 xlsx，相对 tools/
    outRel: string;      // 产物 .ts，相对 tools/
    exportVar: string;   // 产物里 export const 的名字（消费端 import 用）
    build: (wb: XLSX.WorkBook) => { config: unknown; summary: string };
}
const SOURCES: ConfigSource[] = [
    {
        name: 'battle',
        xlsxRel: 'config-xlsx/battle.xlsx',
        outRel: '../assets/scripts/config/battle.config.generated.ts',
        exportVar: 'generatedBattleConfig',
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
];

// 产物代码模板
function genCode(src: ConfigSource, config: unknown): string {
    const now = new Date().toISOString();
    return `// ⚠️ 本文件由 tools/excel-to-config.ts 自动生成，请勿手改。
// 改数值请编辑 tools/${src.xlsxRel}，然后跑：npm run config
// 源文件：tools/${src.xlsxRel}
// 生成时间：${now}

/* eslint-disable */
// @ts-nocheck
export const ${src.exportVar} = ${JSON.stringify(config, null, 4)};
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
