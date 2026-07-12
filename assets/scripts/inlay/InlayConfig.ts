// 镶嵌纯计算：孔数 / 宝石加成 / 宝石属性映射 / 铭文随机 roll / 四舍五入。
// 不依赖 cc，可 tsx 单测。数值来自 inlay.xlsx → inlay.config.generated.ts。

import { generatedInlayConfig } from '../config/inlay.config.generated';
import { GemType, InscriptionEffect, EquipStatKey, Quality, PERCENT_STATS } from '../inventory/EquipDefs';

export interface InlayGemDef { label: string; stat: EquipStatKey; baseValue: number; maxLevel: number; levelRatio?: number }
export interface InlaySocketCount { gemSockets: number; inscriptionSlots: number }
export interface InlayInscriptionDef { stat: EquipStatKey; valueMin: number; valueMax: number }
export interface InlayConfigShape {
    gems: Record<GemType, InlayGemDef>;
    socketCounts: Record<Quality, InlaySocketCount>;
    inscriptions: InlayInscriptionDef[];
}

export const InlayConfig = generatedInlayConfig as InlayConfigShape;

// 整数属性(hp/atk/def/range)取整；百分比属性保留 4 位小数。镜像 EquipConfig.roundStat。
export function roundInlayStat(key: EquipStatKey, value: number): number {
    if (PERCENT_STATS.indexOf(key) >= 0) return Number(value.toFixed(4));
    return Math.round(value);
}

export function socketCounts(quality: Quality): InlaySocketCount {
    return InlayConfig.socketCounts[quality] ?? { gemSockets: 0, inscriptionSlots: 0 };
}

export function gemStatKey(type: GemType): EquipStatKey {
    return InlayConfig.gems[type]?.stat ?? 'atk';
}

export function gemMaxLevel(type: GemType): number {
    return InlayConfig.gems[type]?.maxLevel ?? 1;
}

export function gemStatValue(type: GemType, level: number): number {
    const def = InlayConfig.gems[type];
    if (!def) return 0;
    const clamped = Math.max(1, Math.min(gemMaxLevel(type), Math.floor(level)));
    // 等比价值（2026-07-11 spec 5.3）：baseValue × levelRatio^(lv-1)；levelRatio 缺省 1 = 各级同值兜底
    return def.baseValue * Math.pow(def.levelRatio ?? 1, clamped - 1);
}

export function gemTypes(): GemType[] {
    return Object.keys(InlayConfig.gems) as GemType[];
}

// 从铭文池随机抽一行，在 [valueMin,valueMax] roll 出 value 并按属性四舍五入。
export function rollInscription(rng: () => number = Math.random): InscriptionEffect {
    const pool = InlayConfig.inscriptions;
    const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    const def = pool[i];
    const raw = def.valueMin + (def.valueMax - def.valueMin) * rng();
    return { stat: def.stat, value: roundInlayStat(def.stat, raw) };
}
