import { Color, EventTouch, Graphics, Label, Node, Sprite, SpriteFrame, TTFFont, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';
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
    onCharTalent: () => void;   // 角色天赋面板（左上角头像热区；独立按钮美术后置给 Codex）
}

const REF_W = 941;
const REF_H = 1672;

// 按压反馈与点击涟漪调参常量（手感不对改这里）
const PRESS_SCALE = 0.92;                           // 按下缩到基准的比例
const PRESS_IN_SEC = 0.08;                          // 按下缩小时长
const PRESS_OUT_SEC = 0.18;                         // 松手回弹时长（backOut 带过冲）
const PRESS_DARKEN = new Color(217, 217, 217);      // 按下时精灵压暗色（≈85% 灰度）
const RIPPLE_COLOR = new Color(38, 36, 31, 200);    // 涟漪描边色（墨色，与 UI 文字同源），a 为初始不透明度
const RIPPLE_RADIUS = 34;                           // 涟漪基准半径（源像素）
const RIPPLE_LINE_WIDTH = 6;                        // 涟漪描边宽（源像素）
const RIPPLE_START_SCALE = 0.35;
const RIPPLE_END_SCALE = 1.6;
const RIPPLE_SEC = 0.3;

export const MAIN_UI_RECTS = {
    skill1: { x: 280, y: 825, w: 108, h: 108 },
    skill2: { x: 416, y: 825, w: 108, h: 108 },
    skill3: { x: 552, y: 825, w: 108, h: 108 },
};

interface SpriteDef { name: string; key: string; rect: UiRect }
type FontRole = 'text' | 'number';

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
    { name: 'NavMain', key: 'ui/main/nav/main', rect: { x: 14, y: 1585, w: 160, h: 86 } },
    { name: 'NavSquad', key: 'ui/main/nav/squad', rect: { x: 202, y: 1585, w: 160, h: 86 } },
    { name: 'NavBag', key: 'ui/main/nav/bag', rect: { x: 390, y: 1585, w: 160, h: 86 } },
    { name: 'NavCharacter', key: 'ui/main/nav/character', rect: { x: 578, y: 1585, w: 160, h: 86 } },
    { name: 'NavRune', key: 'ui/main/nav/rune', rect: { x: 766, y: 1585, w: 160, h: 86 } },
];

export const MAIN_UI_ART_KEYS = [...new Set(SPRITES.map(sprite => sprite.key))];

export class MainScreenView {
    readonly root: Node;
    private readonly sprites: Record<string, Node> = {};
    private readonly labels: Record<string, Label> = {};
    private readonly pressBaseScale = new Map<Node, Vec3>();
    private activeCharacter: CharacterId = 'tank';
    private refreshIn = 0;
    private uiFont: TTFFont | null = null;
    private numberFont: TTFFont | null = null;

    constructor(private readonly options: MainScreenViewOptions) {
        this.root = new Node('MainScreenUi');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(REF_W * options.styleScale, REF_H * options.styleScale);
        options.host.addChild(this.root);
        // 空白处点击也出涟漪：热区自身已 stopPropagation 并各自出涟漪，不会双重触发；
        // 不拦截冒泡，BattleEntry 根节点的「点击重开」等祖先监听不受影响。
        this.root.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.spawnRipple(event), this);
    }

    build(): void {
        this.root.removeAllChildren();
        this.pressBaseScale.clear();
        for (const key of Object.keys(this.sprites)) delete this.sprites[key];
        for (const key of Object.keys(this.labels)) delete this.labels[key];
        for (const def of SPRITES) this.addSprite(def);
        this.buildLabels();
        this.buildHotZones();
        this.positionSelectedRing();
        this.refreshIn = 0;
    }

    setFonts(textFont: TTFFont | null, numberFont: TTFFont | null): void {
        this.uiFont = textFont;
        this.numberFont = numberFont;
    }

    update(manager: BattleManager, dt: number): void {
        this.setText('chapter', manager.levelName);
        this.setText('wave', `${manager.waveIndex + 1}/${manager.totalWaves}`);
        this.refreshIn -= dt;
        if (this.refreshIn <= 0) {
            this.refreshIn = 0.25;
            this.refreshSnapshot();
        }
    }

    private refreshSnapshot(): void {
        const data = this.options.getSnapshot(this.activeCharacter);
        this.setText('power', String(data.power));
        this.setText('gold', String(data.gold));
        this.setText('gem', String(data.gems));
        this.setText('captain', CHARACTER_LABEL[this.activeCharacter]);
        this.setText('level', `Lv.${data.level}  ${data.exp}/${data.expNext}`);
        this.setText('stat0', String(data.power));
        this.setText('stat1', String(Math.round(data.stats.hp)));
        this.setText('stat2', String(Math.round(data.stats.atk)));
        this.setText('stat3', String(Math.round(data.stats.def)));
        this.setText('stat4', String(Math.round(data.stats.moveSpeed)));
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
        this.addLabel('powerTitle', '战力', { x: 136, y: 108, w: 62, h: 38 }, 19, white);
        this.addLabel('power', '', { x: 194, y: 104, w: 130, h: 44 }, 28, gold, 'number');
        this.addLabel('chapter', '', { x: 350, y: 44, w: 270, h: 48 }, 28, white);
        this.addLabel('wave', '', { x: 415, y: 143, w: 120, h: 38 }, 24, ink, 'number');
        this.addLabel('waveSuffix', '波', { x: 530, y: 145, w: 36, h: 36 }, 19, ink);
        this.addLabel('gold', '', { x: 805, y: 47, w: 115, h: 44 }, 27, white, 'number');
        this.addLabel('gem', '', { x: 805, y: 120, w: 115, h: 44 }, 27, white, 'number');
        this.addLabel('auto0', '自动', { x: 290, y: 910, w: 88, h: 28 }, 17, gold);
        this.addLabel('auto1', '自动', { x: 426, y: 910, w: 88, h: 28 }, 17, gold);
        this.addLabel('auto2', '自动', { x: 562, y: 910, w: 88, h: 28 }, 17, gold);
        this.addLabel('captain', '', { x: 73, y: 1207, w: 190, h: 36 }, 21, ink);
        this.addLabel('level', '', { x: 73, y: 1251, w: 190, h: 36 }, 16, ink, 'number');
        const slotRects: UiRect[] = [
            { x: 330, y: 1100, w: 148, h: 34 }, { x: 515, y: 1100, w: 148, h: 34 },
            { x: 700, y: 1100, w: 148, h: 34 }, { x: 425, y: 1272, w: 148, h: 34 },
            { x: 610, y: 1272, w: 148, h: 34 },
        ];
        for (let i = 0; i < slotRects.length; i++) this.addLabel(`slot${i}`, '', slotRects[i], 16, ink);
        const statX = [65, 230, 395, 560, 725];
        const statTitles = ['总战力', '生命', '攻击', '防御', '速度'];
        for (let i = 0; i < 5; i++) {
            this.addLabel(`statTitle${i}`, statTitles[i], { x: statX[i], y: 1417, w: 150, h: 28 }, 14, white);
            this.addLabel(`stat${i}`, '', { x: statX[i], y: 1443, w: 150, h: 45 }, 20, white, 'number');
        }
        this.addLabel('change', '更换装备', { x: 300, y: 1519, w: 340, h: 50 }, 29, ink);
        const navText = ['主界面', '小队', '背包', '角色', '符文'];
        for (let i = 0; i < navText.length; i++) {
            this.addLabel(`nav${i}`, navText[i], { x: 13 + i * 188, y: 1635, w: 165, h: 30 }, 18, i === 0 ? gold : white);
        }
    }

    private buildHotZones(): void {
        this.addHotZone('ChangeHot', { x: 278, y: 1505, w: 385, h: 79 }, this.options.onCharacter, 'ChangeButton', 'change');
        this.addHotZone('AvatarHot', { x: 8, y: 10, w: 165, h: 165 }, this.options.onCharTalent, 'HudAvatar', 'avatar');
        this.addHotZone('GoldHot', { x: 738, y: 35, w: 195, h: 66 }, () => {}, 'HudGold', 'gold');
        this.addHotZone('GemHot', { x: 738, y: 108, w: 195, h: 66 }, this.options.onChests, 'HudGem', 'gem');
        this.addHotZone('NavMainHot', { x: 0, y: 1584, w: 188, h: 88 }, this.options.onTalent, 'NavMain', 'nav0');
        this.addHotZone('NavSquadHot', { x: 188, y: 1584, w: 188, h: 88 }, this.options.onSquad, 'NavSquad', 'nav1');
        this.addHotZone('NavBagHot', { x: 376, y: 1584, w: 188, h: 88 }, this.options.onBag, 'NavBag', 'nav2');
        this.addHotZone('NavCharacterHot', { x: 564, y: 1584, w: 188, h: 88 }, this.options.onCharacter, 'NavCharacter', 'nav3');
        this.addHotZone('NavRuneHot', { x: 752, y: 1584, w: 189, h: 88 }, this.options.onRune, 'NavRune', 'nav4');
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
        // UI 切片以完整原始画布定位；关闭运行时 trim，避免透明留白被裁掉后
        // 图标主体被重新拉满目标矩形（底部导航会因此异常放大）。
        sprite.trim = false;
        this.root.addChild(node);
        this.sprites[def.name] = node;
    }

    private addLabel(id: string, text: string, rect: UiRect, size: number, color: Color, role: FontRole = 'text'): void {
        const node = new Node('Label_' + id);
        node.layer = this.root.layer;
        const box = this.sourceRect(rect);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        node.setPosition(box.x, box.y, 0);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size * this.options.styleScale;
        label.lineHeight = (size + 2) * this.options.styleScale;
        label.color = color;
        label.font = role === 'number' ? this.numberFont : this.uiFont;
        label.cacheMode = Label.CacheMode.CHAR;
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = false;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.root.addChild(node);
        this.labels[id] = label;
    }

    private setText(id: string, text: string): void {
        const label = this.labels[id];
        if (label && label.string !== text) label.string = text;
    }

    private addHotZone(name: string, rect: UiRect, onClick: () => void, feedbackName?: string, labelId?: string): void {
        const node = new Node(name);
        node.layer = this.root.layer;
        const box = this.sourceRect(rect);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        node.setPosition(box.x, box.y, 0);
        this.root.addChild(node);
        let pressed: Node[] = [];
        node.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
            event.propagationStopped = true;
            this.spawnRipple(event);
            pressed = this.feedbackTargets(feedbackName, labelId);
            this.pressDown(pressed);
        }, this);
        node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            event.propagationStopped = true;
            this.pressUp(pressed);
            pressed = [];
            onClick();
        }, this);
        node.on(Node.EventType.TOUCH_CANCEL, () => {
            this.pressUp(pressed);
            pressed = [];
        }, this);
    }

    /** 按压反馈目标：按钮底图 + 盖在上面的文字（兄弟节点，需同步缩放防穿帮）。 */
    private feedbackTargets(feedbackName?: string, labelId?: string): Node[] {
        const targets: Node[] = [];
        if (feedbackName && this.sprites[feedbackName]) targets.push(this.sprites[feedbackName]);
        if (labelId && this.labels[labelId]) targets.push(this.labels[labelId].node);
        return targets;
    }

    private pressDown(targets: Node[]): void {
        for (const target of targets) {
            Tween.stopAllByTarget(target);
            // 基准缩放只记录一次，回弹播完才删除；动画中途再按不会把缩小态当基准。
            let base = this.pressBaseScale.get(target);
            if (!base) {
                base = new Vec3(target.scale.x, target.scale.y, target.scale.z);
                this.pressBaseScale.set(target, base);
            }
            tween(target)
                .to(PRESS_IN_SEC, { scale: new Vec3(base.x * PRESS_SCALE, base.y * PRESS_SCALE, base.z) }, { easing: 'quadOut' })
                .start();
            const sprite = target.getComponent(Sprite);
            if (sprite) sprite.color = PRESS_DARKEN.clone();
        }
    }

    private pressUp(targets: Node[]): void {
        for (const target of targets) {
            const sprite = target.getComponent(Sprite);
            if (sprite) sprite.color = Color.WHITE.clone();
            const base = this.pressBaseScale.get(target);
            if (!base) continue;
            Tween.stopAllByTarget(target);
            tween(target)
                .to(PRESS_OUT_SEC, { scale: new Vec3(base.x, base.y, base.z) }, { easing: 'backOut' })
                .call(() => this.pressBaseScale.delete(target))
                .start();
        }
    }

    /** 触点处的点击特效：Graphics 墨色墨圈，扩散+淡出后自毁（将来可换 Codex 墨溅序列帧）。 */
    private spawnRipple(event: EventTouch): void {
        const transform = this.root.getComponent(UITransform);
        if (!transform) return;
        const touch = event.getUILocation();
        const local = transform.convertToNodeSpaceAR(new Vec3(touch.x, touch.y, 0));
        const node = new Node('ClickRipple');
        node.layer = this.root.layer;
        node.addComponent(UITransform);
        node.setPosition(local.x, local.y, 0);
        node.setScale(RIPPLE_START_SCALE, RIPPLE_START_SCALE, 1);
        const graphics = node.addComponent(Graphics);
        graphics.lineWidth = RIPPLE_LINE_WIDTH * this.options.styleScale;
        graphics.strokeColor = RIPPLE_COLOR.clone();
        graphics.circle(0, 0, RIPPLE_RADIUS * this.options.styleScale);
        graphics.stroke();
        const opacity = node.addComponent(UIOpacity);
        opacity.opacity = RIPPLE_COLOR.a;
        this.root.addChild(node);
        tween(node)
            .to(RIPPLE_SEC, { scale: new Vec3(RIPPLE_END_SCALE, RIPPLE_END_SCALE, 1) }, { easing: 'quadOut' })
            .start();
        tween(opacity)
            .to(RIPPLE_SEC, { opacity: 0 }, { easing: 'quadOut' })
            .call(() => node.destroy())
            .start();
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
