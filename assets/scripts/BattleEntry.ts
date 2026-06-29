// 战斗入口（BattleEntry）—— 挂到场景节点上的唯一脚本
// 作用：建战场、驱动 BattleManager、用 Graphics 把所有单位画成色块（占位）、显示文字、处理重开。
// 第一版没有美术：士兵=蓝色方块，敌人=红色圆，子弹=黄色点。验证战斗循环用。

import { _decorator, Component, Node, Graphics, Color, UITransform, Mask, Label, view, ResolutionPolicy, Sprite, SpriteFrame, EventTouch, Vec3 } from 'cc';
import { BattleManager } from './combat/BattleManager';
import { Background } from './combat/Background';
import { BattleConfig, SoldierClass } from './config/BattleConfig';
import { mountConfigPanel } from './debug/ConfigPanel';
import { createArtRegistry } from './art/CocosArtLoader';
import { ArtRegistry } from './art/ArtRegistry';
import { FrameAnimPlayer } from './art/FrameAnim';
import { InventoryModel } from './inventory/InventoryModel';
import type { OpResult } from './inventory/InventoryModel';
import { InventoryView } from './inventory/InventoryView';
import { loadInventory, saveInventory } from './inventory/InventoryPersistence';
import { buildEffectiveStatsMap } from './combat/EffectiveStats';
import { rollDropItems } from './config/DropConfig';
import { ProgressModel } from './progression/ProgressModel';
import type { CompleteLevelResult } from './progression/ProgressModel';
import { loadProgress, saveProgress } from './progression/ProgressPersistence';
import { QUALITY_LABEL, QUALITY_COLOR, SLOT_LABEL, formatEquipStats } from './inventory/EquipDefs';
import type { EquipItem } from './inventory/EquipDefs';

const { ccclass } = _decorator;

interface RewardEntry { item: EquipItem; target: string; }
interface SettleHot { x: number; y: number; w: number; h: number; kind: 'next' | 'bag' | 'retry'; }
interface UiRect { x: number; y: number; w: number; h: number; }

const UI_REF_W = 941;
const UI_REF_H = 1672;
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

const STYLED_UI_KEYS = STYLED_UI_SPRITES.map(s => s.key);

@ccclass('BattleEntry')
export class BattleEntry extends Component {
    private _gfx: Graphics = null!;
    private _waveLabel: Label = null!;
    private _hpLabel: Label = null!;
    private _statusLabel: Label = null!;
    private _rewardLabel: Label = null!;

    private _mgr: BattleManager = null!;
    private _bg: Background = null!;
    private _battleRoot: Node = null!;   // 战斗渲染容器（bg/色块/角色/飘字/HUD）；背包面板覆盖它
    private _portraitFrameGfx: Graphics = null!;
    private _uiRoot: Node = null!;
    private _art: ArtRegistry<SpriteFrame> = null!;
    private _inv: InventoryModel = null!;
    private _invView: InventoryView = null!;
    private _progress: ProgressModel = null!;
    private _settleRoot: Node = null!;
    private _settleGfx: Graphics = null!;
    private _settleLabels: Label[] = [];
    private _settleHots: SettleHot[] = [];
    private _lastComplete: CompleteLevelResult | null = null;
    private _winRewardText = '';
    private _halfW = 0;
    private _halfH = 0;
    private _styleScale = 1;
    private _stageW = 0;
    private _stageH = 0;
    private _solSprite: Partial<Record<SoldierClass, { node: Node; anim: FrameAnimPlayer }>> = {};

    // 颜色（占位）—— 按职业区分
    private _cClass: Record<SoldierClass, Color> = {
        tank: new Color(52, 66, 72, 235),     // 坦克：墨蓝
        dps: new Color(77, 78, 67, 235),      // 输出：墨褐
        healer: new Color(72, 122, 96, 235),  // 治疗：青绿
    };
    private _cSoldierHurt = new Color(110, 110, 120); // 残血变灰
    private _cEnemy = new Color(82, 72, 66, 210);
    private _cEnemyHpBg = new Color(38, 35, 31, 230);
    private _cEnemyHp = new Color(205, 74, 54, 235);
    private _cAllyHp = new Color(90, 170, 76, 235);
    private _cBullet = new Color(75, 206, 164, 230);
    private _cHealBeam = new Color(110, 220, 170, 170);
    private _cMeleeBeam = new Color(240, 244, 232, 210);

    onLoad() {
        // 强制竖屏：设计分辨率 = 美术稿基准 941×1672（9:16），SHOW_ALL 等比 letterbox。
        // 项目原始设计分辨率是横屏 1280×720，导致 view 给出横屏可见尺寸，战斗坐标按横屏铺开 → 单位跑出竖屏区。
        // SHOW_ALL 的关键：view.getVisibleSize() 恒为设计尺寸 941×1672（与窗口比例无关），
        // 所以 UI 与战斗都在同一竖屏坐标系内布局，引擎再把整块等比缩放居中。
        // 横屏窗口预览 → 左右黑边（正常）；真机 9:16 → 充满，无黑边。
        // 注意：用 FIXED_WIDTH 会让横屏窗口里可见高度被算矮，竖屏 UI 被压成窄条、战斗单位横向溢出黑边。
        // （真机微信启动方向另由「构建面板 → 微信小游戏 → Orientation: Portrait」决定。）
        view.setDesignResolutionSize(UI_REF_W, UI_REF_H, ResolutionPolicy.SHOW_ALL);
        const vs = view.getVisibleSize();
        this._halfW = vs.width / 2;
        this._halfH = vs.height / 2;
        this._styleScale = Math.min(vs.width / UI_REF_W, vs.height / UI_REF_H);
        this._stageW = UI_REF_W * this._styleScale;
        this._stageH = UI_REF_H * this._styleScale;

        // 让本节点铺满全屏，方便接收点击（重开用）
        const ut = this.getComponent(UITransform) || this.addComponent(UITransform);
        ut.setContentSize(vs.width, vs.height);

        // 战斗渲染容器：背景/色块/角色 Sprite/飘字/HUD 都放这里。
        // 背包面板作为它的兄弟、打开时置顶 → 战斗里异步/后续新建的节点永远在面板之下。
        this._battleRoot = new Node('Battle');
        this._battleRoot.layer = this.node.layer;
        // 竖屏区裁剪：背景山丘/地面纹理为视差会画到设计区外，SHOW_ALL 的 letterbox 黑边区不会自动裁，
        // 故给战斗渲染容器加 Mask（=竖屏区 vs.width×vs.height），把所有越界渲染裁掉，黑边保持纯净。
        this._battleRoot.addComponent(UITransform).setContentSize(vs.width, vs.height);
        const stageMask = this._battleRoot.addComponent(Mask);
        stageMask.type = Mask.Type.GRAPHICS_RECT;
        this.node.addChild(this._battleRoot);
        this._battleRoot.setPosition(0, 0, 0);

        // 背景节点：占位 Graphics 和真实 Sprite 分开，避免同一节点多个 2D 渲染组件互相抢显示。
        // BgFallback 缺图时画蓝天白云；BgSprite 成功加载 bg/main 后显示真实水墨背景。
        const bgNode = new Node('BgFallback');
        bgNode.layer = this.node.layer;
        bgNode.addComponent(UITransform);
        const bgGfx = bgNode.addComponent(Graphics);
        this._battleRoot.addChild(bgNode);
        bgNode.setPosition(0, 0, 0);
        this._bg = new Background(bgGfx, this._halfW, this._halfH);

        const bgSpriteNode = new Node('BgSprite');
        bgSpriteNode.layer = this.node.layer;
        bgSpriteNode.addComponent(UITransform).setContentSize(vs.width, vs.height);
        const bgSprite = bgSpriteNode.addComponent(Sprite);
        bgSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        bgSpriteNode.active = false;
        this._battleRoot.addChild(bgSpriteNode);
        bgSpriteNode.setPosition(0, 0, 0);

        // —— 美术资源：预载 → 有图用 Sprite，无图回退色块 ——
        this._art = createArtRegistry();
        void this._art.preload(['bg/main', 'char/tank/idle', 'char/dps/idle', 'char/healer/idle', ...STYLED_UI_KEYS]).then(() => {
            const bgSf = this._art.getSprite('bg/main');
            if (bgSf) {
                bgSprite.spriteFrame = bgSf;
                bgSpriteNode.getComponent(UITransform)!.setContentSize(this._halfW * 2, this._halfH * 2);
                bgSpriteNode.active = true;
                this._bg.setUsingSprite(true);   // 停掉渐变重画
            }

            // 角色序列帧 Sprite（有帧则建节点，无帧保留色块）
            for (const cls of BattleConfig.roster) {
                const fr = this._art.getFrames(`char/${cls}/idle`);
                if (!fr) continue;
                const n = new Node('Sol_' + cls);
                n.layer = this.node.layer;
                const ut = n.addComponent(UITransform);
                const size = BattleConfig.classes[cls].size;
                ut.setContentSize(size, size);
                const sp2 = n.addComponent(Sprite);
                this._battleRoot.addChild(n);
                this._solSprite[cls] = { node: n, anim: new FrameAnimPlayer(sp2, fr.frames, fr.fps, fr.loop) };
            }

            this._buildStyledUi();
            this._positionStyledLabels();

            // 缺失键调试浮层
            const miss = this._art.missingKeys();
            if (miss.length) this._makeLabel('缺图: ' + miss.join(', '), 0, -this._halfH + 110, 18);
        });

        // 画布：一个居中的子节点，本地坐标 (0,0) 即屏幕中心
        const gfxNode = new Node('Gfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._gfx = gfxNode.addComponent(Graphics);
        this._battleRoot.addChild(gfxNode);
        gfxNode.setPosition(0, 0, 0);

        const frameNode = new Node('PortraitFrame');
        frameNode.layer = this.node.layer;
        frameNode.addComponent(UITransform).setContentSize(vs.width, vs.height);
        this._portraitFrameGfx = frameNode.addComponent(Graphics);
        this._battleRoot.addChild(frameNode);
        frameNode.setPosition(0, 0, 0);
        this._drawPortraitFrame();

        this._uiRoot = new Node('StyledUi');
        this._uiRoot.layer = this.node.layer;
        this._uiRoot.addComponent(UITransform).setContentSize(this._stageW, this._stageH);
        this._battleRoot.addChild(this._uiRoot);
        this._uiRoot.setPosition(0, 0, 0);

        // 文字
        this._waveLabel = this._makeLabel('', 0, this._halfH - 80, 40);
        this._hpLabel = this._makeLabel('', 0, this._halfH - 130, 30);
        this._statusLabel = this._makeLabel('', 0, 0, 56);
        this._statusLabel.color = new Color(255, 230, 120);
        this._rewardLabel = this._makeLabel('', 0, -70, 28);
        this._rewardLabel.color = new Color(255, 235, 170);
        this._positionStyledLabels();

        // 点击重开
        this.node.on(Node.EventType.TOUCH_END, this._onTap, this);

        // —— 装备背包：存储/UI 独立，穿脱时通过 effective-stats 刷新战斗属性 ——
        this._inv = new InventoryModel();
        this._progress = new ProgressModel(BattleConfig.levels.length, BattleConfig.startLevel);
        this._invView = new InventoryView(this.node, this._halfW, this._halfH, this._inv, (kind) => {
            void saveInventory(this._inv);   // 任何成功操作后存盘
            if ((kind === 'equip' || kind === 'unequip') && !this._settlementOpen()) {
                this._startBattle(); // 穿脱后立即刷新战斗属性；结算页打开时先不打断结算
            }
        }, () => this._configuredDebugDrop());
        void loadInventory(this._inv).then(() => loadProgress(this._progress)).then(() => {
            this._invView.refresh();
            this._startBattle(); // 存档装备/关卡进度加载完后，让首局吃到装备属性并进入当前关
        }).catch(() => {
            this._startBattle(); // 读档失败时仍可进入本局，掉落会从空背包开始存
        });
        this._createSettlementView();

        // 底部导航热区：视觉由切片提供，触摸区域保持透明。
        const noop = () => {};
        this._makeUiHotZone('Skill01Hot', UI_RECTS.skill1, noop);
        this._makeUiHotZone('Skill02Hot', UI_RECTS.skill2, noop);
        this._makeUiHotZone('Skill03Hot', UI_RECTS.skill3, noop);
        this._makeUiHotZone('NavHomeHot', UI_RECTS.navHome, noop);
        this._makeUiHotZone('NavHeroesHot', UI_RECTS.navHeroes, noop);
        this._makeUiHotZone('NavBattleHot', UI_RECTS.navBattle, noop);
        this._makeUiHotZone('NavEquipmentHot', UI_RECTS.navEquipment, () => this._invView.toggle());
        this._makeUiHotZone('NavBagHot', UI_RECTS.navBag, () => this._invView.toggle());
        this._makeUiHotZone('NavSectHot', UI_RECTS.navSect, noop);
        this._makeUiHotZone('RewardCardHot', UI_RECTS.reward, () => {
            const r = this._configuredDebugDrop();
            if (r.ok) void saveInventory(this._inv);
            this._invView.refresh();   // 面板打开时即时刷新（关着则无副作用）
        });

        // 挂载游戏内实时调参面板（仅网页预览生效；点「重开战斗」重置局内数值）
        mountConfigPanel(() => this._startBattle());
    }

    private _startBattle() {
        this._hideSettlement();
        const effective = this._inv ? buildEffectiveStatsMap(this._inv.equipped) : {};
        const levelIndex = this._progress ? this._progress.currentLevel : BattleConfig.startLevel;
        this._mgr = new BattleManager(this._halfW, this._halfH, levelIndex, effective);
        this._winRewardText = '';
        this._lastComplete = null;
        this._statusLabel.string = '';
        this._rewardLabel.string = '';
    }

    private _onTap() {
        if (this._invView && this._invView.isOpen()) return;  // 面板打开时，点击交给面板，不重开战斗
        if (this._settlementOpen()) return;                   // 结算页打开时，用结算页按钮处理
        // 仅在分出胜负后，点击重开
        if (this._mgr.phase === 'won' || this._mgr.phase === 'lost') {
            this._startBattle();
        }
    }

    private _drawPortraitFrame() {
        const g = this._portraitFrameGfx;
        if (!g) return;
        g.clear();
        const stageLeft = -this._stageW / 2;
        const stageRight = this._stageW / 2;
        const stageBottom = -this._stageH / 2;
        const stageTop = this._stageH / 2;

        g.fillColor = new Color(8, 8, 8, 255);
        if (stageLeft > -this._halfW) {
            g.rect(-this._halfW, -this._halfH, stageLeft + this._halfW, this._halfH * 2);
            g.fill();
        }
        if (stageRight < this._halfW) {
            g.rect(stageRight, -this._halfH, this._halfW - stageRight, this._halfH * 2);
            g.fill();
        }
        if (stageBottom > -this._halfH) {
            g.rect(stageLeft, -this._halfH, this._stageW, stageBottom + this._halfH);
            g.fill();
        }
        if (stageTop < this._halfH) {
            g.rect(stageLeft, stageTop, this._stageW, this._halfH - stageTop);
            g.fill();
        }

        g.strokeColor = new Color(20, 18, 15, 220);
        g.lineWidth = 2;
        g.rect(stageLeft, stageBottom, this._stageW, this._stageH);
        g.stroke();
    }

    private _buildStyledUi() {
        if (!this._uiRoot) return;
        this._uiRoot.removeAllChildren();
        for (const s of STYLED_UI_SPRITES) this._addStyledSprite(s.name, s.key, s.rect);
    }

    private _addStyledSprite(name: string, key: string, rect: UiRect) {
        const sf = this._art.getSprite(key);
        if (!sf) return;
        const n = new Node(name);
        n.layer = this.node.layer;
        const box = this._sourceRect(rect);
        n.setPosition(box.x, box.y, 0);
        n.addComponent(UITransform).setContentSize(box.w, box.h);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = sf;
        n.getComponent(UITransform)!.setContentSize(box.w, box.h);
        this._uiRoot.addChild(n);
    }

    private _sourceRect(rect: UiRect): { x: number; y: number; w: number; h: number } {
        const cx = (rect.x + rect.w / 2 - UI_REF_W / 2) * this._styleScale;
        const cy = (UI_REF_H / 2 - rect.y - rect.h / 2) * this._styleScale;
        return { x: cx, y: cy, w: rect.w * this._styleScale, h: rect.h * this._styleScale };
    }

    private _sourcePoint(x: number, y: number): { x: number; y: number } {
        return {
            x: (x - UI_REF_W / 2) * this._styleScale,
            y: (UI_REF_H / 2 - y) * this._styleScale,
        };
    }

    private _positionStyledLabels() {
        if (!this._waveLabel || !this._hpLabel) return;
        // 这版主界面的章节与波次文字已经烘进 UI 组件图；先隐藏动态文字，避免双层叠字。
        this._waveLabel.node.active = false;
        this._hpLabel.node.active = false;
    }

    private _placeLabel(label: Label, sourceX: number, sourceY: number, sourceSize: number, color: Color, sourceW: number, sourceH: number) {
        const p = this._sourcePoint(sourceX, sourceY);
        label.node.setPosition(p.x, p.y, 0);
        label.node.getComponent(UITransform)!.setContentSize(sourceW * this._styleScale, sourceH * this._styleScale);
        label.fontSize = Math.max(14, Math.round(sourceSize * this._styleScale));
        label.lineHeight = label.fontSize + 4;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
    }

    private _makeUiHotZone(name: string, rect: UiRect, onClick: () => void) {
        const n = new Node(name);
        n.layer = this.node.layer;
        const box = this._sourceRect(rect);
        n.addComponent(UITransform).setContentSize(box.w, box.h);
        this.node.addChild(n);
        n.setPosition(box.x, box.y, 0);
        n.on(Node.EventType.TOUCH_END, (e: any) => { e.propagationStopped = true; onClick(); }, this);
    }

    private _createSettlementView() {
        this._settleRoot = new Node('SettlementView');
        this._settleRoot.layer = this.node.layer;
        this._settleRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('SettlementGfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._settleGfx = gfxNode.addComponent(Graphics);
        this._settleRoot.addChild(gfxNode);
        this.node.addChild(this._settleRoot);
        this._settleRoot.active = false;
        this._settleRoot.on(Node.EventType.TOUCH_END, this._onSettlementTap, this);
    }

    private _settlementOpen(): boolean {
        return !!this._settleRoot && this._settleRoot.active;
    }

    private _hideSettlement() {
        if (this._settleRoot) this._settleRoot.active = false;
    }

    private _settleLabel(i: number): Label {
        while (i >= this._settleLabels.length) {
            const n = new Node('SettleLbl');
            n.layer = this._settleRoot.layer;
            n.addComponent(UITransform);
            const lb = n.addComponent(Label);
            this._settleRoot.addChild(n);
            this._settleLabels.push(lb);
        }
        return this._settleLabels[i];
    }

    private _showSettlement(rewards: RewardEntry[], failed: number, complete: CompleteLevelResult) {
        this._lastComplete = complete;
        this._settleRoot.active = true;
        this._settleRoot.setSiblingIndex(this.node.children.length - 1);
        this._renderSettlement(rewards, failed, complete);
    }

    private _renderSettlement(rewards: RewardEntry[], failed: number, complete: CompleteLevelResult) {
        const g = this._settleGfx;
        g.clear();
        this._settleHots = [];
        let li = 0;
        const lbl = (x: number, y: number, text: string, size = 20, color = new Color(235, 238, 245)) => {
            const lb = this._settleLabel(li++);
            lb.node.active = true;
            lb.node.setPosition(x, y, 0);
            lb.string = text;
            lb.fontSize = size;
            lb.lineHeight = size + 4;
            lb.color = color;
        };

        g.fillColor = new Color(8, 10, 14, 190);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        const w = Math.min(680, this._halfW * 2 - 80);
        const h = Math.min(500, this._halfH * 2 - 70);
        const x = -w / 2;
        const y = -h / 2;
        g.fillColor = new Color(26, 30, 40, 245);
        g.roundRect(x, y, w, h, 8);
        g.fill();
        g.strokeColor = new Color(120, 132, 160, 230);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();

        lbl(0, y + h - 40, '通关结算', 32, new Color(255, 226, 126));
        lbl(0, y + h - 76, `${this._mgr.levelName}   第 ${complete.completedLevel + 1}/${BattleConfig.levels.length} 关`, 20, new Color(205, 214, 232));

        const rewardY = y + h - 124;
        lbl(x + 70, rewardY, '获得装备', 21, new Color(255, 235, 170));
        if (rewards.length === 0) {
            lbl(0, rewardY - 44, failed > 0 ? '背包/仓库已满，奖励未领取' : '本次没有掉落', 19, new Color(255, 140, 120));
        } else {
            for (let i = 0; i < Math.min(rewards.length, 4); i++) {
                const r = rewards[i];
                const item = r.item;
                const q = QUALITY_LABEL[item.quality];
                const stats = formatEquipStats(item.stats, 3);
                const lineY = rewardY - 40 - i * 44;
                const qc = QUALITY_COLOR[item.quality];
                lbl(x + 110, lineY, `${q} · ${item.name}`, 19, new Color(qc[0], qc[1], qc[2]));
                lbl(x + 320, lineY, `${SLOT_LABEL[item.slot]}  ${stats || '无属性'}  进${r.target}`, 16, new Color(214, 220, 235));
            }
            if (failed > 0) lbl(0, rewardY - 222, `${failed} 件未领取：背包/仓库已满`, 16, new Color(255, 140, 120));
        }

        const progressText = complete.hasNext
            ? (complete.unlockedNext ? `已解锁：${BattleConfig.levels[complete.nextLevel].name}` : `下一关：${BattleConfig.levels[complete.nextLevel].name}`)
            : '当前内容已全部通关';
        lbl(0, y + 116, progressText, 19, new Color(190, 225, 185));

        const by = y + 34;
        if (complete.hasNext) this._settleButton(g, lbl, x + 60, by, 150, 48, '下一关', 'next', true);
        else this._settleButton(g, lbl, x + 60, by, 150, 48, '已通关', 'next', false);
        this._settleButton(g, lbl, x + w / 2 - 75, by, 150, 48, '打开背包', 'bag', true);
        this._settleButton(g, lbl, x + w - 210, by, 150, 48, '重打本关', 'retry', true);

        for (let i = li; i < this._settleLabels.length; i++) this._settleLabels[i].node.active = false;
    }

    private _settleButton(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        kind: SettleHot['kind'],
        enabled: boolean,
    ) {
        g.fillColor = enabled ? new Color(67, 76, 96, 245) : new Color(48, 52, 62, 200);
        g.roundRect(x, y, w, h, 8);
        g.fill();
        g.strokeColor = enabled ? new Color(255, 226, 126, 220) : new Color(90, 94, 104, 180);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();
        lbl(x + w / 2, y + h / 2, text, 18, enabled ? new Color(245, 248, 255) : new Color(145, 150, 160));
        if (enabled) this._settleHots.push({ x, y, w, h, kind });
    }

    private _onSettlementTap(e: EventTouch) {
        if (!this._settlementOpen()) return;
        e.propagationStopped = true;
        const ui = e.getUILocation();
        const p = this._settleRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const hit = this._settleHots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
        if (!hit) return;

        if (hit.kind === 'bag') {
            if (!this._invView.isOpen()) this._invView.toggle();
            return;
        }

        const complete = this._lastComplete;
        if (!complete) return;
        if (hit.kind === 'next') {
            if (this._progress.selectNextAfter(complete.completedLevel)) {
                void saveProgress(this._progress);
                this._startBattle();
            }
            return;
        }

        if (hit.kind === 'retry') {
            this._progress.selectLevel(complete.completedLevel);
            void saveProgress(this._progress);
            this._startBattle();
        }
    }

    update(dt: number) {
        if (!this._mgr) return;
        this._bg.update(dt);   // 背景（云飘动）
        // dt 兜底，防止切后台回来一帧巨大导致瞬移
        const phaseBefore = this._mgr.phase;
        this._mgr.tick(Math.min(dt, 0.05));
        if (phaseBefore !== 'won' && this._mgr.phase === 'won') this._awardVictoryDrop();
        this._render();
        this._renderFloats();
        for (const k in this._solSprite) this._solSprite[k as SoldierClass]!.anim.update(Math.min(dt, 0.05));
        this._updateLabels();
        this._invView.update(dt);
    }

    // —— 战斗飘字（用 Label 池，按需复用）——
    private _floats: Label[] = [];
    private _getFloat(i: number): Label {
        while (i >= this._floats.length) {
            const node = new Node('Float');
            node.layer = this.node.layer;
            node.addComponent(UITransform);
            const lb = node.addComponent(Label);
            this._battleRoot.addChild(node);
            this._floats.push(lb);
        }
        return this._floats[i];
    }

    private _renderFloats() {
        const list = this._mgr.floatTexts;
        for (let i = 0; i < list.length; i++) {
            const ft = list[i];
            const lb = this._getFloat(i);
            lb.node.active = true;
            lb.node.setPosition(ft.x, ft.y, 0);
            lb.string = ft.text;
            const a = Math.max(0, Math.min(1, ft.ttl / ft.maxTtl)) * 255;
            switch (ft.kind) {
                case 'crit':  lb.fontSize = 42; lb.color = new Color(255, 180, 40, a); break;
                case 'block': lb.fontSize = 28; lb.color = new Color(120, 200, 255, a); break;
                case 'dodge': lb.fontSize = 28; lb.color = new Color(210, 210, 210, a); break;
                default:      lb.fontSize = 30; lb.color = new Color(255, 255, 255, a); break;
            }
            lb.lineHeight = lb.fontSize + 4;
        }
        // 多余的 Label 隐藏
        for (let i = list.length; i < this._floats.length; i++) {
            this._floats[i].node.active = false;
        }
    }

    // —— 把所有单位画成色块 ——
    private _render() {
        const g = this._gfx;
        g.clear();

        // 子弹
        const br = BattleConfig.bullet.radius;
        g.fillColor = this._cBullet;
        for (const b of this._mgr.bullets) {
            g.circle(b.x, b.y, br);
        }
        g.fill();

        // 敌人（按类型上色的圆 + 头顶血条；体型/颜色随怪类型）
        for (const e of this._mgr.enemies) {
            const er = e.radius;
            g.fillColor = new Color(
                Math.max(48, Math.round(e.color[0] * 0.42)),
                Math.max(42, Math.round(e.color[1] * 0.42)),
                Math.max(38, Math.round(e.color[2] * 0.42)),
                220,
            );
            g.circle(e.x, e.y, er);
            g.fill();

            // 血条
            const w = er * 2;
            const ratio = Math.max(0, e.hp / e.maxHp);
            const by = e.y + er + 8;
            g.fillColor = this._cEnemyHpBg;
            g.rect(e.x - er, by, w, 6);
            g.fill();
            g.fillColor = this._cEnemyHp;
            g.rect(e.x - er, by, w * ratio, 6);
            g.fill();
        }

        // 近战劈砍连线（白色粗线，近战单位→正在劈的怪）
        g.strokeColor = this._cMeleeBeam;
        g.lineWidth = 7;
        for (const mb of this._mgr.meleeBeams) {
            g.moveTo(mb.fromX, mb.fromY);
            g.lineTo(mb.toX, mb.toY);
        }
        g.stroke();

        // 治疗光束（绿色细线，治疗→被奶的队友）
        g.strokeColor = this._cHealBeam;
        g.lineWidth = 4;
        for (const hb of this._mgr.healBeams) {
            g.moveTo(hb.fromX, hb.fromY);
            g.lineTo(hb.toX, hb.toY);
        }
        g.stroke();

        // 士兵（按职业上色的方块，受伤变灰；坦克更大）
        for (const sol of this._mgr.soldiers) {
            if (!sol.alive) continue;
            const size = BattleConfig.classes[sol.cls].size;
            const ratio = sol.hp / sol.maxHp;

            const art = this._solSprite[sol.cls];
            if (art) {
                art.node.active = true;
                art.node.setPosition(sol.x, sol.y, 0);
            }
            if (!art) {
                g.fillColor = new Color(28, 26, 22, 55);
                g.circle(sol.x, sol.y - size * 0.48, size * 0.45);
                g.fill();
                g.fillColor = ratio > 0.35 ? this._cClass[sol.cls] : this._cSoldierHurt;
                g.roundRect(sol.x - size / 2, sol.y - size / 2, size, size, 8);
                g.fill();
            }

            // 士兵头顶血条
            const w = size;
            const by = sol.y + size / 2 + 6;
            g.fillColor = this._cEnemyHpBg;
            g.rect(sol.x - w / 2, by, w, 5);
            g.fill();
            g.fillColor = this._cAllyHp;
            g.rect(sol.x - w / 2, by, w * ratio, 5);
            g.fill();
        }
    }

    private _updateLabels() {
        const m = this._mgr;
        if (this._waveLabel.node.active) this._waveLabel.string = m.levelName;
        if (this._hpLabel.node.active) this._hpLabel.string = `${m.waveIndex + 1}/${m.totalWaves}波`;

        if (m.phase === 'won') {
            this._statusLabel.string = '通关！';
            this._rewardLabel.string = this._winRewardText;
        } else if (m.phase === 'lost') {
            this._statusLabel.string = '小队全灭  点击重开';
            this._rewardLabel.string = '';
        } else {
            this._statusLabel.string = '';
            this._rewardLabel.string = '';
        }
    }

    private _awardVictoryDrop() {
        const result = this._grantDropItems(this._mgr.level.dropGroup);
        const complete = this._progress.completeLevel(this._mgr.levelIndex);
        void saveProgress(this._progress);

        if (result.received.length > 0) {
            this._winRewardText = this._formatDropSummary(result.received, result.failed);
            void saveInventory(this._inv);
            this._invView.refresh();
        } else {
            this._winRewardText = '奖励未领取：背包/仓库已满';
        }
        this._showSettlement(result.received, result.failed, complete);
    }

    private _currentDropGroup(): string {
        if (this._mgr) return this._mgr.level.dropGroup;
        const levelIndex = this._progress ? this._progress.currentLevel : BattleConfig.startLevel;
        return BattleConfig.levels[levelIndex]?.dropGroup ?? BattleConfig.levels[BattleConfig.startLevel].dropGroup;
    }

    private _configuredDebugDrop(): OpResult {
        const result = this._grantDropItems(this._currentDropGroup());
        if (result.received.length > 0) return { ok: true, item: result.received[0].item };
        return { ok: false, reason: '背包/仓库已满' };
    }

    private _grantDropItems(dropGroup: string): { received: RewardEntry[]; failed: number } {
        const drops = rollDropItems(dropGroup);
        const received: RewardEntry[] = [];
        let failed = 0;

        for (const item of drops) {
            let r = this._inv.addItemToBackpack(item);
            let target = '背包';
            if (!r.ok && r.reason === '背包已满') {
                r = this._inv.addItemToWarehouse(item);
                target = '仓库';
            }
            if (r.ok && r.item) {
                received.push({ item: r.item, target });
            } else {
                failed++;
            }
        }
        return { received, failed };
    }

    private _formatDropSummary(received: RewardEntry[], failed: number): string {
        if (received.length === 1 && failed === 0) {
            const r = received[0];
            return `获得 ${this._formatEquipReward(r.item)}（进${r.target}）`;
        }
        const names = received.map(r => `${this._formatEquipReward(r.item)}(${r.target})`).join('、');
        return `获得 ${received.length} 件装备：${names}${failed > 0 ? `，${failed} 件未领取` : ''}`;
    }

    private _formatEquipReward(item: EquipItem): string {
        return `${QUALITY_LABEL[item.quality]}·${item.name}`;
    }

    private _makeLabel(text: string, x: number, y: number, size: number): Label {
        const node = new Node('Label');
        node.layer = this.node.layer;
        node.addComponent(UITransform);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 6;
        this._battleRoot.addChild(node);
        node.setPosition(x, y, 0);
        return label;
    }

    private _makeButton(text: string, x: number, y: number, onClick: () => void): Label {
        const node = new Node('Btn');
        node.layer = this.node.layer;
        const ut = node.addComponent(UITransform);
        ut.setContentSize(100, 44);
        const label = node.addComponent(Label);
        label.string = text; label.fontSize = 22; label.lineHeight = 26;
        this.node.addChild(node);
        node.setPosition(x, y, 0);
        node.on(Node.EventType.TOUCH_END, (e: any) => { e.propagationStopped = true; onClick(); }, this);
        return label;
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_END, this._onTap, this);
    }
}
