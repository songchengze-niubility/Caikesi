// 汇总一件装备的宝石 + 铭文加成为一份 EquipStats（纯函数，不依赖 cc）。
// 供 EffectiveStats 在装备词条之外再叠这一份。

import { EquipItem, EquipStats, EquipStatKey } from '../inventory/EquipDefs';
import { gemStatKey, gemStatValue, roundInlayStat } from './InlayConfig';

export function itemInlayStats(item: EquipItem): EquipStats {
    const out: EquipStats = {};
    const add = (key: EquipStatKey, v: number) => {
        out[key] = roundInlayStat(key, (out[key] ?? 0) + v);
    };
    for (const gem of item.gemSockets ?? []) {
        if (!gem) continue;
        add(gemStatKey(gem.type), gemStatValue(gem.type, gem.level));
    }
    for (const insc of item.inscriptions ?? []) {
        if (!insc) continue;
        add(insc.stat, insc.value);
    }
    return out;
}
