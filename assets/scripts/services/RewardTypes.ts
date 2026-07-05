import type { EquipItem, GemType } from '../inventory/EquipDefs';
import type { ChestItem } from '../chest/ChestModel';

export type RewardSource = 'Monster' | 'StageClear' | 'Boss' | 'Offline';

// 宝石按"类型_等级"拆细；铭文卷轴用于铭文系统；打造石保留。
// ⚠️ 等级范围 1~4 与 inlay.xlsx/Gems.maxLevel 耦合（见 plan Global Constraints）。
export type GemMaterialId = `gem_${GemType}_${1 | 2 | 3 | 4}`;
export type MaterialId = 'forge_stone' | 'rune_scroll' | GemMaterialId;

export interface MaterialItem {
    id: MaterialId;
    count: number;
}

export type MaterialSave = Partial<Record<MaterialId, number>>;

const GEM_TYPE_LABEL: Record<GemType, string> = {
    atk: '攻击', hp: '生命', def: '防御', crit: '暴击', dmg: '增伤',
};

// 程序化生成材料标签（宝石键 = 类型×1~4，避免手写 20 行），断言为完整 Record。
function buildMaterialLabels(): Record<MaterialId, string> {
    const out: Record<string, string> = {
        forge_stone: '打造石',
        rune_scroll: '铭文卷轴',
    };
    const types: GemType[] = ['atk', 'hp', 'def', 'crit', 'dmg'];
    for (const t of types) {
        for (let lv = 1; lv <= 4; lv++) {
            out[`gem_${t}_${lv}`] = `${GEM_TYPE_LABEL[t]}宝石·Lv.${lv}`;
        }
    }
    return out as Record<MaterialId, string>;
}

export const MATERIAL_LABEL: Record<MaterialId, string> = buildMaterialLabels();

export function gemMaterialId(type: GemType, level: number): MaterialId {
    return `gem_${type}_${level}` as MaterialId;
}

export interface RewardBundle {
    gold: number;
    exp: number;
    equipments: EquipItem[];
    chests: ChestItem[];
    materials: MaterialItem[];
}

export function emptyRewardBundle(): RewardBundle {
    return { gold: 0, exp: 0, equipments: [], chests: [], materials: [] };
}
