// 出战小队（纯逻辑，不依赖 cc）：谁上阵、前后站位顺序、上限约束、非法存档自愈。
// BattleEntry 用它决定传给 BattleManager 的 roster；持久化经 PlayerData.squad。
// deployed[0] = 一字阵最前（贴敌），越靠后越靠后排。

import { CHARACTERS, CharacterId } from '../inventory/EquipDefs';
import { BattleConfig } from '../config/BattleConfig';

export interface SquadSave {
    deployed: CharacterId[];   // 有序，deployed[0] = 一字阵最前
}

function isCharacterId(x: unknown): x is CharacterId {
    return typeof x === 'string' && (CHARACTERS as string[]).indexOf(x) >= 0;
}

// 合法默认出战组合：取配置 roster 里合法、去重的前 squadCap 个；空则回落首个角色。
function defaultDeployed(squadCap: number): CharacterId[] {
    const out: CharacterId[] = [];
    for (const c of BattleConfig.roster as CharacterId[]) {
        if (isCharacterId(c) && out.indexOf(c) < 0) out.push(c);
        if (out.length >= squadCap) break;
    }
    if (out.length === 0 && CHARACTERS.length > 0) out.push(CHARACTERS[0]);
    return out;
}

export class SquadModel {
    private _deployed: CharacterId[];
    readonly squadCap: number;

    constructor(deployed: CharacterId[], squadCap: number) {
        this.squadCap = Math.max(1, squadCap);
        this._deployed = deployed.slice(0, this.squadCap);
        if (this._deployed.length === 0) this._deployed = defaultDeployed(this.squadCap);
    }

    deployedList(): CharacterId[] { return this._deployed.slice(); }
    benchList(): CharacterId[] { return CHARACTERS.filter(c => this._deployed.indexOf(c) < 0); }
    isDeployed(id: CharacterId): boolean { return this._deployed.indexOf(id) >= 0; }
    isFull(): boolean { return this._deployed.length >= this.squadCap; }

    deploy(id: CharacterId): boolean {
        if (!isCharacterId(id) || this.isDeployed(id) || this.isFull()) return false;
        this._deployed.push(id);
        return true;
    }

    undeploy(id: CharacterId): boolean {
        const i = this._deployed.indexOf(id);
        if (i < 0 || this._deployed.length <= 1) return false;   // 保底至少 1 人
        this._deployed.splice(i, 1);
        return true;
    }

    move(id: CharacterId, toIndex: number): boolean {
        const from = this._deployed.indexOf(id);
        if (from < 0) return false;
        const to = Math.max(0, Math.min(toIndex, this._deployed.length - 1));
        if (to === from) return true;
        this._deployed.splice(from, 1);
        this._deployed.splice(to, 0, id);
        return true;
    }

    serialize(): SquadSave { return { deployed: this._deployed.slice() }; }

    static deserialize(save: SquadSave | undefined, squadCap: number): SquadModel {
        const cap = Math.max(1, squadCap);
        const raw = save?.deployed ?? [];
        const seen = new Set<CharacterId>();
        const clean: CharacterId[] = [];
        for (const c of raw) {
            if (isCharacterId(c) && !seen.has(c)) { seen.add(c); clean.push(c); }
        }
        const capped = clean.slice(0, cap);
        return new SquadModel(capped.length ? capped : defaultDeployed(cap), cap);
    }
}
