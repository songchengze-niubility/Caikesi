// 心法（全局天赋树）配置纯计算层（不依赖 cc）。
// ★★★ 数值由 Excel 管理 ★★★ 源文件：tools/config-xlsx/talent.xlsx → npm run config
// 玩家展示名「心法」；与装备铭文（inlay 线 inscription）无关。

import { generatedTalentConfig } from '../config/talent.config.generated';

export type TalentBranch = 'trunk' | 'combat' | 'economy' | 'drop';
export type TalentEffectKind = 'stat' | 'econ' | 'drop' | 'unlock';

export interface TalentNodeDef {
    id: string;
    label: string;
    branch: TalentBranch;
    tier: number;             // 同支内唯一，UI 网格排布用
    prereq: string[];         // 全部前置点满才可点本节点
    maxLevel: number;         // 小节点多级；大节点 1
    effectKind: TalentEffectKind;
    effectKey: string;        // stat→EquipStatKey / econ→gold|exp|offlineRate / drop→equipQuality / unlock→squadSlot3|chestCapacity|autoSell|offlineCap
    valuePerLevel: number;    // 每级效果值（百分比 0~1 小数）
    goldBase: number;         // 第 n 级金币成本 = round(goldBase × goldGrowth^(n-1))
    goldGrowth: number;
    pageCost: number;         // 秘笈残页，仅 0→1 级收（一次性大节点）
}

export interface TalentConfigShape {
    nodes: TalentNodeDef[];
    firstClearPages: number[];   // 按 levelIndex；越界=0
}

export const TalentConfig = generatedTalentConfig as TalentConfigShape;

let _byId: Map<string, TalentNodeDef> | null = null;

export function talentNodes(): TalentNodeDef[] {
    return TalentConfig.nodes;
}

export function talentNodeById(id: string): TalentNodeDef | undefined {
    if (!_byId) {
        _byId = new Map();
        for (const n of TalentConfig.nodes) _byId.set(n.id, n);
    }
    return _byId.get(id);
}

// 第 nextLevel 级（1 起）的成本；残页只在 0→1 级收（多级节点 pageCost=0，导表已校验）
export function talentLevelCost(node: TalentNodeDef, nextLevel: number): { gold: number; pages: number } {
    const gold = Math.round(node.goldBase * Math.pow(node.goldGrowth, Math.max(0, nextLevel - 1)));
    return { gold, pages: nextLevel === 1 ? node.pageCost : 0 };
}

// 关卡首通发放的秘笈残页数
export function firstClearPages(levelIndex: number): number {
    return TalentConfig.firstClearPages[levelIndex] ?? 0;
}
