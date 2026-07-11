import { Color, EventTouch, Graphics, Label, Mask, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { Background } from '../combat/Background';
import type { BattleManager, SkillCastEvent, UnitAction } from '../combat/BattleManager';
import { BattleConfig, SoldierClass } from '../config/BattleConfig';
import { CHARACTERS } from '../inventory/EquipDefs';
import type { ArtRegistry } from '../art/ArtRegistry';
import { FrameAnimPlayer } from '../art/FrameAnim';

interface UiRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface FrameClip {
    frames: SpriteFrame[];
    fps: number;
    loop: boolean;
    pingpong: boolean;
    blend: number;
    bodyH?: number;
    anchorX?: number;
    footY?: number;
}

export function frameClipVisualBox(targetH: number, clip: FrameClip): { w: number; h: number; offsetX: number; offsetY: number } {
    const rect = clip.frames[0].rect;
    const frameW = Math.max(1, rect.width);
    const frameH = Math.max(1, rect.height);
    if (!clip.bodyH || clip.bodyH <= 0) {
        return { w: targetH * (frameW / frameH), h: targetH, offsetX: 0, offsetY: 0 };
    }
    const scale = targetH / (clip.bodyH * frameH);
    const w = frameW * scale;
    const h = frameH * scale;
    return {
        w,
        h,
        offsetX: clip.anchorX != null ? (0.5 - clip.anchorX) * w : 0,
        offsetY: clip.footY != null ? (clip.footY - 0.5) * h - targetH / 2 : 0,
    };
}

interface SoldierVisual {
    node: Node;
    anim: FrameAnimPlayer;
    clips: Partial<Record<UnitAction, FrameClip>>;
    currentAction: UnitAction | null;
    visualHeight: number;
    offsetX: number;
    offsetY: number;
}

export interface BattleStageViewOptions {
    host: Node;
    halfW: number;
    halfH: number;
    styleScale: number;
    art: ArtRegistry<SpriteFrame>;
    onHeroes: () => void;
    onInventory: () => void;
    onCraft: () => void;
    onChests: () => void;
}

const UI_REF_W = 941;
const UI_REF_H = 1672;
const PRESS_SCALE = 0.94;

const UI_RECTS = {
    profile: { x: 8, y: 6, w: 326, h: 142 },
    gold: { x: 349, y: 36, w: 205, h: 52 },
    jade: { x: 568, y: 39, w: 160, h: 51 },
    energy: { x: 745, y: 34, w: 190, h: 59 },
    chapter: { x: 312, y: 94, w: 310, h: 62 },
    wave: { x: 315, y: 160, w: 314, h: 75 },
    reward: { x: 780, y: 104, w: 161, h: 140 },
    skill1: { x: 256, y: 1302, w: 142, h: 154 },
    skill2: { x: 404, y: 1296, w: 128, h: 149 },
    skill3: { x: 535, y: 1278, w: 156, h: 172 },
    navBar: { x: -2, y: 1440, w: 944, h: 270 },
    navHome: { x: 6, y: 1491, w: 163, h: 158 },
    navHeroes: { x: 174, y: 1491, w: 161, h: 161 },
    navBattle: { x: 363, y: 1484, w: 205, h: 171 },
    navEquipment: { x: 578, y: 1490, w: 118, h: 161 },
    navBag: { x: 702, y: 1493, w: 101, h: 164 },
    navSect: { x: 807, y: 1482, w: 128, h: 176 },
};

const STYLED_UI_SPRITES: { key: string; rect: UiRect; name: string }[] = [
    { key: 'ui/battle/hud/profile', rect: UI_RECTS.profile, name: 'HudProfile' },
    { key: 'ui/battle/hud/gold', rect: UI_RECTS.gold, name: 'HudGold' },
    { key: 'ui/battle/hud/jade', rect: UI_RECTS.jade, name: 'HudJade' },
    { key: 'ui/battle/hud/energy', rect: UI_RECTS.energy, name: 'HudEnergy' },
    { key: 'ui/battle/stage/chapter', rect: UI_RECTS.chapter, name: 'StageChapter' },
    { key: 'ui/battle/stage/wave', rect: UI_RECTS.wave, name: 'StageWave' },
    { key: 'ui/battle/stage/reward', rect: UI_RECTS.reward, name: 'StageReward' },
    { key: 'ui/battle/skills/skill_01', rect: UI_RECTS.skill1, name: 'Skill01' },
    { key: 'ui/battle/skills/skill_02', rect: UI_RECTS.skill2, name: 'Skill02' },
    { key: 'ui/battle/skills/skill_03', rect: UI_RECTS.skill3, name: 'Skill03' },
    { key: 'ui/battle/nav/bar', rect: UI_RECTS.navBar, name: 'BottomNav' },
];

const STYLED_UI_KEYS = STYLED_UI_SPRITES.map(sprite => sprite.key);
const SOLDIER_ACTION_ORDER: UnitAction[] = ['idle', 'run', 'attack', 'death'];
const SOLDIER_ACTION_ART: Record<SoldierClass, Record<UnitAction, string>> = {
    tank: {
        idle: 'char/tank/idle',
        run: 'char/tank/run',
        attack: 'char/tank/attack',
        death: 'char/tank/death',
    },
    dps: {
        idle: 'char/dps/idle',
        run: 'char/dps/run',
        attack: 'char/dps/attack',
        death: 'char/dps/death',
    },
    healer: {
        idle: 'char/healer/idle',
        run: 'char/healer/run',
        attack: 'char/healer/attack',
        death: 'char/healer/death',
    },
};
const SOLDIER_ACTION_KEYS = (['tank', 'dps', 'healer'] as SoldierClass[]).reduce<string[]>((keys, cls) => {
    for (const action of SOLDIER_ACTION_ORDER) keys.push(SOLDIER_ACTION_ART[cls][action]);
    return keys;
}, []);

export class BattleStageView {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly portraitFrameGfx: Graphics;
    private readonly uiRoot: Node;
    private readonly skillGfx: Graphics;
    private readonly background: Background;
    private readonly backgroundSprite: Sprite;
    private readonly backgroundSpriteNode: Node;
    private readonly waveLabel: Label;
    private readonly hpLabel: Label;
    private readonly statusLabel: Label;
    private readonly rewardLabel: Label;
    private readonly soldierSprites: Partial<Record<SoldierClass, SoldierVisual>> = {};
    private readonly styledUiNodes: Record<string, Node> = {};
    private readonly pressBaseScale = new Map<Node, Vec3>();
    private readonly floats: Label[] = [];
    private readonly skillFlash: number[] = [0, 0, 0];
    private readonly tempColor = new Color();
    private shownWaveKey = -1;

    private readonly classColors: Record<SoldierClass, Color> = {
        tank: new Color(52, 66, 72, 235),
        dps: new Color(77, 78, 67, 235),
        healer: new Color(72, 122, 96, 235),
    };
    private readonly soldierHurtColor = new Color(110, 110, 120);
    private readonly enemyHpBgColor = new Color(38, 35, 31, 230);
    private readonly enemyHpColor = new Color(205, 74, 54, 235);
    private readonly allyHpColor = new Color(90, 170, 76, 235);
    private readonly bulletColor = new Color(75, 206, 164, 230);
    private readonly healBeamColor = new Color(110, 220, 170, 170);
    private readonly meleeBeamColor = new Color(240, 244, 232, 210);
    private readonly enemyAttackRingColor = new Color(245, 228, 196, 160);
    private readonly soldierShadowColor = new Color(28, 26, 22, 55);

    constructor(private readonly options: BattleStageViewOptions) {
        const stageW = UI_REF_W * options.styleScale;
        const stageH = UI_REF_H * options.styleScale;

        this.root = new Node('Battle');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);
        const mask = this.root.addComponent(Mask);
        mask.type = Mask.Type.GRAPHICS_RECT;
        options.host.addChild(this.root);
        this.root.setPosition(0, 0, 0);
        this.root.active = false;

        const backgroundNode = new Node('BgFallback');
        backgroundNode.layer = this.root.layer;
        backgroundNode.addComponent(UITransform);
        const backgroundGfx = backgroundNode.addComponent(Graphics);
        this.root.addChild(backgroundNode);
        this.background = new Background(backgroundGfx, options.halfW, options.halfH);

        this.backgroundSpriteNode = new Node('BgSprite');
        this.backgroundSpriteNode.layer = this.root.layer;
        this.backgroundSpriteNode.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);
        this.backgroundSprite = this.backgroundSpriteNode.addComponent(Sprite);
        this.backgroundSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.backgroundSpriteNode.active = false;
        this.root.addChild(this.backgroundSpriteNode);

        const gfxNode = new Node('Gfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);

        const frameNode = new Node('PortraitFrame');
        frameNode.layer = this.root.layer;
        frameNode.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);
        this.portraitFrameGfx = frameNode.addComponent(Graphics);
        this.root.addChild(frameNode);
        this.drawPortraitFrame(stageW, stageH);

        this.uiRoot = new Node('StyledUi');
        this.uiRoot.layer = this.root.layer;
        this.uiRoot.addComponent(UITransform).setContentSize(stageW, stageH);
        this.root.addChild(this.uiRoot);

        const skillGfxNode = new Node('SkillStatusGfx');
        skillGfxNode.layer = this.root.layer;
        skillGfxNode.addComponent(UITransform);
        this.skillGfx = skillGfxNode.addComponent(Graphics);
        this.root.addChild(skillGfxNode);

        this.waveLabel = this.makeLabel('', 0, options.halfH - 80, 40);
        this.hpLabel = this.makeLabel('', 0, options.halfH - 130, 30);
        this.statusLabel = this.makeLabel('', 0, 0, 56);
        this.statusLabel.color = new Color(255, 230, 120);
        this.rewardLabel = this.makeLabel('', 0, -70, 28);
        this.rewardLabel.color = new Color(255, 235, 170);
        this.positionStyledLabels();

        const noop = () => {};
        this.makeHotZone('Skill01Hot', UI_RECTS.skill1, noop, 'Skill01');
        this.makeHotZone('Skill02Hot', UI_RECTS.skill2, noop, 'Skill02');
        this.makeHotZone('Skill03Hot', UI_RECTS.skill3, noop, 'Skill03');
        this.makeHotZone('NavHomeHot', UI_RECTS.navHome, noop, 'BottomNav');
        this.makeHotZone('NavHeroesHot', UI_RECTS.navHeroes, options.onHeroes, 'BottomNav');
        this.makeHotZone('NavBattleHot', UI_RECTS.navBattle, noop, 'BottomNav');
        this.makeHotZone('NavEquipmentHot', UI_RECTS.navEquipment, options.onInventory, 'BottomNav');
        this.makeHotZone('NavBagHot', UI_RECTS.navBag, options.onInventory, 'BottomNav');
        this.makeHotZone('NavSectHot', UI_RECTS.navSect, options.onCraft, 'BottomNav');
        this.makeHotZone('RewardCardHot', UI_RECTS.reward, options.onChests, 'StageReward');
    }

    setActive(active: boolean): void {
        this.root.active = active;
    }

    addChild(node: Node): void {
        this.root.addChild(node);
    }

    async loadArt(initialRoster: SoldierClass[], extraKeys: string[] = []): Promise<void> {
        await this.options.art.preload(['bg/main', ...SOLDIER_ACTION_KEYS, ...STYLED_UI_KEYS, ...extraKeys]);
        const backgroundFrame = this.options.art.getSprite('bg/main');
        if (backgroundFrame) {
            this.backgroundSprite.spriteFrame = backgroundFrame;
            this.backgroundSpriteNode.active = true;
            this.background.setUsingSprite(true);
        }
        this.syncRoster(initialRoster);
        this.buildStyledUi();
        this.positionStyledLabels();

        const missing = this.options.art.missingKeys();
        if (missing.length) this.makeLabel('缺图: ' + missing.join(', '), 0, -this.options.halfH + 110, 18);
    }

    beginBattle(roster: SoldierClass[]): void {
        this.shownWaveKey = -1;
        this.syncRoster(roster);
        this.statusLabel.string = '';
        this.rewardLabel.string = '';
    }

    render(manager: BattleManager, dt: number, noticeText: string, noticeTtl: number, winRewardText: string): void {
        this.background.update(dt);
        this.updateSoldierVisualActions(manager);
        this.renderUnits(manager);
        this.renderFloats(manager);
        this.renderSkillStatus(manager, dt);
        this.updateSoldierAnimations(manager, dt);
        this.updateLabels(manager, noticeText, noticeTtl, winRewardText);
    }

    onSkillCast(manager: BattleManager, event: SkillCastEvent): void {
        const skills = this.skillSource(manager);
        if (!skills) return;
        for (let i = 0; i < Math.min(3, skills.count); i++) {
            if (skills.defAt(i)?.id === event.skillId) {
                this.skillFlash[i] = 0.3;
                break;
            }
        }
    }

    syncRoster(deployed: SoldierClass[]): void {
        for (const cls of deployed) {
            if (!this.soldierSprites[cls]) this.buildSoldierVisual(cls);
        }
        for (const cls of CHARACTERS as SoldierClass[]) {
            const visual = this.soldierSprites[cls];
            if (visual && deployed.indexOf(cls) < 0) visual.node.active = false;
        }
    }

    private soldierVisualHeight(cls: SoldierClass): number {
        return cls === 'dps' ? 180 : BattleConfig.classes[cls].size;
    }

    private clipVisualBox(cls: SoldierClass, clip: FrameClip): { w: number; h: number; offsetX: number; offsetY: number } {
        return frameClipVisualBox(this.soldierVisualHeight(cls), clip);
    }

    private loadSoldierClips(cls: SoldierClass): Partial<Record<UnitAction, FrameClip>> {
        const clips: Partial<Record<UnitAction, FrameClip>> = {};
        for (const action of SOLDIER_ACTION_ORDER) {
            const frames = this.options.art.getFrames(SOLDIER_ACTION_ART[cls][action]);
            if (frames) clips[action] = frames;
        }
        return clips;
    }

    private firstSoldierClip(clips: Partial<Record<UnitAction, FrameClip>>): FrameClip | null {
        for (const action of SOLDIER_ACTION_ORDER) {
            const clip = clips[action];
            if (clip) return clip;
        }
        return null;
    }

    private buildSoldierVisual(cls: SoldierClass): void {
        const clips = this.loadSoldierClips(cls);
        const clip = this.firstSoldierClip(clips);
        if (!clip) return;
        const node = new Node('Sol_' + cls);
        node.layer = this.root.layer;
        const box = this.clipVisualBox(cls, clip);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        const blendNode = new Node('SolBlend_' + cls);
        blendNode.layer = this.root.layer;
        blendNode.addComponent(UITransform).setContentSize(box.w, box.h);
        const blendSprite = blendNode.addComponent(Sprite);
        blendSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        node.addChild(blendNode);
        this.root.addChild(node);
        node.setSiblingIndex(this.uiRoot.getSiblingIndex());
        this.soldierSprites[cls] = {
            node,
            anim: new FrameAnimPlayer(sprite, clip.frames, clip.fps, clip.loop, clip.pingpong, blendSprite, clip.blend),
            clips,
            currentAction: null,
            visualHeight: this.soldierVisualHeight(cls),
            offsetX: box.offsetX,
            offsetY: box.offsetY,
        };
        this.setSoldierVisualAction(cls, 'idle', true);
    }

    private setSoldierVisualAction(cls: SoldierClass, action: UnitAction, force = false): void {
        const visual = this.soldierSprites[cls];
        if (!visual || (!force && visual.currentAction === action)) return;
        const clip = visual.clips[action] ?? visual.clips.idle ?? this.firstSoldierClip(visual.clips);
        if (!clip) return;
        const box = this.clipVisualBox(cls, clip);
        visual.node.getComponent(UITransform)!.setContentSize(box.w, box.h);
        const blend = visual.node.getChildByName('SolBlend_' + cls);
        if (blend) blend.getComponent(UITransform)!.setContentSize(box.w, box.h);
        visual.visualHeight = this.soldierVisualHeight(cls);
        visual.offsetX = box.offsetX;
        visual.offsetY = box.offsetY;
        visual.currentAction = action;
        visual.anim.setClip(clip.frames, clip.fps, clip.loop, clip.pingpong, clip.blend);
    }

    private updateSoldierVisualActions(manager: BattleManager): void {
        for (const soldier of manager.soldiers) this.setSoldierVisualAction(soldier.key as SoldierClass, soldier.action);
    }

    private updateSoldierAnimations(manager: BattleManager, dt: number): void {
        for (const soldier of manager.soldiers) this.soldierSprites[soldier.key as SoldierClass]?.anim.update(dt);
    }

    private floatAt(i: number): Label {
        while (i >= this.floats.length) {
            const node = new Node('Float');
            node.layer = this.root.layer;
            node.addComponent(UITransform);
            const label = node.addComponent(Label);
            label.cacheMode = Label.CacheMode.CHAR;
            this.root.addChild(node);
            this.floats.push(label);
        }
        return this.floats[i];
    }

    private renderFloats(manager: BattleManager): void {
        const list = manager.floatTexts;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const label = this.floatAt(i);
            label.node.active = true;
            label.node.setPosition(item.x, item.y, 0);
            label.string = item.text;
            const alpha = Math.max(0, Math.min(1, item.ttl / item.maxTtl)) * 255;
            switch (item.kind) {
                case 'crit': label.fontSize = 42; label.color = this.tempColor.set(255, 180, 40, alpha); break;
                case 'block': label.fontSize = 28; label.color = this.tempColor.set(120, 200, 255, alpha); break;
                case 'skill': label.fontSize = 36; label.color = this.tempColor.set(120, 235, 255, alpha); break;
                case 'heal': label.fontSize = 30; label.color = this.tempColor.set(140, 235, 140, alpha); break;
                case 'dodge': label.fontSize = 28; label.color = this.tempColor.set(210, 210, 210, alpha); break;
                default: label.fontSize = 30; label.color = this.tempColor.set(255, 255, 255, alpha); break;
            }
            label.lineHeight = label.fontSize + 4;
        }
        for (let i = list.length; i < this.floats.length; i++) this.floats[i].node.active = false;
    }

    private renderUnits(manager: BattleManager): void {
        const g = this.gfx;
        g.clear();
        const bulletRadius = BattleConfig.bullet.radius;
        g.fillColor = this.bulletColor;
        for (const bullet of manager.bullets) g.circle(bullet.x, bullet.y, bulletRadius);
        g.fill();

        for (const enemy of manager.enemies) {
            if (!enemy.alive && enemy.action !== 'death') continue;
            const deathFade = enemy.action === 'death' ? Math.max(0, 1 - enemy.actionTime / 0.9) : 1;
            const actionScale = enemy.action === 'attack' ? 1.08 : (enemy.action === 'death' ? 1.12 : 1);
            const radius = enemy.radius * actionScale;
            const alpha = enemy.action === 'death' ? Math.max(35, Math.round(180 * deathFade)) : 220;
            g.fillColor = this.tempColor.set(
                Math.max(48, Math.round(enemy.color[0] * 0.42)),
                Math.max(42, Math.round(enemy.color[1] * 0.42)),
                Math.max(38, Math.round(enemy.color[2] * 0.42)),
                alpha,
            );
            g.circle(enemy.x, enemy.y, radius);
            g.fill();
            if (enemy.action === 'attack' && enemy.alive) {
                g.strokeColor = this.enemyAttackRingColor;
                g.lineWidth = 3;
                g.circle(enemy.x, enemy.y, radius + 5);
                g.stroke();
            }
            if (!enemy.alive) continue;
            const ratio = Math.max(0, enemy.hp / enemy.maxHp);
            const barY = enemy.y + radius + 8;
            g.fillColor = this.enemyHpBgColor;
            g.rect(enemy.x - radius, barY, radius * 2, 6);
            g.fill();
            g.fillColor = this.enemyHpColor;
            g.rect(enemy.x - radius, barY, radius * 2 * ratio, 6);
            g.fill();
        }

        g.strokeColor = this.meleeBeamColor;
        g.lineWidth = 7;
        for (let i = 0; i < manager.meleeBeamCount; i++) {
            const beam = manager.meleeBeams[i];
            g.moveTo(beam.fromX, beam.fromY);
            g.lineTo(beam.toX, beam.toY);
        }
        g.stroke();

        g.strokeColor = this.healBeamColor;
        g.lineWidth = 4;
        for (let i = 0; i < manager.healBeamCount; i++) {
            const beam = manager.healBeams[i];
            g.moveTo(beam.fromX, beam.fromY);
            g.lineTo(beam.toX, beam.toY);
        }
        g.stroke();

        for (const soldier of manager.soldiers) {
            const cls = soldier.key as SoldierClass;
            const showDeath = !soldier.alive && soldier.action === 'death';
            if (!soldier.alive && !showDeath) {
                const hidden = this.soldierSprites[cls];
                if (hidden) hidden.node.active = false;
                continue;
            }
            const size = BattleConfig.classes[cls].size;
            const ratio = Math.max(0, soldier.hp / soldier.maxHp);
            const visual = this.soldierSprites[cls];
            if (visual) {
                visual.node.active = true;
                visual.node.setPosition(soldier.x + visual.offsetX, soldier.y + visual.offsetY, 0);
            } else {
                g.fillColor = this.soldierShadowColor;
                g.circle(soldier.x, soldier.y - size * 0.48, size * 0.45);
                g.fill();
                g.fillColor = ratio > 0.35 ? this.classColors[cls] : this.soldierHurtColor;
                g.roundRect(soldier.x - size / 2, soldier.y - size / 2, size, size, 8);
                g.fill();
            }
            if (!soldier.alive) continue;
            const visualHeight = visual ? visual.visualHeight : size;
            const barY = soldier.y + visualHeight / 2 + 6;
            g.fillColor = this.enemyHpBgColor;
            g.rect(soldier.x - size / 2, barY, size, 5);
            g.fill();
            g.fillColor = this.allyHpColor;
            g.rect(soldier.x - size / 2, barY, size * ratio, 5);
            g.fill();
        }
    }

    private updateLabels(manager: BattleManager, noticeText: string, noticeTtl: number, winRewardText: string): void {
        if (this.waveLabel.node.active) this.waveLabel.string = manager.levelName;
        const waveKey = manager.levelIndex * 1000 + manager.waveIndex;
        if (this.hpLabel.node.active && this.shownWaveKey !== waveKey) {
            this.shownWaveKey = waveKey;
            this.hpLabel.string = `${manager.waveIndex + 1}/${manager.totalWaves}波`;
        }
        if (manager.phase === 'won') {
            this.statusLabel.string = '通关！';
            this.rewardLabel.string = winRewardText;
        } else if (manager.phase === 'lost') {
            this.statusLabel.string = '小队全灭  点击重开';
            this.rewardLabel.string = '';
        } else {
            this.statusLabel.string = '';
            this.rewardLabel.string = noticeTtl > 0 ? noticeText : '';
        }
    }

    private skillSource(manager: BattleManager) {
        const soldier = manager.soldiers.find(unit => unit.alive && unit.skills.count > 0);
        return soldier ? soldier.skills : null;
    }

    private renderSkillStatus(manager: BattleManager, dt: number): void {
        this.skillGfx.clear();
        const skills = this.skillSource(manager);
        if (!skills) return;
        const rects = [UI_RECTS.skill1, UI_RECTS.skill2, UI_RECTS.skill3];
        for (let i = 0; i < Math.min(3, skills.count); i++) {
            const box = this.sourceRect(rects[i]);
            const progress = skills.progress(i);
            if (progress < 1) {
                this.skillGfx.fillColor = this.tempColor.set(0, 0, 0, 140);
                this.skillGfx.rect(box.x - box.w / 2, box.y - box.h / 2 + box.h * progress, box.w, box.h * (1 - progress));
                this.skillGfx.fill();
            }
            if (this.skillFlash[i] > 0) {
                this.skillFlash[i] = Math.max(0, this.skillFlash[i] - dt);
                this.skillGfx.fillColor = this.tempColor.set(255, 255, 255, Math.round(160 * (this.skillFlash[i] / 0.3)));
                this.skillGfx.rect(box.x - box.w / 2, box.y - box.h / 2, box.w, box.h);
                this.skillGfx.fill();
            }
        }
    }

    private drawPortraitFrame(stageW: number, stageH: number): void {
        const g = this.portraitFrameGfx;
        const stageLeft = -stageW / 2;
        const stageRight = stageW / 2;
        const stageBottom = -stageH / 2;
        const stageTop = stageH / 2;
        g.fillColor = new Color(8, 8, 8, 255);
        if (stageLeft > -this.options.halfW) {
            g.rect(-this.options.halfW, -this.options.halfH, stageLeft + this.options.halfW, this.options.halfH * 2);
            g.fill();
        }
        if (stageRight < this.options.halfW) {
            g.rect(stageRight, -this.options.halfH, this.options.halfW - stageRight, this.options.halfH * 2);
            g.fill();
        }
        if (stageBottom > -this.options.halfH) {
            g.rect(stageLeft, -this.options.halfH, stageW, stageBottom + this.options.halfH);
            g.fill();
        }
        if (stageTop < this.options.halfH) {
            g.rect(stageLeft, stageTop, stageW, this.options.halfH - stageTop);
            g.fill();
        }
        g.strokeColor = new Color(20, 18, 15, 220);
        g.lineWidth = 2;
        g.rect(stageLeft, stageBottom, stageW, stageH);
        g.stroke();
    }

    private buildStyledUi(): void {
        this.uiRoot.removeAllChildren();
        for (const key of Object.keys(this.styledUiNodes)) delete this.styledUiNodes[key];
        for (const sprite of STYLED_UI_SPRITES) this.addStyledSprite(sprite.name, sprite.key, sprite.rect);
    }

    private addStyledSprite(name: string, key: string, rect: UiRect): void {
        const frame = this.options.art.getSprite(key);
        if (!frame) return;
        const node = new Node(name);
        node.layer = this.root.layer;
        const box = this.sourceRect(rect);
        node.setPosition(box.x, box.y, 0);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        this.uiRoot.addChild(node);
        this.styledUiNodes[name] = node;
    }

    private positionStyledLabels(): void {
        this.waveLabel.node.active = false;
        this.hpLabel.node.active = false;
    }

    private sourceRect(rect: UiRect): { x: number; y: number; w: number; h: number } {
        return {
            x: (rect.x + rect.w / 2 - UI_REF_W / 2) * this.options.styleScale,
            y: (UI_REF_H / 2 - rect.y - rect.h / 2) * this.options.styleScale,
            w: rect.w * this.options.styleScale,
            h: rect.h * this.options.styleScale,
        };
    }

    private makeLabel(text: string, x: number, y: number, size: number): Label {
        const node = new Node('Label');
        node.layer = this.root.layer;
        node.addComponent(UITransform);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 4;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.root.addChild(node);
        node.setPosition(x, y, 0);
        return label;
    }

    private makeHotZone(name: string, rect: UiRect, onClick: () => void, feedbackName?: string): void {
        const node = new Node(name);
        node.layer = this.root.layer;
        const box = this.sourceRect(rect);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        this.root.addChild(node);
        node.setPosition(box.x, box.y, 0);
        this.bindPressFeedback(node, () => feedbackName ? this.styledUiNodes[feedbackName] : node, onClick);
    }

    private bindPressFeedback(hitNode: Node, feedback: () => Node | null | undefined, onClick: () => void): void {
        let pressed: Node | null = null;
        hitNode.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
            event.propagationStopped = true;
            pressed = feedback() ?? null;
            this.pressNode(pressed);
        }, this);
        hitNode.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
            event.propagationStopped = true;
            this.releaseNode(pressed);
            pressed = null;
            onClick();
        }, this);
        hitNode.on(Node.EventType.TOUCH_CANCEL, () => {
            this.releaseNode(pressed);
            pressed = null;
        }, this);
    }

    private pressNode(node: Node | null | undefined): void {
        if (!node) return;
        if (!this.pressBaseScale.has(node)) {
            const scale = node.scale;
            this.pressBaseScale.set(node, new Vec3(scale.x, scale.y, scale.z));
        }
        const base = this.pressBaseScale.get(node)!;
        node.setScale(base.x * PRESS_SCALE, base.y * PRESS_SCALE, base.z);
    }

    private releaseNode(node: Node | null | undefined): void {
        if (!node) return;
        const base = this.pressBaseScale.get(node);
        if (!base) return;
        node.setScale(base.x, base.y, base.z);
        this.pressBaseScale.delete(node);
    }
}
