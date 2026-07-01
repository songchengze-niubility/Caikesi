import { InventoryModel } from './InventoryModel';
import type { InventorySortMode, InventoryZone, OpResult, SellResult } from './InventoryModel';
import type { EquipItem, EquipSlot, Quality } from './EquipDefs';
import { QUALITIES, SLOTS } from './EquipDefs';

function qualityRank(q: Quality): number {
    return QUALITIES.indexOf(q);
}

export class InventoryService {
    constructor(private model: InventoryModel) {}

    addEquipment(item: EquipItem): OpResult {
        return this.model.addItemToBackpack(item);
    }

    setLocked(itemId: string, locked: boolean): OpResult {
        return this.model.setLocked(itemId, locked);
    }

    toggleLocked(itemId: string): OpResult {
        return this.model.toggleLocked(itemId);
    }

    sellEquipment(itemId: string): SellResult {
        return this.model.sellItem(itemId);
    }

    sellBatch(maxQuality: Quality, zones?: InventoryZone[]): SellResult {
        return this.model.sellBatch(maxQuality, zones);
    }

    sortZone(mode: InventorySortMode, zone: InventoryZone = 'backpack'): OpResult {
        return this.model.sortZone(mode, zone);
    }

    sortInventory(mode: InventorySortMode, zone: 'backpack' | 'warehouse' = 'backpack'): EquipItem[] {
        const list = zone === 'backpack' ? this.model.backpack : this.model.warehouse;
        return [...list].sort((a, b) => {
            if (mode === 'quality') return qualityRank(b.quality) - qualityRank(a.quality) || a.name.localeCompare(b.name);
            if (mode === 'slot') return SLOTS.indexOf(a.slot as EquipSlot) - SLOTS.indexOf(b.slot as EquipSlot) || qualityRank(b.quality) - qualityRank(a.quality);
            return a.name.localeCompare(b.name) || qualityRank(b.quality) - qualityRank(a.quality);
        });
    }
}
