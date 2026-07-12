// 装备定义：部位/品质/颜色/名字池 + 随机生成。
// 纯数据，不依赖 cc。数值由 config/EquipConfig 从 equip.xlsx 生成。

import { calcEquipItemStats } from '../config/EquipConfig';

export type EquipSlot = 'weapon' | 'helmet' | 'chest' | 'pants' | 'shoes'; // 武器/头盔/胸甲/裤子/鞋子
export type Quality = 'common' | 'fine' | 'rare' | 'epic' | 'legend';       // 白/绿/蓝/紫/橙
// 2026-07-11 双层叠算扩键：三围/移速百分比（hpPct 等）归二级属性池，作用于 (白板+固定) 全池；
// moveSpeed/skillHaste/伤害四拆为新平铺维度。见 spec 2026-07-11-progression-framework-design.md §3。
export type EquipStatKey = 'hp' | 'atk' | 'def' | 'range' | 'attackSpeed' | 'critRate' | 'critDmg' | 'dodgeRate' | 'blockRate' | 'blockRatio' | 'dmgBonus' | 'dmgReduce'
    | 'moveSpeed' | 'hpPct' | 'atkPct' | 'defPct' | 'moveSpeedPct'
    | 'skillHaste' | 'basicDmgBonus' | 'skillDmgBonus' | 'singleDmgBonus' | 'aoeDmgBonus';
export type EquipStats = Partial<Record<EquipStatKey, number>>;

export type GemType = 'atk' | 'hp' | 'def' | 'crit' | 'dmg';   // 宝石类型（映射属性见 inlay.xlsx/Gems）
export interface GemSocket { type: GemType; level: number }     // 只记类型+等级，加成值由 InlayConfig 现算
export interface InscriptionEffect { stat: EquipStatKey; value: number }  // 卷轴抽定后固定存这

export interface EquipItem {
    id: string;        // 实例唯一 id
    slot: EquipSlot;   // 部位
    name: string;      // 占位名
    quality: Quality;  // 品质
    level?: number;     // 装备等级；与品质独立叠乘，读老存档时按 1 补齐
    stats?: EquipStats; // 属性加成；读老存档时会补齐
    locked?: boolean;  // 锁定后不可出售；老存档缺字段按未锁处理
    gemSockets?: (GemSocket | null)[];          // 长度=该品质宝石孔数；null=空孔；读老存档补齐
    inscriptions?: (InscriptionEffect | null)[]; // 长度=该品质铭文位数；null=空位；读老存档补齐
}

export const SLOTS: EquipSlot[] = ['weapon', 'helmet', 'chest', 'pants', 'shoes'];
export const SLOT_LABEL: Record<EquipSlot, string> = {
    weapon: '武器', helmet: '头盔', chest: '胸甲', pants: '裤子', shoes: '鞋子',
};

// 角色：每个角色各有一套 5 装备栏。id 与战斗职业一致（tank/dps/healer），
// 但这里独立定义，不耦合 BattleConfig——存储层不需要知道战斗数值。
export type CharacterId = 'tank' | 'dps' | 'healer';
export const CHARACTERS: CharacterId[] = ['tank', 'dps', 'healer'];
export const CHARACTER_LABEL: Record<CharacterId, string> = {
    tank: '坦克', dps: '输出', healer: '治疗',
};

export const QUALITIES: Quality[] = ['common', 'fine', 'rare', 'epic', 'legend'];
export const QUALITY_LABEL: Record<Quality, string> = {
    common: '普通', fine: '优秀', rare: '精良', epic: '史诗', legend: '传说',
};
export const QUALITY_COLOR: Record<Quality, [number, number, number]> = {
    common: [180, 180, 180], fine: [90, 200, 120], rare: [80, 150, 235],
    epic: [170, 90, 210], legend: [235, 160, 50],
};

const NAME_POOL: Record<EquipSlot, string[]> = {
    weapon: ['短剑', '长剑', '巨斧', '法杖'],
    helmet: ['皮帽', '铁盔', '头巾'],
    chest: ['布衣', '锁甲', '板甲'],
    pants: ['短裤', '护腿', '重甲裤'],
    shoes: ['草鞋', '皮靴', '战靴'],
};

export const STAT_LABEL: Record<EquipStatKey, string> = {
    hp: '生命',
    atk: '攻击',
    def: '防御',
    range: '射程',
    attackSpeed: '攻速',
    critRate: '暴击',
    critDmg: '暴伤',
    dodgeRate: '闪避',
    blockRate: '格挡',
    blockRatio: '格挡减伤',
    dmgBonus: '增伤',
    dmgReduce: '减伤',
    moveSpeed: '移速',
    hpPct: '生命%',
    atkPct: '攻击%',
    defPct: '防御%',
    moveSpeedPct: '移速%',
    skillHaste: '技能急速',
    basicDmgBonus: '普攻伤害',
    skillDmgBonus: '技能伤害',
    singleDmgBonus: '单体伤害',
    aoeDmgBonus: '群体伤害',
};
export const PERCENT_STATS: EquipStatKey[] = ['attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce',
    'hpPct', 'atkPct', 'defPct', 'moveSpeedPct', 'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus'];
export const STAT_ORDER: EquipStatKey[] = ['atk', 'hp', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg', 'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce',
    'moveSpeed', 'atkPct', 'hpPct', 'defPct', 'moveSpeedPct', 'skillHaste', 'basicDmgBonus', 'skillDmgBonus', 'singleDmgBonus', 'aoeDmgBonus'];

export function formatStatValue(key: EquipStatKey, value: number): string {
    if (PERCENT_STATS.indexOf(key) >= 0) return `${Math.round(value * 100)}%`;
    return String(value);
}

export function formatSignedStatValue(key: EquipStatKey, value: number): string {
    const sign = value > 0 ? '+' : '';
    if (PERCENT_STATS.indexOf(key) >= 0) return `${sign}${Math.round(value * 100)}%`;
    return `${sign}${value}`;
}

export function formatEquipStats(stats: EquipStats | undefined, maxParts = 2): string {
    if (!stats) return '';
    const parts: string[] = [];
    for (const k of STAT_ORDER) {
        const v = stats[k];
        if (!v) continue;
        parts.push(`${STAT_LABEL[k]}+${formatStatValue(k, v)}`);
        if (parts.length >= maxParts) break;
    }
    return parts.join(' ');
}

function hasStats(stats: EquipStats | undefined): boolean {
    return !!stats && Object.keys(stats).length > 0;
}

function seedFromString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function seededRng(seed: number): () => number {
    let s = seed || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

export function ensureEquipItemStats(item: EquipItem): EquipItem {
    const level = item.level ?? 1;
    if (hasStats(item.stats)) {
        return item.level === level ? item : { ...item, level };
    }
    const seed = seedFromString(`${item.id}|${item.slot}|${item.quality}|${item.name}`);
    return { ...item, level, stats: calcEquipItemStats(item.slot, item.quality, seededRng(seed), level) };
}

let _seq = 0;
// Date(ms) + 自增序列 → 同一毫秒内也唯一
export function makeId(): string {
    return `eq_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
}

function pick<T>(arr: T[], rng: () => number = Math.random): T {
    return arr[Math.floor(rng() * arr.length)];
}

export function createEquipItem(
    slot: EquipSlot,
    quality: Quality,
    rng: () => number = Math.random,
    level = 1,
): EquipItem {
    const name = pick(NAME_POOL[slot], rng);
    return { id: makeId(), slot, name, quality, level, stats: calcEquipItemStats(slot, quality, rng, level) };
}

export function randomItem(rng: () => number = Math.random): EquipItem {
    return createEquipItem(pick(SLOTS, rng), pick(QUALITIES, rng), rng);
}
