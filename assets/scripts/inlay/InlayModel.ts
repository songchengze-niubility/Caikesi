// 镶嵌操作纯逻辑（不依赖 cc）：镶入/取出宝石、打铭文（覆盖重抽）、补齐孔位。
// 操作同时改 EquipItem（孔位）与 materials（材料背包），返回 OpResult，失败不留半成品。

import { EquipItem, GemType, GemSocket, InscriptionEffect } from '../inventory/EquipDefs';
import { gemMaterialId, MaterialSave } from '../services/RewardTypes';
import { socketCounts, rollInscription } from './InlayConfig';

export interface OpResult { ok: boolean; reason?: string }
const OK: OpResult = { ok: true };
function fail(reason: string): OpResult { return { ok: false, reason }; }

function padSlots<T>(arr: (T | null)[] | undefined, n: number): (T | null)[] {
    const out: (T | null)[] = [];
    for (let i = 0; i < n; i++) {
        const v = arr?.[i] ?? null;
        out.push(v ? { ...v } : null);
    }
    return out;
}

// 把 gemSockets/inscriptions 补齐到该品质应有的长度（幂等、保留已有格、多余截断、深拷贝条目）。
export function ensureInlaySlots(item: EquipItem): EquipItem {
    const c = socketCounts(item.quality);
    item.gemSockets = padSlots<GemSocket>(item.gemSockets, c.gemSockets);
    item.inscriptions = padSlots<InscriptionEffect>(item.inscriptions, c.inscriptionSlots);
    return item;
}

function addMaterial(materials: MaterialSave, type: GemType, level: number): void {
    const id = gemMaterialId(type, level);
    materials[id] = (materials[id] ?? 0) + 1;
}

export function socketGem(item: EquipItem, socketIndex: number, gemType: GemType, gemLevel: number, materials: MaterialSave): OpResult {
    const sockets = item.gemSockets;
    if (!sockets || socketIndex < 0 || socketIndex >= sockets.length) return fail('宝石孔不存在');
    const id = gemMaterialId(gemType, gemLevel);
    if ((materials[id] ?? 0) < 1) return fail('宝石不足');
    const prev = sockets[socketIndex];
    if (prev) addMaterial(materials, prev.type, prev.level);   // 旧宝石退回
    materials[id] = (materials[id] ?? 0) - 1;
    sockets[socketIndex] = { type: gemType, level: gemLevel };
    return OK;
}

export function unsocketGem(item: EquipItem, socketIndex: number, materials: MaterialSave): OpResult {
    const sockets = item.gemSockets;
    if (!sockets || socketIndex < 0 || socketIndex >= sockets.length) return fail('宝石孔不存在');
    const gem = sockets[socketIndex];
    if (!gem) return fail('该孔为空');
    addMaterial(materials, gem.type, gem.level);
    sockets[socketIndex] = null;
    return OK;
}

export function applyInscription(item: EquipItem, slotIndex: number, materials: MaterialSave, rng: () => number = Math.random): OpResult {
    const slots = item.inscriptions;
    if (!slots || slotIndex < 0 || slotIndex >= slots.length) return fail('铭文位不存在');
    if ((materials['rune_scroll'] ?? 0) < 1) return fail('卷轴不足');
    materials['rune_scroll'] = (materials['rune_scroll'] ?? 0) - 1;
    slots[slotIndex] = rollInscription(rng);   // 覆盖重抽
    return OK;
}
