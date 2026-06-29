// 掉落配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/drop.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 drop.config.generated.ts
//    本文件只保留 TypeScript 类型定义与掷掉落辅助。

import { generatedDropConfig } from './drop.config.generated';
import { createEquipItem, EquipItem, EquipSlot, Quality, QUALITIES, SLOTS } from '../inventory/EquipDefs';

export interface DropGroupConfig {
    itemCount: number;
    qualityWeights: Record<Quality, number>;
    slotWeights: Record<EquipSlot, number>;
}

export interface DropConfigShape {
    groups: Record<string, DropGroupConfig>;
}

export const DropConfig = generatedDropConfig as DropConfigShape;

function pickWeighted<T extends string>(keys: readonly T[], weights: Record<T, number>, rng: () => number): T {
    let total = 0;
    for (const k of keys) total += Math.max(0, weights[k] ?? 0);
    if (total <= 0) return keys[0];

    let roll = rng() * total;
    for (const k of keys) {
        const weight = Math.max(0, weights[k] ?? 0);
        if (weight <= 0) continue;
        if (roll < weight) return k;
        roll -= weight;
    }
    return keys[keys.length - 1];
}

export function getDropGroup(groupId: string): DropGroupConfig {
    const group = DropConfig.groups[groupId];
    if (group) return group;
    throw new Error(`drop group "${groupId}" 不存在，请检查 battle.xlsx 的 Levels.dropGroup 与 drop.xlsx 的 DropGroups.group`);
}

export function rollDropItems(groupId: string, rng: () => number = Math.random): EquipItem[] {
    const group = getDropGroup(groupId);
    const count = Math.max(0, Math.floor(group.itemCount));
    const items: EquipItem[] = [];
    for (let i = 0; i < count; i++) {
        const slot = pickWeighted(SLOTS, group.slotWeights, rng);
        const quality = pickWeighted(QUALITIES, group.qualityWeights, rng);
        items.push(createEquipItem(slot, quality, rng));
    }
    return items;
}
