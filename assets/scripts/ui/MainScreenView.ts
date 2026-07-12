import { Color, EventTouch, Label, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import type { ArtRegistry } from '../art/ArtRegistry';
import type { BattleManager } from '../combat/BattleManager';
import type { CombatStats } from '../config/BattleConfig';
import { CHARACTER_LABEL, CharacterId, EquipSlot, SLOT_LABEL } from '../inventory/EquipDefs';

export interface UiRect { x: number; y: number; w: number; h: number }

export interface MainUiSnapshot {
    gold: number;
    gems: number;
    power: number;
    level: number;
    exp: number;
    expNext: number;
    stats: CombatStats;
    equipment: Partial<Record<EquipSlot, string>>;
}

export interface MainScreenViewOptions {
    host: Node;
    styleScale: number;
    art: ArtRegistry<SpriteFrame>;
    getSnapshot: (character: CharacterId) => MainUiSnapshot;
    onSquad: () => void;
    onBag: () => void;
    onCharacter: () => void;
    onRune: () => void;
    onChests: () => void;
    onTalent: () => void;   // 心法（全局天赋树）面板
}

const REF_W = 941;
const REF_H = 1672;
const PRESS_SCALE = 0.94;

export const MAIN_UI_RECTS = {
    skill1: { x: 280, y: 825, w: 108, h: 108 },
    skill2: { x: 416, y: 825, w: 108, h: 108 },
    skill3: { x: 552, y: 825, w: 108, h: 108 },
};

interface SpriteDef { name: string; key: string; rect: UiRect }

const SPRITES: SpriteDef[] = [
    { name: 'PanelBackground', key: 'ui/main/panel/background', rect: { x: 0, y: 944, w: 941, h: 640 } },
    { name: 'HudAvatar', key: 'ui/main/hud/avatar', rect: { x: 8, y: 10, w: 165, h: 165 } },
    { name: 'HudPortrait', key: 'ui/main/nav/portrait', rect: { x: 42, y: 35, w: 96, h: 108 } },
    { name: 'HudPower', key: 'ui/main/hud/power', rect: { x: 120, y: 92, w: 220, h: 68 } },
    { name: 'HudChapterWave', key: 'ui/main/hud/chapter-wave', rect: { x: 335, y: 32, w: 300, h: 154 } },
    { name: 'HudGold', key: 'ui/main/hud/gold', rect: { x: 738, y: 35, w: 195, h: 66 } },
    { name: 'HudGem', key: 'ui/main/hud/gem', rect: { x: 738, y: 108, w: 195, h: 66 } },
    { name: 'Skill01', key: 'ui/main/skill/sword', rect: MAIN_UI_RECTS.skill1 },
    { name: 'Skill02', key: 'ui/main/skill/bow', rect: MAIN_UI_RECTS.skill2 },
    { name: 'Skill03', key: 'ui/main/skill/heal', rect: MAIN_UI_RECTS.skill3 },
    { name: 'CaptainCard', key: 'ui/main/panel/captain', rect: { x: 50, y: 970, w: 240, h: 326 } },
    { name: 'CaptainPortrait', key: 'ui/main/nav/portrait', rect: { x: 103, y: 1015, w: 132, h: 138 } },
    { name: 'SlotWeapon', key: 'ui/main/panel/equip-slot', rect: { x: 320, y: 970, w: 168, h: 176 } },
    { name: 'IconWeapon', key: 'ui/main/icon/weapon', rect: { x: 347, y: 988, w: 114, h: 112 } },
    { name: 'SlotHelmet', key: 'ui/main/panel/equip-slot', rect: { x: 505, y: 970, w: 168, h: 176 } },
    { name: 'IconHelmet', key: 'ui/main/icon/helmet', rect: { x: 532, y: 988, w: 114, h: 112 } },
    { name: 'SlotArmor', key: 'ui/main/panel/equip-slot', rect: { x: 690, y: 970, w: 168, h: 176 } },
    { name: 'IconArmor', key: 'ui/main/icon/armor', rect: { x: 717, y: 988, w: 114, h: 112 } },
    { name: 'SlotPants', key: 'ui/main/panel/equip-slot', rect: { x: 415, y: 1142, w: 168, h: 176 } },
    { name: 'IconPants', key: 'ui/main/icon/accessory', rect: { x: 442, y: 1160, w: 114, h: 112 } },
    { name: 'SlotShoes', key: 'ui/main/panel/equip-slot', rect: { x: 600, y: 1142, w: 168, h: 176 } },
    { name: 'IconShoes', key: 'ui/main/icon/boots', rect: { x: 627, y: 1160, w: 114, h: 112 } },
    { name: 'CharacterSwitch', key: 'ui/main/panel/char-switch', rect: { x: 50, y: 1300, w: 280, h: 105 } },
    { name: 'CharPortrait0', key: 'ui/main/nav/portrait', rect: { x: 70, y: 1318, w: 68, h: 68 } },
    { name: 'CharPortrait1', key: 'ui/main/nav/portrait', rect: { x: 155, y: 1318, w: 68, h: 68 } },
    { name: 'CharPortrait2', key: 'ui/main/nav/portrait', rect: { x: 240, y: 1318, w: 68, h: 68 } },
    { name: 'SelectedRing', key: 'ui/main/panel/selected', rect: { x: 64, y: 1312, w: 80, h: 80 } },
    { name: 'StatsStrip', key: 'ui/main/panel/stats', rect: { x: 55, y: 1408, w: 831, h: 96 } },
    { name: 'ChangeButton', key: 'ui/main/panel/change', rect: { x: 278, y: 1510, w: 385, h: 70 } },
    { name: 'NavBar', key: 'ui/main/nav/bar', rect: { x: 0, y: 1584, w: 941, h: 88 } },
    { name: 'NavMain', key: 'ui/main/nav/main', rect: { x: 8, y: 1585, w: 172, h: 86 } },
    { name: 'NavSquad', key: 'ui/main/nav/squad', rect: { x: 196, y: 1585, w: 172, h: 86 } },
    { name: 'NavBag', key: 'ui/main/nav/bag', rect: { x: 384, y: 1585, w: 172, h: 86 } },
    { name: 'NavCharacter', key: 'ui/main/nav/character', rect: { x: 572, y: 1585, w: 172, h: 86 } },
    { name: 'NavRune', key: 'ui/main/nav/rune', rect: { x: 760, y: 1585, w: 172, h: 86 } },
];

export const MAIN_UI_ART_KEYS = [...new Set(SPRITES.map(sprite => sprite.key))];

export class MainScreenView {
    readonly root: Node;
    private readonly sprites: Record<string, Node> = {};
    private readonly labels: Record<string, Label> = {};
    private readonly pressBaseScale = new Map<Node, Vec3>();
    private activeCharacter: CharacterId = 'tank';
    private refreshIn = 0;

    constructor(private readonly options: MainScreenViewOptions) {
        this.root = new Node('MainScreenUi');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(REF_W * options.styleScale, REF_H * options.styleScale);
        options.host.addChild(this.root);
    }

    build(): void {
        this.root.removeAllChildren();
        for (const key of Object.keys(this.sprites)) delete this.sprites[key];
        for (const key of Object.keys(this.labels)) delete this.labels[key];
        for (const def of SPRITES) this.addSprite(def);
        this.buildLabels();
        this.buildHotZones();
        this.positionSelectedRing();
        this.refreshIn = 0;
    }

    update(manager: BattleManager, dt: number): void {
        this.setText('chapter', manager.levelName);
        this.setText('wave', `${manager.waveIndex + 1}/${manager.totalWaves}波`);
        this.refreshIn -= dt;
        if (this.refreshIn <= 0) {
            this.refreshIn = 0.25;
            this.refreshSnapshot();
        }
    }

    private refreshSnapshot(): void {
        const data = this.options.getSnapshot(this.activeCharacter);
        this.setText('power', `战力 ${data.power}`);
        this.setText('gold', String(data.gold));
        this.setText('gem', String(data.gems));
        this.setText('captain', CHARACTER_LABEL[this.activeCharacter]);
        this.setText('level', `Lv.${data.level}  ${data.exp}/${data.expNext}`);
        this.setText('stat0', `总战力\n${data.power}`);
        this.setText('stat1', `生命\n${Math.round(data.stats.hp)}`);
        this.setText('stat2', `攻击\n${Math.round(data.stats.atk)}`);
        this.setText('stat3', `防御\n${Math.round(data.stats.def)}`);
        this.setText('stat4', `速度\n${Math.round(data.stats.moveSpeed)}`);
        const slots: EquipSlot[] = ['weapon', 'helmet', 'chest', 'pants', 'shoes'];
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            this.setText(`slot${i}`, data.equipment[slot] ?? SLOT_LABEL[slot]);
        }
    }

    private buildLabels(): void {
        const white = new Color(245, 243, 235);
        const ink = new Color(38, 36, 31);
        const gold = new Color(236, 199, 103);
        this.addLabel('power', '', { x: 135, y: 108, w: 190, h: 38 }, 25, gold);
        this.addLabel('chapter', '', { x: 360, y: 48, w: 250, h: 42 }, 25, white);
        this.addLabel('wave', '', { x: 405, y: 145, w: 160, h: 36 }, 22, ink);
        this.addLabel('gold', '', { x: 810, y: 50, w: 105, h: 38 }, 24, white);
        this.addLabel('gem', '', { x: 810, y: 123, w: 105, h: 38 }, 24, white);
        this.addLabel('auto0', '自动', { x: 290, y: 916, w: 88, h: 26 }, 18, gold);
        this.addLabel('auto1', '自动', { x: 426, y: 916, w: 88, h: 26 }, 18, gold);
        this.addLabel('auto2', '自动', { x: 562, y: 916, w: 88, h: 26 }, 18, gold);
        this.addLabel('captain', '', { x: 73, y: 1210, w: 190, h: 34 }, 21, ink);
        this.addLabel('level', '', { x: 73, y: 1255, w: 190, h: 32 }, 16, ink);
        const slotRects: UiRect[] = [
            { x: 330, y: 1100, w: 148, h: 34 }, { x: 515, y: 1100, w: 148, h: 34 },
            { x: 700, y: 1100, w: 148, h: 34 }, { x: 425, y: 1272, w: 148, h: 34 },
            { x: 610, y: 1272, w: 148, h: 34 },
        ];
        for (let i = 0; i < slotRects.length; i++) this.addLabel(`slot${i}`, '', slotRects[i], 17, ink);
        const statX = [65, 230, 395, 560, 725];
        for (let i = 0; i < 5; i++) this.addLabel(`stat${i}`, '', { x: statX[i], y: 1422, w: 150, h: 70 }, 16, white);
        this.addLabel('change', '更换装备', { x: 310, y: 1525, w: 320, h: 42 }, 27, ink);
        const navText = ['主界面', '小队', '背包', '角色', '符文'];
        for (let i = 0; i < navText.length; i++) {
            this.addLabel(`nav${i}`, navText[i], { x: 13 + i * 188, y: 1642, w: 165, h: 28 }, 17, i === 0 ? gold : white);
        }
    }

    private buildHotZones(): void {
        this.addHotZone('ChangeHot', { x: 278, y: 1505, w: 385, h: 79 }, this.options.onCharacter, 'ChangeButton');
        this.addHotZone('GoldHot', { x: 738, y: 35, w: 195, h: 66 }, () => {}, 'HudGold');
        this.addHotZone('GemHot', { x: 738, y: 108, w: 195, h: 66 }, this.options.onChests, 'HudGem');
        this.addHotZone('NavMainHot', { x: 0, y: 1584, w: 188, h: 88 }, this.options.onTalent, 'NavMain');
        this.addHotZone('NavSquadHot', { x: 188, y: 1584, w: 188, h: 88 }, this.options.onSquad, 'NavSquad');
        this.addHotZone('NavBagHot', { x: 376, y: 1584, w: 188, h: 88 }, this.options.onBag, 'NavBag');
        this.addHotZone('NavCharacterHot', { x: 564, y: 1584, w: 188, h: 88 }, this.options.onCharacter, 'NavCharacter');
        this.addHotZone('NavRuneHot', { x: 752, y: 1584, w: 189, h: 88 }, this.options.onRune, 'NavRune');
        const chars: CharacterId[] = ['tank', 'dps', 'healer'];
        for (let i = 0; i < chars.length; i++) {
            const index = i;
            this.addHotZone(`CharHot${i}`, { x: 55 + i * 85, y: 1305, w: 82, h: 95 }, () => {
                this.activeCharacter = chars[index];
                this.positionSelectedRing();
                this.refreshIn = 0;
            }, `CharPortrait${i}`);
        }
    }

    private positionSelectedRing(): void {
        const ring = this.sprites.SelectedRing;
        if (!ring) return;
        const index = (['tank', 'dps', 'healer'] as CharacterId[]).indexOf(this.activeCharacter);
        const box = this.sourceRect({ x: 64 + index * 85, y: 1312, w: 80, h: 80 });
        ring.setPosition(box.x, box.y, 0);
    }

    private addSprite(def: SpriteDef): void {
        const frame = this.options.art.getSprite(def.key);
        if (!frame) return;
        const node = new Node(def.name);
        node.layer = this.root.layer;
        const box = this.sourceRect(def.rect);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        node.setPosition(box.x, box.y, 0);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        this.root.addChild(node);
        this.sprites[def.name] = node;
    }

    private addLabel(id: string, text: string, rect: UiRect, size: number, color: Color): void {
        const node = new Node('Label_' + id);
        node.layer = this.root.layer;
        const box = this.sourceRect(rect);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        node.setPosition(box.x, box.y, 0);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size * this.options.styleScale;
        label.lineHeight = (size + 3) * this.options.styleScale;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.root.addChild(node);
        this.labels[id] = label;
    }

    private setText(id: string, text: string): void {
        const label = this.labels[id];
        if (label && label.string !== text) label.string = text;
    }

    private addHotZone(name: string, rect: UiRect, onClick: () => void, feedbackName?: string): void {
        const node = new Node(name);
        node.layer = this.root.layer;
        const box = this.sourceRect(rect);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        node.setPosition(box.x, box.y, 0);
        this.root.addChild(node);
        let pressed: Node | null = null;
        node.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
            event.propagationStopped = true;
            pressed = feedbackName ? this.sprites[feedbackName] ?? null : null;
            if (!pressed) return;
            const scale = pressed.scale;
            this.pressBaseScale.set(pressed, new Vec3(scale.x, scale.y, scale.z));
            pressed.setScale(scale.x * PRESS_SCALE, scale.y * PRESS_SCALE, scale.z);
        }, this);
        node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            event.propagationStopped = true;
            this.releasePressed(pressed);
            pressed = null;
            onClick();
        }, this);
        node.on(Node.EventType.TOUCH_CANCEL, () => {
            this.releasePressed(pressed);
            pressed = null;
        }, this);
    }

    private releasePressed(node: Node | null): void {
        if (!node) return;
        const scale = this.pressBaseScale.get(node);
        if (scale) node.setScale(scale.x, scale.y, scale.z);
        this.pressBaseScale.delete(node);
    }

    sourceRect(rect: UiRect): { x: number; y: number; w: number; h: number } {
        return {
            x: (rect.x + rect.w / 2 - REF_W / 2) * this.options.styleScale,
            y: (REF_H / 2 - rect.y - rect.h / 2) * this.options.styleScale,
            w: rect.w * this.options.styleScale,
            h: rect.h * this.options.styleScale,
        };
    }
}
