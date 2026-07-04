// Chest storage model. Opening rewards live in ChestService.

import { hashSeed } from '../core/Random';

export type ChestType = 'normal' | 'boss' | 'chapter';
export const CHEST_TYPES: ChestType[] = ['normal', 'boss', 'chapter'];
export const MAX_CHEST_COUNT = 30;

export interface ChestItem {
    id: string;
    type: ChestType;
    sourceLevelIndex: number;
    sourceDropGroup: string;
    seed: string;
    createdAt: number;
}

export type ChestSave = ChestItem[];

export interface ChestOpResult {
    ok: boolean;
    reason?: string;
    chest?: ChestItem;
}

function fail(reason: string): ChestOpResult {
    return { ok: false, reason };
}

function cloneChest(chest: ChestItem): ChestItem {
    return { ...chest };
}

function makeChestId(seed: string, createdAt: number): string {
    return `ch_${createdAt.toString(36)}_${hashSeed(seed).toString(36)}`;
}

export function createChestItem(input: {
    type: ChestType;
    sourceLevelIndex: number;
    sourceDropGroup: string;
    seed: string;
    createdAt: number;
}): ChestItem {
    return {
        id: makeChestId(input.seed, input.createdAt),
        type: input.type,
        sourceLevelIndex: Math.max(0, Math.floor(input.sourceLevelIndex)),
        sourceDropGroup: input.sourceDropGroup,
        seed: input.seed,
        createdAt: input.createdAt,
    };
}

function isChestType(value: unknown): value is ChestType {
    return CHEST_TYPES.indexOf(value as ChestType) >= 0;
}

export class ChestInventoryModel {
    chests: ChestItem[] = [];

    constructor(public readonly maxChests = MAX_CHEST_COUNT) {}

    remainingSlots(): number {
        return Math.max(0, this.maxChests - this.chests.length);
    }

    addChest(chest: ChestItem): ChestOpResult {
        if (!isChestType(chest.type)) return fail('宝箱类型非法');
        if (!chest.sourceDropGroup) return fail('宝箱缺少掉落组');
        if (this.chests.length >= this.maxChests) return fail('宝箱库存已满');
        const stored = cloneChest(chest);
        this.chests.push(stored);
        return { ok: true, chest: stored };
    }

    addChests(chests: ChestItem[]): { added: ChestItem[]; failed: number } {
        const added: ChestItem[] = [];
        let failed = 0;
        for (const chest of chests) {
            const r = this.addChest(chest);
            if (r.ok && r.chest) added.push(r.chest);
            else failed++;
        }
        return { added, failed };
    }

    removeChest(id: string): ChestOpResult {
        const i = this.chests.findIndex(chest => chest.id === id);
        if (i < 0) return fail('宝箱不存在');
        const [chest] = this.chests.splice(i, 1);
        return { ok: true, chest };
    }

    serializeChests(): ChestSave {
        return this.chests.map(cloneChest);
    }

    deserializeChests(save: Partial<ChestItem>[] | undefined): void {
        this.chests = [];
        for (const raw of save ?? []) {
            if (!raw || !isChestType(raw.type)) continue;
            if (typeof raw.sourceDropGroup !== 'string' || raw.sourceDropGroup.length === 0) continue;
            if (this.chests.length >= this.maxChests) break;
            this.chests.push({
                id: typeof raw.id === 'string' && raw.id ? raw.id : makeChestId(String(raw.seed ?? Date.now()), Number(raw.createdAt ?? Date.now())),
                type: raw.type,
                sourceLevelIndex: Math.max(0, Math.floor(Number(raw.sourceLevelIndex ?? 0))),
                sourceDropGroup: raw.sourceDropGroup,
                seed: String(raw.seed ?? ''),
                createdAt: Number(raw.createdAt ?? Date.now()),
            });
        }
    }
}
