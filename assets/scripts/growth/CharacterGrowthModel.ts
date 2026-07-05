// 每角色成长状态（纯逻辑，不依赖 cc）：level/exp、gainExp 连续升级、封顶、存档自愈。
// exp 语义：当前等级内已累积、未满下一级的经验（不是终身累计经验）。

import { CHARACTERS, CharacterId } from '../inventory/EquipDefs';
import { expToNext, clampCharLevel } from './CharGrowthConfig';

export type CharGrowthSave = Partial<Record<CharacterId, { level: number; exp: number }>>;

function isCharacterId(x: unknown): x is CharacterId {
    return typeof x === 'string' && (CHARACTERS as string[]).indexOf(x) >= 0;
}

interface GrowthEntry { level: number; exp: number }

export class CharacterGrowthModel {
    private _entries: Record<string, GrowthEntry> = {};

    constructor() {
        for (const c of CHARACTERS) this._entries[c] = { level: 1, exp: 0 };
    }

    private _entry(id: CharacterId): GrowthEntry {
        if (!this._entries[id]) this._entries[id] = { level: 1, exp: 0 };
        return this._entries[id];
    }

    levelOf(id: CharacterId): number { return this._entry(id).level; }
    expOf(id: CharacterId): number { return this._entry(id).exp; }

    // 返回本次调用是否至少升了一级（供 UI 飘字判断）。
    gainExp(id: CharacterId, amount: number): boolean {
        if (amount <= 0) return false;
        const e = this._entry(id);
        const maxLevel = clampCharLevel(Number.POSITIVE_INFINITY);
        if (e.level >= maxLevel) return false;   // 已满级，经验不再累加
        e.exp += amount;
        let leveledUp = false;
        while (e.level < maxLevel) {
            const need = expToNext(e.level);
            if (e.exp < need) break;
            e.exp -= need;
            e.level++;
            leveledUp = true;
        }
        if (e.level >= maxLevel) { e.level = maxLevel; e.exp = 0; }   // 封顶后不留溢出经验
        return leveledUp;
    }

    serialize(): CharGrowthSave {
        const out: CharGrowthSave = {};
        for (const c of CHARACTERS) out[c] = { ...this._entries[c] };
        return out;
    }

    static deserialize(save: CharGrowthSave | undefined): CharacterGrowthModel {
        const m = new CharacterGrowthModel();
        if (!save) return m;
        for (const key of Object.keys(save)) {
            if (!isCharacterId(key)) continue;
            const raw = save[key];
            if (!raw) continue;
            const level = clampCharLevel(Number.isFinite(raw.level) ? raw.level : 1);
            const exp = Number.isFinite(raw.exp) && raw.exp > 0 ? raw.exp : 0;
            m._entries[key] = { level, exp };
        }
        return m;
    }
}
