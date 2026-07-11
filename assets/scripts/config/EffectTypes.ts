// Effect 类型与编码解析 —— 导表器（tools/excel-to-config）与运行时共用，不依赖 cc。
// 效果列表编码：'damage:1.5|applyBuff:poison:1|heal:0.8'，竖线分隔、冒号分参：
//   damage:<倍率>            按施法者 atk 走 calcDamage 后乘倍率
//   heal:<倍率>              按施法者 atk 倍率回血
//   applyBuff:<buffId>[:层数=1]
//   dispel:<标签>[:个数=1]
//   knockback:<距离>         第 2 段实装，当前类型占位
//   summon:<单位类型>:<数量>  第 2/3 段实装，当前类型占位
// 属性修正编码：'atk:+5|atk%:0.25|def:-3'，"键%" 表示按 base 百分比；hp 禁改（maxHp 记账不做）。
// 新增 Effect 种类：改 union + parseEffectList 两处。
import type { CombatStats } from './BattleConfig';

export type Effect =
    | { kind: 'damage'; mult: number }
    | { kind: 'heal'; mult: number }
    | { kind: 'applyBuff'; buffId: string; stacks: number }
    | { kind: 'dispel'; tag: string; count: number }
    | { kind: 'knockback'; distance: number }
    | { kind: 'summon'; unitType: string; count: number };

export interface StatMod { key: keyof CombatStats; flat: number; pct: number; }

const STAT_KEYS: (keyof CombatStats)[] = [
    'hp', 'atk', 'def', 'range', 'attackSpeed', 'critRate', 'critDmg',
    'dodgeRate', 'blockRate', 'blockRatio', 'dmgBonus', 'dmgReduce',
];

function num(raw: string | undefined, where: string, onError: (msg: string) => void): number {
    const n = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(n)) {
        onError(`${where}: 不是合法数字（得到 ${JSON.stringify(raw)}）`);
        return 0;
    }
    return n;
}

export function parseEffectList(src: string, onError: (msg: string) => void): Effect[] {
    const out: Effect[] = [];
    if (!src || !src.trim()) return out;
    for (const token of src.split('|')) {
        const parts = token.trim().split(':');
        const kind = parts[0];
        switch (kind) {
            case 'damage': out.push({ kind, mult: num(parts[1], `effect[${token}].mult`, onError) }); break;
            case 'heal': out.push({ kind, mult: num(parts[1], `effect[${token}].mult`, onError) }); break;
            case 'applyBuff': {
                if (!parts[1]) { onError(`effect[${token}]: 缺 buffId`); break; }
                out.push({ kind, buffId: parts[1], stacks: parts[2] === undefined ? 1 : num(parts[2], `effect[${token}].stacks`, onError) });
                break;
            }
            case 'dispel': {
                if (!parts[1]) { onError(`effect[${token}]: 缺驱散标签`); break; }
                out.push({ kind, tag: parts[1], count: parts[2] === undefined ? 1 : num(parts[2], `effect[${token}].count`, onError) });
                break;
            }
            case 'knockback': out.push({ kind, distance: num(parts[1], `effect[${token}].distance`, onError) }); break;
            case 'summon': {
                if (!parts[1]) { onError(`effect[${token}]: 缺单位类型`); break; }
                out.push({ kind, unitType: parts[1], count: num(parts[2], `effect[${token}].count`, onError) });
                break;
            }
            default: onError(`effect[${token}]: 未知种类 ${JSON.stringify(kind)}`);
        }
    }
    return out;
}

export function parseStatMods(src: string, onError: (msg: string) => void): StatMod[] {
    const out: StatMod[] = [];
    if (!src || !src.trim()) return out;
    for (const token of src.split('|')) {
        const [rawKey, rawVal] = token.trim().split(':');
        const isPct = rawKey.endsWith('%');
        const key = (isPct ? rawKey.slice(0, -1) : rawKey) as keyof CombatStats;
        if (key === 'hp') { onError(`statMod[${token}]: 禁止修改 hp（maxHp 记账不支持）`); continue; }
        if (STAT_KEYS.indexOf(key) < 0) { onError(`statMod[${token}]: 未知属性键 ${JSON.stringify(rawKey)}`); continue; }
        const v = num(rawVal, `statMod[${token}]`, onError);
        out.push(isPct ? { key, flat: 0, pct: v } : { key, flat: v, pct: 0 });
    }
    return out;
}
