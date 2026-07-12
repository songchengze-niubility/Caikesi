// 心法点树纯逻辑（不依赖 cc）：learnNode 校验+扣费，失败不留半成品（镜像 InlayModel）。
// 存档形状 TalentSave 挂 PlayerData.talents；未知 nodeId（配置删除后残留）读到只忽略不崩。

import type { MaterialSave } from '../services/RewardTypes';
import { talentNodeById, talentLevelCost, type TalentNodeDef } from './TalentConfig';

export type TalentSave = Record<string, number>;

export interface TalentLearnResult {
    ok: boolean;
    reason?: string;
    spentGold?: number;
    spentPages?: number;
    newLevel?: number;
}
function fail(reason: string): TalentLearnResult { return { ok: false, reason }; }

export function nodeLevel(save: TalentSave | undefined, id: string): number {
    const v = save?.[id];
    return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

export function prereqMet(node: TalentNodeDef, save: TalentSave | undefined): boolean {
    return node.prereq.every(pid => {
        const p = talentNodeById(pid);
        return !!p && nodeLevel(save, pid) >= p.maxLevel;
    });
}

// 点一级：校验节点存在/未满/前置点满/金币/残页，成功即扣费写档。
// wallet.gold 就地扣减；materials 就地扣 talent_page；任一校验失败不改任何状态。
export function learnNode(save: TalentSave, nodeId: string, wallet: { gold: number }, materials: MaterialSave): TalentLearnResult {
    const node = talentNodeById(nodeId);
    if (!node) return fail('心法节点不存在');
    const cur = nodeLevel(save, nodeId);
    if (cur >= node.maxLevel) return fail('该心法已点满');
    if (!prereqMet(node, save)) return fail('前置心法未点满');
    const cost = talentLevelCost(node, cur + 1);
    if (wallet.gold < cost.gold) return fail('金币不足');
    if (cost.pages > 0 && (materials['talent_page'] ?? 0) < cost.pages) return fail('秘笈残页不足');
    wallet.gold -= cost.gold;
    if (cost.pages > 0) materials['talent_page'] = (materials['talent_page'] ?? 0) - cost.pages;
    save[nodeId] = cur + 1;
    return { ok: true, spentGold: cost.gold, spentPages: cost.pages, newLevel: cur + 1 };
}
