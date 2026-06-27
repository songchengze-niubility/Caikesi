// 装备定义（占位）：部位/品质/颜色/名字池 + 随机生成。
// 纯数据，不依赖 cc。后续接 equip.xlsx 时整体替换，Model/UI 接口不变。

export type EquipSlot = 'weapon' | 'helmet' | 'chest' | 'pants' | 'shoes'; // 武器/头盔/胸甲/裤子/鞋子
export type Quality = 'common' | 'fine' | 'rare' | 'epic' | 'legend';       // 白/绿/蓝/紫/橙

export interface EquipItem {
    id: string;        // 实例唯一 id
    slot: EquipSlot;   // 部位
    name: string;      // 占位名
    quality: Quality;  // 品质
}

export const SLOTS: EquipSlot[] = ['weapon', 'helmet', 'chest', 'pants', 'shoes'];
export const SLOT_LABEL: Record<EquipSlot, string> = {
    weapon: '武器', helmet: '头盔', chest: '胸甲', pants: '裤子', shoes: '鞋子',
};

export const QUALITIES: Quality[] = ['common', 'fine', 'rare', 'epic', 'legend'];
export const QUALITY_LABEL: Record<Quality, string> = {
    common: '普通', fine: '优秀', rare: '精良', epic: '史诗', legend: '传说',
};
export const QUALITY_COLOR: Record<Quality, [number, number, number]> = {
    common: [180, 180, 180], fine: [90, 200, 120], rare: [80, 150, 235],
    epic: [170, 90, 210], legend: [235, 160, 50],
};

const NAME_POOL: Record<EquipSlot, string[]> = {
    weapon: ['短剑', '长剑', '巨斧', '法杖'],
    helmet: ['皮帽', '铁盔', '头巾'],
    chest: ['布衣', '锁甲', '板甲'],
    pants: ['短裤', '护腿', '重甲裤'],
    shoes: ['草鞋', '皮靴', '战靴'],
};

let _seq = 0;
// Date(ms) + 自增序列 → 同一毫秒内也唯一
export function makeId(): string {
    return `eq_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export function randomItem(): EquipItem {
    const slot = pick(SLOTS);
    const quality = pick(QUALITIES);
    const name = pick(NAME_POOL[slot]);
    return { id: makeId(), slot, name, quality };
}
