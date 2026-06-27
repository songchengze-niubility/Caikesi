// 装备存储模型（纯逻辑，不依赖 cc）：背包 / 仓库 / 5 装备栏 + 掉落/转移/穿脱 + 序列化。
// 所有操作返回 OpResult，满了/非法就失败，绝不静默丢装备。

import { EquipItem, EquipSlot, SLOTS, randomItem } from './EquipDefs';
import { InventoryConfig } from './InventoryConfig';

export interface OpResult { ok: boolean; reason?: string; }
const OK: OpResult = { ok: true };
function fail(reason: string): OpResult { return { ok: false, reason }; }

export interface InventorySave {
    backpack: EquipItem[];
    warehouse: EquipItem[];
    equipped: Record<EquipSlot, EquipItem | null>;
}

function emptyEquipped(): Record<EquipSlot, EquipItem | null> {
    const e = {} as Record<EquipSlot, EquipItem | null>;
    for (const s of SLOTS) e[s] = null;
    return e;
}

export class InventoryModel {
    backpack: EquipItem[] = [];
    warehouse: EquipItem[] = [];
    equipped: Record<EquipSlot, EquipItem | null> = emptyEquipped();

    constructor(
        private backpackCap = InventoryConfig.backpackCap,
        private warehouseCap = InventoryConfig.warehouseCap,
    ) {}

    get backpackFull(): boolean { return this.backpack.length >= this.backpackCap; }
    get warehouseFull(): boolean { return this.warehouse.length >= this.warehouseCap; }

    // 调试掉落：随机生成一件 → 背包
    dropRandom(): OpResult {
        if (this.backpackFull) return fail('背包已满');
        this.backpack.push(randomItem());
        return OK;
    }
}
