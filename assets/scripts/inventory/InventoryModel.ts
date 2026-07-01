// 装备存储模型（纯逻辑，不依赖 cc）：背包 / 仓库 / 5 装备栏 + 掉落/转移/穿脱 + 序列化。
// 所有操作返回 OpResult，满了/非法就失败，绝不静默丢装备。

import { EquipItem, EquipSlot, SLOTS, CharacterId, CHARACTERS, randomItem, ensureEquipItemStats, Quality, QUALITIES } from './EquipDefs';
import { InventoryConfig } from './InventoryConfig';

export interface OpResult { ok: boolean; reason?: string; item?: EquipItem; }
export interface SellResult extends OpResult { gold?: number; sold?: EquipItem[]; }
export type InventorySortMode = 'quality' | 'slot' | 'name';
export type InventoryZone = 'backpack' | 'warehouse';
const OK: OpResult = { ok: true };
function fail(reason: string): OpResult { return { ok: false, reason }; }

const SELL_PRICE: Record<Quality, number> = {
    common: 10,
    fine: 25,
    rare: 60,
    epic: 150,
    legend: 400,
};

// 每个角色各有一套 5 装备栏
export type CharEquipped = Record<CharacterId, Record<EquipSlot, EquipItem | null>>;

export interface InventorySave {
    backpack: EquipItem[];
    warehouse: EquipItem[];
    equipped: CharEquipped;
}

function emptySlots(): Record<EquipSlot, EquipItem | null> {
    const e = {} as Record<EquipSlot, EquipItem | null>;
    for (const s of SLOTS) e[s] = null;
    return e;
}

function emptyEquipped(): CharEquipped {
    const e = {} as CharEquipped;
    for (const c of CHARACTERS) e[c] = emptySlots();
    return e;
}

function cloneItem(it: EquipItem): EquipItem {
    const item = ensureEquipItemStats(it);
    return { ...item, stats: item.stats ? { ...item.stats } : undefined };
}

function qualityRank(q: Quality): number {
    return QUALITIES.indexOf(q);
}

function sortItems(list: EquipItem[], mode: InventorySortMode): void {
    list.sort((a, b) => {
        if (mode === 'quality') return qualityRank(b.quality) - qualityRank(a.quality) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || a.name.localeCompare(b.name);
        if (mode === 'slot') return SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || qualityRank(b.quality) - qualityRank(a.quality) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name) || qualityRank(b.quality) - qualityRank(a.quality);
    });
}

export function sellPriceOf(item: EquipItem): number {
    return SELL_PRICE[item.quality] ?? 0;
}

export class InventoryModel {
    backpack: EquipItem[] = [];
    warehouse: EquipItem[] = [];
    equipped: CharEquipped = emptyEquipped();

    constructor(
        private backpackCap = InventoryConfig.backpackCap,
        private warehouseCap = InventoryConfig.warehouseCap,
    ) {}

    get backpackFull(): boolean { return this.backpack.length >= this.backpackCap; }
    get warehouseFull(): boolean { return this.warehouse.length >= this.warehouseCap; }
    get maxBackpack(): number { return this.backpackCap; }
    get maxWarehouse(): number { return this.warehouseCap; }

    private findEquippedById(id: string): { character: CharacterId; slot: EquipSlot; item: EquipItem } | null {
        for (const character of CHARACTERS) {
            for (const slot of SLOTS) {
                const item = this.equipped[character][slot];
                if (item?.id === id) return { character, slot, item };
            }
        }
        return null;
    }

    private list(zone: InventoryZone): EquipItem[] {
        return zone === 'backpack' ? this.backpack : this.warehouse;
    }

    addItemToBackpack(item: EquipItem): OpResult {
        if (this.backpackFull) return fail('背包已满');
        const stored = cloneItem(item);
        this.backpack.push(stored);
        return { ok: true, item: stored };
    }

    addItemToWarehouse(item: EquipItem): OpResult {
        if (this.warehouseFull) return fail('仓库已满');
        const stored = cloneItem(item);
        this.warehouse.push(stored);
        return { ok: true, item: stored };
    }

    setLocked(id: string, locked: boolean): OpResult {
        const item = this.backpack.find(it => it.id === id)
            ?? this.warehouse.find(it => it.id === id)
            ?? this.findEquippedById(id)?.item
            ?? null;
        if (!item) return fail('装备不存在');
        item.locked = locked;
        return { ok: true, item };
    }

    toggleLocked(id: string): OpResult {
        const item = this.backpack.find(it => it.id === id)
            ?? this.warehouse.find(it => it.id === id)
            ?? this.findEquippedById(id)?.item
            ?? null;
        if (!item) return fail('装备不存在');
        item.locked = !item.locked;
        return { ok: true, item };
    }

    sortZone(mode: InventorySortMode, zone: InventoryZone): OpResult {
        sortItems(this.list(zone), mode);
        return OK;
    }

    sellItem(id: string): SellResult {
        if (this.findEquippedById(id)) return { ok: false, reason: '已穿装备不能出售' };
        for (const zone of ['backpack', 'warehouse'] as InventoryZone[]) {
            const list = this.list(zone);
            const i = list.findIndex(it => it.id === id);
            if (i < 0) continue;
            const item = list[i];
            if (item.locked) return { ok: false, reason: '锁定装备不能出售' };
            list.splice(i, 1);
            return { ok: true, item, sold: [item], gold: sellPriceOf(item) };
        }
        return { ok: false, reason: '装备不存在' };
    }

    sellBatch(maxQuality: Quality, zones: InventoryZone[] = ['backpack', 'warehouse']): SellResult {
        const maxRank = qualityRank(maxQuality);
        if (maxRank < 0) return { ok: false, reason: '品质非法' };
        const sold: EquipItem[] = [];
        let gold = 0;
        for (const zone of zones) {
            const list = this.list(zone);
            for (let i = list.length - 1; i >= 0; i--) {
                const item = list[i];
                if (item.locked) continue;
                if (qualityRank(item.quality) > maxRank) continue;
                list.splice(i, 1);
                sold.push(item);
                gold += sellPriceOf(item);
            }
        }
        if (sold.length === 0) return { ok: false, reason: '没有可出售装备', sold, gold: 0 };
        return { ok: true, sold, gold };
    }

    // 调试掉落：随机生成一件 → 背包
    dropRandom(): OpResult {
        return this.addItemToBackpack(randomItem());
    }

    // 随机生成一件 → 仓库（用于调试/兜底）
    dropRandomToWarehouse(): OpResult {
        return this.addItemToWarehouse(randomItem());
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

    // 背包某件 → 指定角色的对应部位装备栏；该角色该部位原有装备退回背包。
    // 净背包数 = -1(移出该件) +(0或1)(退回旧件) ≤ 原数 → 永不超上限，无需判满/回滚。
    equip(id: string, character: CharacterId): OpResult {
        if (!this.equipped[character]) return fail('角色不存在');
        const i = this.backpack.findIndex(it => it.id === id);
        if (i < 0) return fail('装备不在背包');
        const item = this.backpack.splice(i, 1)[0];
        const prev = this.equipped[character][item.slot];
        this.equipped[character][item.slot] = item;
        if (prev) this.backpack.push(prev);
        return OK;
    }

    // 仓库某件 → 指定角色装备栏；原有装备退回仓库。净仓库数不增，换装安全。
    equipFromWarehouse(id: string, character: CharacterId): OpResult {
        if (!this.equipped[character]) return fail('角色不存在');
        const i = this.warehouse.findIndex(it => it.id === id);
        if (i < 0) return fail('装备不在仓库');
        const item = this.warehouse.splice(i, 1)[0];
        const prev = this.equipped[character][item.slot];
        this.equipped[character][item.slot] = item;
        if (prev) this.warehouse.push(prev);
        return OK;
    }

    // 指定角色的装备栏 → 背包（背包 +1，需判满）
    unequip(character: CharacterId, slot: EquipSlot): OpResult {
        if (!this.equipped[character]) return fail('角色不存在');
        const item = this.equipped[character][slot];
        if (!item) return fail('该装备栏为空');
        if (this.backpackFull) return fail('背包已满');
        this.equipped[character][slot] = null;
        this.backpack.push(item);
        return OK;
    }

    // 指定角色装备栏 → 仓库（仓库 +1，需判满）
    unequipToWarehouse(character: CharacterId, slot: EquipSlot): OpResult {
        if (!this.equipped[character]) return fail('角色不存在');
        const item = this.equipped[character][slot];
        if (!item) return fail('该装备栏为空');
        if (this.warehouseFull) return fail('仓库已满');
        this.equipped[character][slot] = null;
        this.warehouse.push(item);
        return OK;
    }

    serialize(): InventorySave {
        const eq = emptyEquipped();
        for (const c of CHARACTERS) {
            for (const s of SLOTS) {
                const it = this.equipped[c][s];
                eq[c][s] = it ? cloneItem(it) : null;
            }
        }
        return {
            backpack: this.backpack.map(cloneItem),
            warehouse: this.warehouse.map(cloneItem),
            equipped: eq,
        };
    }

    // 缺字段/undefined 用空兜底（老存档加了新系统、或旧的「单套装备栏」格式都不报错）
    deserialize(save: Partial<InventorySave> | undefined): void {
        this.backpack = (save?.backpack ?? []).map(cloneItem);
        this.warehouse = (save?.warehouse ?? []).map(cloneItem);
        const e = emptyEquipped();
        const saved = save?.equipped;
        if (saved) {
            for (const c of CHARACTERS) {
                const slots = saved[c];
                if (!slots) continue;   // 缺该角色 → 留空
                for (const s of SLOTS) {
                    const it = slots[s];
                    e[c][s] = it ? cloneItem(it) : null;
                }
            }
        }
        this.equipped = e;
    }
}
