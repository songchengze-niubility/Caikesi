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
    get maxBackpack(): number { return this.backpackCap; }
    get maxWarehouse(): number { return this.warehouseCap; }

    // 调试掉落：随机生成一件 → 背包
    dropRandom(): OpResult {
        if (this.backpackFull) return fail('背包已满');
        this.backpack.push(randomItem());
        return OK;
    }

    // 背包 → 仓库
    toWarehouse(id: string): OpResult {
        const i = this.backpack.findIndex(it => it.id === id);
        if (i < 0) return fail('装备不在背包');
        if (this.warehouseFull) return fail('仓库已满');
        this.warehouse.push(this.backpack.splice(i, 1)[0]);
        return OK;
    }

    // 仓库 → 背包
    toBackpack(id: string): OpResult {
        const i = this.warehouse.findIndex(it => it.id === id);
        if (i < 0) return fail('装备不在仓库');
        if (this.backpackFull) return fail('背包已满');
        this.backpack.push(this.warehouse.splice(i, 1)[0]);
        return OK;
    }

    // 背包某件 → 对应部位装备栏；该部位原有装备退回背包。
    // 净背包数 = -1(移出该件) +(0或1)(退回旧件) ≤ 原数 → 永不超上限，无需判满/回滚。
    equip(id: string): OpResult {
        const i = this.backpack.findIndex(it => it.id === id);
        if (i < 0) return fail('装备不在背包');
        const item = this.backpack.splice(i, 1)[0];
        const prev = this.equipped[item.slot];
        this.equipped[item.slot] = item;
        if (prev) this.backpack.push(prev);
        return OK;
    }

    // 装备栏 → 背包（背包 +1，需判满）
    unequip(slot: EquipSlot): OpResult {
        const item = this.equipped[slot];
        if (!item) return fail('该装备栏为空');
        if (this.backpackFull) return fail('背包已满');
        this.equipped[slot] = null;
        this.backpack.push(item);
        return OK;
    }

    serialize(): InventorySave {
        return {
            backpack: this.backpack.map(it => ({ ...it })),
            warehouse: this.warehouse.map(it => ({ ...it })),
            equipped: Object.fromEntries(
                SLOTS.map(s => [s, this.equipped[s] ? { ...this.equipped[s]! } : null]),
            ) as Record<EquipSlot, EquipItem | null>,
        };
    }

    // 缺字段/undefined 用空兜底（老存档加了新系统也不报错）
    deserialize(save: Partial<InventorySave> | undefined): void {
        this.backpack = (save?.backpack ?? []).map(it => ({ ...it }));
        this.warehouse = (save?.warehouse ?? []).map(it => ({ ...it }));
        const e = emptyEquipped();
        if (save?.equipped) {
            for (const s of SLOTS) {
                const it = save.equipped[s];
                e[s] = it ? { ...it } : null;
            }
        }
        this.equipped = e;
    }
}
