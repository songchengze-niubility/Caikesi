import { InventoryModel } from './InventoryModel';
import type { OpResult } from './InventoryModel';
import type { CharacterId, EquipItem, EquipSlot, EquipStats } from './EquipDefs';
import { STAT_ORDER } from './EquipDefs';

export interface EquipmentCompareResult {
    item: EquipItem;
    current: EquipItem | null;
    delta: EquipStats;
}

export function compareEquipStats(next: EquipStats | undefined, current: EquipStats | undefined): EquipStats {
    const out: EquipStats = {};
    for (const k of STAT_ORDER) {
        const d = (next?.[k] ?? 0) - (current?.[k] ?? 0);
        if (Math.abs(d) > 0.00001) out[k] = Number(d.toFixed(4));
    }
    return out;
}

export class EquipmentService {
    constructor(private model: InventoryModel) {}

    equip(character: CharacterId, itemId: string): OpResult {
        return this.model.equip(itemId, character);
    }

    unequip(character: CharacterId, slot: EquipSlot): OpResult {
        return this.model.unequip(character, slot);
    }

    compare(character: CharacterId, itemId: string): EquipmentCompareResult | null {
        const item = this.model.backpack.find(it => it.id === itemId)
            ?? this.model.warehouse.find(it => it.id === itemId);
        if (!item) return null;
        const current = this.model.equipped[character]?.[item.slot] ?? null;
        return {
            item,
            current,
            delta: compareEquipStats(item.stats, current?.stats),
        };
    }
}
