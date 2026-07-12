// 角色天赋投点纯逻辑（不依赖 cc）：learnNode 四步校验 fail-before-mutate（镜像 TalentModel）。
// 技能点不存档，派生：可用点数 = (角色等级 - 1) - 已投总点数；洗点 = 清空该职业投点记录。
// 存档形状 CharTalentSave 挂 PlayerData.charTalents；读档经 sanitizeCharTalents 自愈。

import { charTalentNodeById, charTalentNodes } from './CharTalentConfig';

export type CharTalentSave = Record<string, Record<string, number>>;

export interface CharTalentLearnResult {
    ok: boolean;
    reason?: string;
    newLevel?: number;
}
function failResult(reason: string): CharTalentLearnResult { return { ok: false, reason }; }

export function nodeLevelOf(save: CharTalentSave | undefined, cls: string, nodeId: string): number {
    const v = save?.[cls]?.[nodeId];
    return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
}

// 已投总点数：只统计该职业配置里存在的节点，级数按 maxLevel 截断（脏档不虚增）
export function spentPoints(save: CharTalentSave | undefined, cls: string): number {
    let sum = 0;
    for (const n of charTalentNodes(cls)) sum += Math.min(nodeLevelOf(save, cls, n.id), n.maxLevel);
    return sum;
}

export function availablePoints(save: CharTalentSave | undefined, cls: string, charLevel: number): number {
    return Math.max(0, Math.floor(charLevel) - 1 - spentPoints(save, cls));
}

// 投 1 点：节点存在且属本职业 → 未满 → 角色等级达门槛 → 有剩余点数；失败不改档
export function learnNode(save: CharTalentSave, cls: string, nodeId: string, charLevel: number): CharTalentLearnResult {
    const node = charTalentNodeById(nodeId);
    if (!node || node.cls !== cls) return failResult('天赋节点不存在');
    const cur = nodeLevelOf(save, cls, nodeId);
    if (cur >= node.maxLevel) return failResult('该天赋已点满');
    if (charLevel < node.levelReq) return failResult(`需角色 Lv.${node.levelReq}`);
    if (availablePoints(save, cls, charLevel) < 1) return failResult('技能点不足');
    (save[cls] ??= {})[nodeId] = cur + 1;
    return { ok: true, newLevel: cur + 1 };
}

// 免费洗点：清空该职业全部投点（点数余额随 availablePoints 自动回满）
export function resetChar(save: CharTalentSave, cls: string): void {
    delete save[cls];
}

// 存档自愈：未知职业键/未知节点丢弃、级数取整钳制 [0, maxLevel]、
// 投点总数超预算（等级-1）时按配置顺序保留、越界截断（防脏档凭空多点）。
export function sanitizeCharTalents(raw: unknown, levelOf: (cls: string) => number): CharTalentSave {
    const out: CharTalentSave = {};
    if (!raw || typeof raw !== 'object') return out;
    const src = raw as Record<string, unknown>;
    for (const cls of ['tank', 'dps', 'healer']) {
        const entry = src[cls];
        if (!entry || typeof entry !== 'object') continue;
        const levels = entry as Record<string, unknown>;
        let budget = Math.max(0, Math.floor(levelOf(cls)) - 1);
        const clean: Record<string, number> = {};
        for (const node of charTalentNodes(cls)) {
            const v = levels[node.id];
            if (typeof v !== 'number' || v <= 0) continue;
            const lv = Math.min(Math.floor(v), node.maxLevel, budget);
            if (lv <= 0) continue;
            clean[node.id] = lv;
            budget -= lv;
        }
        if (Object.keys(clean).length > 0) out[cls] = clean;
    }
    return out;
}
