// Chest storage model. First version only stores/serializes chests;
// opening chests will be implemented in a later stage.

import { hashSeed } from '../core/Random';

export type ChestType = 'normal' | 'boss' | 'chapter';
export const CHEST_TYPES: ChestType[] = ['normal', 'boss', 'chapter'];

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

    addChest(chest: ChestItem): ChestOpResult {
        if (!isChestType(chest.type)) return fail('宝箱类型非法');
        if (!chest.sourceDropGroup) return fail('宝箱缺少掉落组');
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

    serializeChests(): ChestSave {
        return this.chests.map(cloneChest);
    }

    deserializeChests(save: Partial<ChestItem>[] | undefined): void {
        this.chests = [];
        for (const raw of save ?? []) {
            if (!raw || !isChestType(raw.type)) continue;
            if (typeof raw.sourceDropGroup !== 'string' || raw.sourceDropGroup.length === 0) continue;
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
