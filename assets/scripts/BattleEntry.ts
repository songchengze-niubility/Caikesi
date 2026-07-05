// 战斗入口（BattleEntry）—— 挂到场景节点上的唯一脚本
// 作用：建战场、驱动 BattleManager、用 Graphics 把所有单位画成色块（占位）、显示文字、处理重开。
// 第一版没有美术：士兵=蓝色方块，敌人=红色圆，子弹=黄色点。验证战斗循环用。

import { _decorator, Component, Node, Graphics, Color, UITransform, Mask, Label, view, ResolutionPolicy, Sprite, SpriteFrame, EventTouch, Vec3 } from 'cc';
import { BattleManager } from './combat/BattleManager';
import type { UnitAction, SkillCastEvent } from './combat/BattleManager';
import { Background } from './combat/Background';
import { BattleConfig, SoldierClass } from './config/BattleConfig';
import { mountConfigPanel } from './debug/ConfigPanel';
import { mountActionPreviewPanel, type ActionPreviewRequest } from './debug/ActionPreviewPanel';
import { createArtRegistry } from './art/CocosArtLoader';
import { ArtRegistry } from './art/ArtRegistry';
import { FrameAnimPlayer } from './art/FrameAnim';
import { InventoryModel } from './inventory/InventoryModel';
import type { OpResult } from './inventory/InventoryModel';
import { InventoryView } from './inventory/InventoryView';
import type { InventoryChangeKind, InventoryChangePayload } from './inventory/InventoryView';
import { loadInventory, saveInventory } from './inventory/InventoryPersistence';
import { buildEffectiveStatsMap } from './combat/EffectiveStats';
import { generateStageReward } from './loot/LootService';
import { claimOfflineReward } from './offline/OfflineClaimService';
import { ChestInventoryModel } from './chest/ChestModel';
import type { ChestItem } from './chest/ChestModel';
import { loadChests, saveChests } from './chest/ChestPersistence';
import { rollChestDrop } from './chest/ChestDropService';
import { chestTypeLabel, openChest } from './chest/ChestService';
import { ProgressModel } from './progression/ProgressModel';
import type { CompleteLevelResult } from './progression/ProgressModel';
import { loadProgress, saveProgress } from './progression/ProgressPersistence';
import { loadPlayerData, savePlayerData } from './core/data/PlayerDataStore';
import { SquadModel } from './squad/SquadModel';
import { loadSquad, saveSquad } from './squad/SquadPersistence';
import { QUALITY_LABEL, QUALITY_COLOR, SLOT_LABEL, SLOTS, formatEquipStats, CHARACTERS, CHARACTER_LABEL } from './inventory/EquipDefs';
import type { EquipItem, EquipSlot } from './inventory/EquipDefs';
import { MATERIAL_LABEL } from './services/RewardTypes';
import type { MaterialId, MaterialItem, MaterialSave } from './services/RewardTypes';
import { craftEquipment } from './craft/CraftService';
import { canAffordCraftTier, craftTierIds, getCraftTier } from './config/CraftConfig';
import type { CraftTierConfig } from './config/CraftConfig';

const { ccclass } = _decorator;

interface RewardEntry { item: EquipItem; target: string; }
interface SettleHot { x: number; y: number; w: number; h: number; kind: 'next' | 'bag' | 'retry'; }
interface ChestHot { x: number; y: number; w: number; h: number; kind: 'open' | 'close' | 'select'; chestId?: string; }
interface CraftHot { x: number; y: number; w: number; h: number; kind: 'tier' | 'slot' | 'craft' | 'close'; tierId?: string; slot?: EquipSlot; }
interface UiRect { x: number; y: number; w: number; h: number; }
interface ChestOpenDisplay { chestLabel: string; received: RewardEntry[]; materials: MaterialItem[]; }

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

const BOOT_UI_RECTS = {
    background: { x: 0, y: 0, w: 941, h: 1672 },
    loadingRing: { x: 275, y: 943, w: 409, h: 332 },
    loadingProgress: { x: 40, y: 1331, w: 900, h: 90 },
    fade: { x: 0, y: 1168, w: 941, h: 504 },
    notice: { x: 15, y: 2, w: 89, h: 245 },
    title: { x: 123, y: 307, w: 711, h: 283 },
    startButton: { x: 229, y: 1266, w: 466, h: 135 },
    ageRating: { x: 22, y: 1452, w: 144, h: 181 },
};

const BOOT_LOADING_UI_SPRITES: { key: string; rect: UiRect; name: string }[] = [
    { key: 'ui/boot/background', rect: BOOT_UI_RECTS.background, name: 'BootLoadingBackground' },
    { key: 'ui/boot/loading_ring', rect: BOOT_UI_RECTS.loadingRing, name: 'BootLoadingRing' },
    { key: 'ui/boot/loading_progress', rect: BOOT_UI_RECTS.loadingProgress, name: 'BootLoadingProgress' },
];

const BOOT_UI_SPRITES: { key: string; rect: UiRect; name: string }[] = [
    { key: 'ui/boot/background', rect: BOOT_UI_RECTS.background, name: 'BootBackground' },
    { key: 'ui/boot/bottom_fade', rect: BOOT_UI_RECTS.fade, name: 'BootBottomFade' },
    { key: 'ui/boot/notice', rect: BOOT_UI_RECTS.notice, name: 'BootNotice' },
    { key: 'ui/boot/title', rect: BOOT_UI_RECTS.title, name: 'BootTitleArt' },
    { key: 'ui/boot/start_button', rect: BOOT_UI_RECTS.startButton, name: 'BootStartButtonArt' },
    { key: 'ui/boot/age_rating', rect: BOOT_UI_RECTS.ageRating, name: 'BootAgeRating' },
];

const BOOT_LOADING_UI_KEYS = [...new Set(BOOT_LOADING_UI_SPRITES.map(s => s.key))];
const BOOT_UI_KEYS = BOOT_UI_SPRITES.map(s => s.key);
const PRESS_SCALE = 0.94;
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

interface FrameClip {
    frames: SpriteFrame[];
    fps: number;
    loop: boolean;
    pingpong: boolean;
    blend: number;
    bodyH?: number;    // 身体基准（0-1 归一化，见 ArtManifest 注释）；缺省走整帧缩放旧行为
    anchorX?: number;
    footY?: number;
}

interface SoldierVisual {
    node: Node;
    anim: FrameAnimPlayer;
    clips: Partial<Record<UnitAction, FrameClip>>;
    currentAction: UnitAction | null;
    visualHeight: number;
    offsetX: number;   // 当前动作的锚点修正（节点中心相对单位坐标），切动作时更新
    offsetY: number;
}

type BootPhase = 'loading' | 'ready' | 'playing';

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
    private _chests: ChestInventoryModel = null!;
    private _progress: ProgressModel = null!;
    private _squad: SquadModel = null!;
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
    private _solSprite: Partial<Record<SoldierClass, SoldierVisual>> = {};
    private _bootRoot: Node = null!;
    private _bootGfx: Graphics = null!;
    private _bootSpritesRoot: Node = null!;
    private _bootSpriteNodes: Record<string, Node> = {};
    private _bootTitle: Label = null!;
    private _bootHint: Label = null!;
    private _bootButton: Label = null!;
    private _bootPhase: BootPhase = 'loading';
    private _bootButtonRect: { x: number; y: number; w: number; h: number } | null = null;
    private _gameStarted = false;
    private _styledUiNodes: Record<string, Node> = {};
    private _pressBaseScale = new Map<Node, Vec3>();
    private _bootPressed = false;
    private _pressedSettleKind: SettleHot['kind'] | null = null;
    private _settleRewards: RewardEntry[] = [];
    private _settleFailed = 0;
    private _chestRoot: Node = null!;
    private _chestGfx: Graphics = null!;
    private _chestLabels: Label[] = [];
    private _chestHots: ChestHot[] = [];
    private _pressedChestKind: ChestHot['kind'] | null = null;
    private _pressedChestId = '';
    private _selectedChestId = '';
    private _chestMessage = '';
    private _lastChestOpen: ChestOpenDisplay | null = null;
    private _craftRoot: Node = null!;
    private _craftGfx: Graphics = null!;
    private _craftLabels: Label[] = [];
    private _craftHots: CraftHot[] = [];
    private _pressedCraftKind: CraftHot['kind'] | null = null;
    private _pressedCraftTierId = '';
    private _pressedCraftSlot: EquipSlot | null = null;
    private _craftSelectedTier = '';
    private _craftSelectedSlot: EquipSlot = 'weapon';
    private _craftMessage = '';
    private _lastCraftResult: RewardEntry | null = null;
    private _materials: MaterialSave = {};
    private _offlineNoticeText = '';
    private _offlineNoticeTtl = 0;
    private _battleSeed = '';
    private _battleChestDropCount = 0;
    private _actionPreviewRoot: Node | null = null;
    private _actionPreviewGfx: Graphics | null = null;
    private _actionPreviewNode: Node | null = null;
    private _actionPreviewBlendNode: Node | null = null;
    private _actionPreviewAnim: FrameAnimPlayer | null = null;
    private _actionPreviewLabel: Label | null = null;
    private _actionPreviewDestroy: (() => void) | null = null;

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
    private _cEnemyAtkRing = new Color(245, 228, 196, 160);
    private _cSolShadow = new Color(28, 26, 22, 55);
    private _tmpColor = new Color();   // 每帧动态色复用，避免热路径 new Color
    private _skillGfx: Graphics | null = null;      // 技能按钮状态层（进度遮罩 + 释放闪光）
    private _skillFlash: number[] = [0, 0, 0];       // 每个按钮的释放闪光剩余秒数

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
        this._art = createArtRegistry();
        this._createBootView();

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
        this._battleRoot.active = false;

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

        // 技能按钮状态层：盖在 UI 切片上方，画进度遮罩/释放闪光
        const skillGfxNode = new Node('SkillStatusGfx');
        skillGfxNode.layer = this.node.layer;
        skillGfxNode.addComponent(UITransform);
        this._skillGfx = skillGfxNode.addComponent(Graphics);
        this._battleRoot.addChild(skillGfxNode);
        skillGfxNode.setPosition(0, 0, 0);

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
        this._chests = new ChestInventoryModel();
        this._progress = new ProgressModel(BattleConfig.levels.length, BattleConfig.startLevel);
        this._invView = new InventoryView(this.node, this._halfW, this._halfH, this._inv, (kind, payload) => {
            void this._handleInventoryChanged(kind, payload);
        }, () => this._configuredDebugDrop());
        const dataReady = loadInventory(this._inv).then(() => loadProgress(this._progress)).then(() => this._claimOfflineRewards()).then(() => loadChests(this._chests)).then(() => this._refreshMaterialsCache()).then(() => loadSquad()).then((squad) => { this._squad = squad; }).then(() => {
            this._invView.refresh();
        }).catch(() => {
            // 读档失败时仍允许进游戏，掉落会从空背包开始存。
        });
        this._createSettlementView();
        this._createChestView();
        this._createCraftView();
        this._createSquadView();

        // 底部导航热区：视觉由切片提供，触摸区域保持透明。
        const noop = () => {};
        this._makeUiHotZone('Skill01Hot', UI_RECTS.skill1, noop, 'Skill01');
        this._makeUiHotZone('Skill02Hot', UI_RECTS.skill2, noop, 'Skill02');
        this._makeUiHotZone('Skill03Hot', UI_RECTS.skill3, noop, 'Skill03');
        this._makeUiHotZone('NavHomeHot', UI_RECTS.navHome, noop, 'BottomNav');
        this._makeUiHotZone('NavHeroesHot', UI_RECTS.navHeroes, () => this._toggleSquadPanel(), 'BottomNav');
        this._makeUiHotZone('NavBattleHot', UI_RECTS.navBattle, noop, 'BottomNav');
        this._makeUiHotZone('NavEquipmentHot', UI_RECTS.navEquipment, () => this._invView.toggle(), 'BottomNav');
        this._makeUiHotZone('NavBagHot', UI_RECTS.navBag, () => this._invView.toggle(), 'BottomNav');
        this._makeUiHotZone('NavSectHot', UI_RECTS.navSect, () => this._toggleCraftPanel(), 'BottomNav');
        this._makeUiHotZone('RewardCardHot', UI_RECTS.reward, () => this._toggleChestPanel(), 'StageReward');

        // 挂载游戏内实时调参面板（仅网页预览生效；点「重开战斗」重置局内数值）
        mountConfigPanel(() => this._startBattle());
        this._actionPreviewDestroy = mountActionPreviewPanel(
            (req) => { void this._showActionPreview(req); },
            () => this._hideActionPreview(),
        );

        const loadingArtReady = this._loadBootLoadingArt();
        const artReady = loadingArtReady.then(() => this._loadBattleArt(bgSprite, bgSpriteNode));
        void Promise.all([artReady, dataReady]).then(() => {
            this._showStartScreen();
        }).catch(() => {
            this._showStartScreen();
        });
        this._bringBootToTop();
    }

    private _startBattle() {
        if (!this._gameStarted) return;
        this._hideSettlement();
        this._hideChestPanel();
        this._hideCraftPanel();
        const effective = this._inv ? buildEffectiveStatsMap(this._inv.equipped) : {};
        const levelIndex = this._progress ? this._progress.currentLevel : BattleConfig.startLevel;
        const roster = this._squad ? (this._squad.deployedList() as SoldierClass[]) : BattleConfig.roster;
        this._battleSeed = `${Date.now()}|${Math.random()}|${levelIndex}`;
        this._battleChestDropCount = 0;
        this._shownWaveKey = -1;   // 强制下一帧刷新波次文本
        this._syncSoldierVisualsToRoster(roster);
        this._mgr = new BattleManager(this._halfW, this._halfH, levelIndex, effective, roster);
        this._winRewardText = '';
        this._lastComplete = null;
        this._statusLabel.string = '';
        this._rewardLabel.string = '';
    }

    private async _handleInventoryChanged(kind: InventoryChangeKind, payload?: InventoryChangePayload): Promise<void> {
        const data = await loadPlayerData();
        if (payload?.gold && payload.gold > 0) data.gold = (data.gold ?? 0) + payload.gold;
        data.inventory = this._inv.serialize();
        await savePlayerData();

        if (this._gameStarted && (kind === 'equip' || kind === 'unequip') && !this._settlementOpen()) {
            this._startBattle(); // 穿脱后立即刷新战斗属性；结算页打开时先不打断结算
        }
    }

    private async _loadBattleArt(bgSprite: Sprite, bgSpriteNode: Node): Promise<void> {
        await this._art.preload(['bg/main', ...SOLDIER_ACTION_KEYS, ...STYLED_UI_KEYS, ...BOOT_LOADING_UI_KEYS, ...BOOT_UI_KEYS]);

        const bgSf = this._art.getSprite('bg/main');
        if (bgSf) {
            bgSprite.spriteFrame = bgSf;
            bgSpriteNode.getComponent(UITransform)!.setContentSize(this._halfW * 2, this._halfH * 2);
            bgSpriteNode.active = true;
            this._bg.setUsingSprite(true);   // 停掉渐变重画
        }

        // 角色序列帧 Sprite（有帧则建节点，无帧保留色块）：按当前出战列表建
        const initialRoster = this._squad ? (this._squad.deployedList() as SoldierClass[]) : BattleConfig.roster;
        this._syncSoldierVisualsToRoster(initialRoster);

        this._buildStyledUi();
        this._positionStyledLabels();

        // 缺失键调试浮层
        const miss = this._art.missingKeys();
        if (miss.length) this._makeLabel('缺图: ' + miss.join(', '), 0, -this._halfH + 110, 18);
    }

    private async _loadBootLoadingArt(): Promise<void> {
        await this._art.preload(BOOT_LOADING_UI_KEYS);
        if (this._bootPhase === 'loading') {
            this._drawBootLoading();
            this._bringBootToTop();
        }
    }

    private _soldierVisualHeight(cls: SoldierClass): number {
        return cls === 'dps' ? 180 : BattleConfig.classes[cls].size;
    }

    // 一个动作的显示框与锚点修正。
    // 有 bodyH（身体基准）：把「身体高」缩到职业目标高，帧框按同比例放大，并算出脚点对齐偏移——
    //   各动作按自身透明边界裁切后帧高比例不同，若按帧高归一会切动作时身体忽大忽小、左右横移。
    // 无 bodyH（老资源）：整帧缩到目标高、中心对齐（原行为）。
    private _clipVisualBox(cls: SoldierClass, clip: FrameClip): { w: number; h: number; offsetX: number; offsetY: number } {
        return this._clipBoxForHeight(this._soldierVisualHeight(cls), clip);
    }

    private _clipBoxForHeight(targetH: number, clip: FrameClip): { w: number; h: number; offsetX: number; offsetY: number } {
        const rect = clip.frames[0].rect;
        const fw = Math.max(1, rect.width);
        const fh = Math.max(1, rect.height);
        if (!clip.bodyH || clip.bodyH <= 0) {
            return { w: targetH * (fw / fh), h: targetH, offsetX: 0, offsetY: 0 };
        }
        const scale = targetH / (clip.bodyH * fh);
        const w = fw * scale;
        const h = fh * scale;
        // 横向：脚接触列对齐到单位 x（节点中心锚点，帧内 anchorX 是 0-1 从左起）
        const offsetX = clip.anchorX != null ? (0.5 - clip.anchorX) * w : 0;
        // 纵向：身体底（脚）对齐到 sol.y - targetH/2（与旧行为帧底位置一致；footY 是 0-1 从顶起）
        const offsetY = clip.footY != null ? (clip.footY - 0.5) * h - targetH / 2 : 0;
        return { w, h, offsetX, offsetY };
    }

    private _loadSoldierClips(cls: SoldierClass): Partial<Record<UnitAction, FrameClip>> {
        const clips: Partial<Record<UnitAction, FrameClip>> = {};
        for (const action of SOLDIER_ACTION_ORDER) {
            const fr = this._art.getFrames(SOLDIER_ACTION_ART[cls][action]);
            if (fr) clips[action] = fr;
        }
        return clips;
    }

    private _firstSoldierClip(clips: Partial<Record<UnitAction, FrameClip>>): FrameClip | null {
        for (const action of SOLDIER_ACTION_ORDER) {
            const clip = clips[action];
            if (clip) return clip;
        }
        return null;
    }

    // 按出战列表同步士兵视觉：缺的建、未出战的已建视觉隐藏。
    // 渲染循环只遍历 mgr.soldiers（出战单位），未出战角色若已建节点会滞留原点，故显式隐藏。
    private _syncSoldierVisualsToRoster(deployed: SoldierClass[]) {
        for (const cls of deployed) {
            if (!this._solSprite[cls]) this._buildSoldierVisual(cls);
        }
        for (const cls of CHARACTERS as SoldierClass[]) {
            const v = this._solSprite[cls];
            if (v && deployed.indexOf(cls) < 0) v.node.active = false;
        }
    }

    private _buildSoldierVisual(cls: SoldierClass) {
        const clips = this._loadSoldierClips(cls);
        const clip = this._firstSoldierClip(clips);
        if (!clip) return;

        const n = new Node('Sol_' + cls);
        n.layer = this.node.layer;
        const box = this._clipVisualBox(cls, clip);
        n.addComponent(UITransform).setContentSize(box.w, box.h);

        const sprite = n.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;

        const blendNode = new Node('SolBlend_' + cls);
        blendNode.layer = this.node.layer;
        blendNode.addComponent(UITransform).setContentSize(box.w, box.h);
        const blendSprite = blendNode.addComponent(Sprite);
        blendSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        n.addChild(blendNode);

        this._battleRoot.addChild(n);
        this._placeBelowStyledUi(n);
        this._solSprite[cls] = {
            node: n,
            anim: new FrameAnimPlayer(sprite, clip.frames, clip.fps, clip.loop, clip.pingpong, blendSprite, clip.blend),
            clips,
            currentAction: null,
            visualHeight: this._soldierVisualHeight(cls),
            offsetX: box.offsetX,
            offsetY: box.offsetY,
        };
        this._setSoldierVisualAction(cls, 'idle', true);
    }

    private _setSoldierVisualAction(cls: SoldierClass, action: UnitAction, force = false) {
        const visual = this._solSprite[cls];
        if (!visual || (!force && visual.currentAction === action)) return;
        const clip = visual.clips[action] ?? visual.clips.idle ?? this._firstSoldierClip(visual.clips);
        if (!clip) return;

        const box = this._clipVisualBox(cls, clip);
        visual.node.getComponent(UITransform)!.setContentSize(box.w, box.h);
        const blend = visual.node.getChildByName('SolBlend_' + cls);
        if (blend) blend.getComponent(UITransform)!.setContentSize(box.w, box.h);
        visual.visualHeight = this._soldierVisualHeight(cls);
        visual.offsetX = box.offsetX;
        visual.offsetY = box.offsetY;
        visual.currentAction = action;
        visual.anim.setClip(clip.frames, clip.fps, clip.loop, clip.pingpong, clip.blend);
    }

    private _placeBelowStyledUi(node: Node) {
        if (!this._uiRoot || !this._uiRoot.parent) return;
        node.setSiblingIndex(this._uiRoot.getSiblingIndex());
    }

    private _createBootView() {
        this._bootRoot = new Node('BootFlow');
        this._bootRoot.layer = this.node.layer;
        this._bootRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('BootGfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._bootGfx = gfxNode.addComponent(Graphics);
        this._bootRoot.addChild(gfxNode);

        this._bootSpritesRoot = new Node('BootSprites');
        this._bootSpritesRoot.layer = this.node.layer;
        this._bootSpritesRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        this._bootRoot.addChild(this._bootSpritesRoot);

        this._bootTitle = this._makeBootLabel('BootTitle');
        this._bootHint = this._makeBootLabel('BootHint');
        this._bootButton = this._makeBootLabel('BootButton');
        this._bootRoot.on(Node.EventType.TOUCH_START, this._onBootTouchStart, this);
        this._bootRoot.on(Node.EventType.TOUCH_MOVE, this._onBootTouchMove, this);
        this._bootRoot.on(Node.EventType.TOUCH_END, this._onBootTap, this);
        this._bootRoot.on(Node.EventType.TOUCH_CANCEL, this._onBootTouchCancel, this);
        this.node.addChild(this._bootRoot);
        this._bootRoot.setPosition(0, 0, 0);
        this._drawBootLoading();
    }

    private _makeBootLabel(name: string): Label {
        const n = new Node(name);
        n.layer = this.node.layer;
        n.addComponent(UITransform);
        const lb = n.addComponent(Label);
        lb.horizontalAlign = Label.HorizontalAlign.CENTER;
        lb.verticalAlign = Label.VerticalAlign.CENTER;
        this._bootRoot.addChild(n);
        return lb;
    }

    private _placeBootLabel(label: Label, text: string, x: number, y: number, w: number, h: number, size: number, color: Color) {
        const ut = label.node.getComponent(UITransform)!;
        ut.setContentSize(w, h);
        label.node.setPosition(x, y, 0);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 8;
        label.color = color;
    }

    private _drawBootPanel() {
        if (this._bootSpritesRoot) {
            this._bootSpritesRoot.removeAllChildren();
            this._bootSpriteNodes = {};
        }
        const g = this._bootGfx;
        g.clear();

        g.fillColor = new Color(20, 24, 24, 255);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        const panelW = Math.min(680, this._stageW - 120);
        const panelH = Math.min(430, this._stageH - 360);
        const x = -panelW / 2;
        const y = -panelH / 2;
        g.fillColor = new Color(234, 226, 204, 248);
        g.roundRect(x, y, panelW, panelH, 8);
        g.fill();
        g.strokeColor = new Color(116, 96, 72, 230);
        g.lineWidth = 3;
        g.roundRect(x, y, panelW, panelH, 8);
        g.stroke();
    }

    private _drawBootLoading() {
        this._bootPhase = 'loading';
        this._bootButtonRect = null;
        this._bootPressed = false;
        this._drawBootPanel();
        if (this._bootLoadingArtReady()) {
            this._setBootLabelsActive(false);
            this._drawBootArtLoadingScreen();
            this._bringBootToTop();
            return;
        }
        this._setBootLabelsActive(true);
        this._placeBootLabel(this._bootTitle, 'Caikesi', 0, 88, 520, 80, 48, new Color(58, 48, 36));
        this._placeBootLabel(this._bootHint, '加载战斗资源中...', 0, 18, 520, 48, 25, new Color(83, 74, 62));
        this._placeBootLabel(this._bootButton, '请稍候', 0, -92, 240, 52, 24, new Color(132, 120, 104));
    }

    private _showStartScreen() {
        if (this._gameStarted) return;
        this._bootPhase = 'ready';
        if (this._bootArtReady()) {
            this._setBootLabelsActive(false);
            this._drawBootArtStartScreen();
            this._bringBootToTop();
            return;
        }

        this._drawBootPanel();
        this._setBootLabelsActive(true);
        this._placeBootLabel(this._bootTitle, 'Caikesi', 0, 108, 520, 84, 50, new Color(58, 48, 36));
        this._placeBootLabel(this._bootHint, this._offlineNoticeText || '资源已就绪', 0, 36, 600, 48, 24, new Color(83, 74, 62));

        const buttonW = 260;
        const buttonH = 64;
        const buttonX = -buttonW / 2;
        const buttonY = -116;
        this._bootButtonRect = { x: buttonX, y: buttonY, w: buttonW, h: buttonH };
        const br = this._pressRect(buttonX, buttonY, buttonW, buttonH, this._bootPressed);
        this._bootGfx.fillColor = new Color(74, 96, 76, 245);
        this._bootGfx.roundRect(br.x, br.y, br.w, br.h, 8);
        this._bootGfx.fill();
        this._bootGfx.strokeColor = new Color(236, 220, 160, 230);
        this._bootGfx.lineWidth = 2;
        this._bootGfx.roundRect(br.x, br.y, br.w, br.h, 8);
        this._bootGfx.stroke();
        this._placeBootLabel(this._bootButton, '开始游戏', 0, buttonY + buttonH / 2, buttonW, buttonH, 28, new Color(248, 244, 226));
        this._bringBootToTop();
    }

    private _setBootLabelsActive(active: boolean) {
        if (this._bootTitle) this._bootTitle.node.active = active;
        if (this._bootHint) this._bootHint.node.active = active;
        if (this._bootButton) this._bootButton.node.active = active;
    }

    private _bootArtReady(): boolean {
        if (!this._art) return false;
        return BOOT_UI_KEYS.every(key => !!this._art.getSprite(key));
    }

    private _bootLoadingArtReady(): boolean {
        if (!this._art) return false;
        return BOOT_LOADING_UI_KEYS.every(key => !!this._art.getSprite(key));
    }

    private _drawBootArtLoadingScreen() {
        const g = this._bootGfx;
        g.clear();
        g.fillColor = new Color(0, 0, 0, 255);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        this._bootSpritesRoot.removeAllChildren();
        this._bootSpriteNodes = {};
        for (const s of BOOT_LOADING_UI_SPRITES) {
            this._addBootSprite(s.name, s.key, s.rect);
        }
    }

    private _drawBootArtStartScreen() {
        const g = this._bootGfx;
        g.clear();
        g.fillColor = new Color(0, 0, 0, 255);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        this._bootSpritesRoot.removeAllChildren();
        this._bootSpriteNodes = {};
        for (const s of BOOT_UI_SPRITES) {
            const n = this._addBootSprite(s.name, s.key, s.rect);
            if (s.name === 'BootStartButtonArt' && n && this._bootPressed) {
                n.setScale(PRESS_SCALE, PRESS_SCALE, 1);
            }
        }

        const r = this._sourceRect(BOOT_UI_RECTS.startButton);
        this._bootButtonRect = { x: r.x - r.w / 2, y: r.y - r.h / 2, w: r.w, h: r.h };
    }

    private _addBootSprite(name: string, key: string, rect: UiRect): Node | null {
        const sf = this._art.getSprite(key);
        if (!sf) return null;
        const n = new Node(name);
        n.layer = this.node.layer;
        const box = this._sourceRect(rect);
        n.setPosition(box.x, box.y, 0);
        n.addComponent(UITransform).setContentSize(box.w, box.h);
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = sf;
        n.getComponent(UITransform)!.setContentSize(box.w, box.h);
        this._bootSpritesRoot.addChild(n);
        this._bootSpriteNodes[name] = n;
        return n;
    }

    private _bringBootToTop() {
        if (this._bootRoot && this._bootRoot.parent) {
            this._bootRoot.setSiblingIndex(this.node.children.length - 1);
        }
    }

    private _pressRect(x: number, y: number, w: number, h: number, pressed: boolean): { x: number; y: number; w: number; h: number } {
        if (!pressed) return { x, y, w, h };
        const nw = w * PRESS_SCALE;
        const nh = h * PRESS_SCALE;
        return { x: x + (w - nw) / 2, y: y + (h - nh) / 2, w: nw, h: nh };
    }

    private _pressNode(node: Node | null | undefined) {
        if (!node) return;
        if (!this._pressBaseScale.has(node)) {
            const s = node.scale;
            this._pressBaseScale.set(node, new Vec3(s.x, s.y, s.z));
        }
        const base = this._pressBaseScale.get(node)!;
        node.setScale(base.x * PRESS_SCALE, base.y * PRESS_SCALE, base.z);
    }

    private _releaseNode(node: Node | null | undefined) {
        if (!node) return;
        const base = this._pressBaseScale.get(node);
        if (!base) return;
        node.setScale(base.x, base.y, base.z);
        this._pressBaseScale.delete(node);
    }

    private _bootButtonHit(e: EventTouch): boolean {
        if (!this._bootButtonRect) return false;
        const ui = e.getUILocation();
        const p = this._bootRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const r = this._bootButtonRect;
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }

    private _onBootTouchStart(e: EventTouch) {
        e.propagationStopped = true;
        if (this._bootPhase !== 'ready') return;
        this._bootPressed = this._bootButtonHit(e);
        if (this._bootPressed) this._showStartScreen();
    }

    private _onBootTouchMove(e: EventTouch) {
        if (this._bootPhase !== 'ready' || !this._bootPressed) return;
        if (!this._bootButtonHit(e)) {
            this._bootPressed = false;
            this._showStartScreen();
        }
    }

    private _onBootTouchCancel() {
        if (!this._bootPressed) return;
        this._bootPressed = false;
        this._showStartScreen();
    }

    private _onBootTap(e: EventTouch) {
        e.propagationStopped = true;
        const hit = this._bootButtonHit(e);
        if (this._bootPressed) {
            this._bootPressed = false;
            this._showStartScreen();
        }
        if (this._bootPhase !== 'ready' || !hit) return;
        this._enterGame();
    }

    private _enterGame() {
        if (this._gameStarted || this._bootPhase !== 'ready') return;
        this._gameStarted = true;
        this._bootPhase = 'playing';
        this._bootRoot.active = false;
        this._battleRoot.active = true;
        this._invView.refresh();
        this._startBattle();
    }

    private _onTap() {
        if (!this._mgr) return;
        if (this._invView && this._invView.isOpen()) return;  // 面板打开时，点击交给面板，不重开战斗
        if (this._settlementOpen()) return;                   // 结算页打开时，用结算页按钮处理
        if (this._chestOpen()) return;                        // 宝箱页打开时，用宝箱页按钮处理
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
        this._styledUiNodes = {};
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
        this._styledUiNodes[name] = n;
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

    private _bindPressFeedback(hitNode: Node, feedback: () => Node | null | undefined, onClick: () => void) {
        let pressed: Node | null = null;
        hitNode.on(Node.EventType.TOUCH_START, (e: any) => {
            e.propagationStopped = true;
            pressed = feedback() ?? null;
            this._pressNode(pressed);
        }, this);
        hitNode.on(Node.EventType.TOUCH_END, (e: any) => {
            e.propagationStopped = true;
            this._releaseNode(pressed);
            pressed = null;
            onClick();
        }, this);
        const cancel = () => {
            this._releaseNode(pressed);
            pressed = null;
        };
        hitNode.on(Node.EventType.TOUCH_CANCEL, cancel, this);
    }

    private _makeUiHotZone(name: string, rect: UiRect, onClick: () => void, feedbackName?: string) {
        const n = new Node(name);
        n.layer = this.node.layer;
        const box = this._sourceRect(rect);
        n.addComponent(UITransform).setContentSize(box.w, box.h);
        this.node.addChild(n);
        n.setPosition(box.x, box.y, 0);
        this._bindPressFeedback(n, () => feedbackName ? this._styledUiNodes[feedbackName] : n, onClick);
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
        this._settleRoot.on(Node.EventType.TOUCH_START, this._onSettlementTouchStart, this);
        this._settleRoot.on(Node.EventType.TOUCH_MOVE, this._onSettlementTouchMove, this);
        this._settleRoot.on(Node.EventType.TOUCH_END, this._onSettlementTap, this);
        this._settleRoot.on(Node.EventType.TOUCH_CANCEL, this._onSettlementTouchCancel, this);
    }

    private _settlementOpen(): boolean {
        return !!this._settleRoot && this._settleRoot.active;
    }

    private _hideSettlement() {
        if (this._settleRoot) this._settleRoot.active = false;
        this._pressedSettleKind = null;
    }

    private _createChestView() {
        this._chestRoot = new Node('ChestView');
        this._chestRoot.layer = this.node.layer;
        this._chestRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('ChestGfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._chestGfx = gfxNode.addComponent(Graphics);
        this._chestRoot.addChild(gfxNode);
        this.node.addChild(this._chestRoot);
        this._chestRoot.active = false;
        this._chestRoot.on(Node.EventType.TOUCH_START, this._onChestTouchStart, this);
        this._chestRoot.on(Node.EventType.TOUCH_MOVE, this._onChestTouchMove, this);
        this._chestRoot.on(Node.EventType.TOUCH_END, this._onChestTap, this);
        this._chestRoot.on(Node.EventType.TOUCH_CANCEL, this._onChestTouchCancel, this);
    }

    private async _refreshMaterialsCache(): Promise<void> {
        const data = await loadPlayerData();
        this._materials = { ...(data.materials ?? {}) };
    }

    // ===== 上阵面板（SquadView，占位）：选人 / 调前后序 / 存盘刷新，镜像 CraftView =====
    private _squadRoot: Node = null!;
    private _squadGfx: Graphics = null!;
    private _squadLabels: Label[] = [];
    private _squadHots: { rect: { x: number; y: number; w: number; h: number }; act: () => void }[] = [];

    private _createSquadView() {
        this._squadRoot = new Node('SquadView');
        this._squadRoot.layer = this.node.layer;
        this._squadRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('SquadGfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._squadGfx = gfxNode.addComponent(Graphics);
        this._squadRoot.addChild(gfxNode);
        this.node.addChild(this._squadRoot);
        this._squadRoot.active = false;
        this._squadRoot.on(Node.EventType.TOUCH_END, this._onSquadTap, this);
    }

    private _squadOpen(): boolean { return !!this._squadRoot && this._squadRoot.active; }

    private _toggleSquadPanel() {
        if (this._squadOpen()) this._hideSquadPanel();
        else this._showSquadPanel();
    }

    private _showSquadPanel() {
        if (!this._squadRoot || !this._squad) return;
        this._hideSettlement();
        this._hideChestPanel();
        this._hideCraftPanel();
        this._squadRoot.active = true;
        this._squadRoot.setSiblingIndex(this.node.children.length - 1);
        this._drawSquadPanel();
    }

    private _hideSquadPanel() {
        if (this._squadRoot) this._squadRoot.active = false;
    }

    // 面板本地 Label 工厂：必须挂到 _squadRoot（不能用 _makeLabel——那个挂 _battleRoot，
    // 面板隐藏后标签会残留在战斗层）。镜像现有 _craftLabel。
    private _squadLabel(i: number): Label {
        while (i >= this._squadLabels.length) {
            const n = new Node('SquadLbl');
            n.layer = this._squadRoot.layer;
            n.addComponent(UITransform);
            const lb = n.addComponent(Label);
            this._squadRoot.addChild(n);
            this._squadLabels.push(lb);
        }
        return this._squadLabels[i];
    }

    private _drawSquadPanel() {
        const g = this._squadGfx;
        g.clear();
        this._squadHots.length = 0;
        for (const l of this._squadLabels) l.node.active = false;
        let li = 0;
        const label = (s: string, x: number, y: number, size = 24) => {
            const lb = this._squadLabel(li++);
            lb.node.active = true; lb.string = s; lb.fontSize = size;
            lb.node.setPosition(x, y, 0);
        };

        // 半透明底板
        g.fillColor = new Color(20, 24, 30, 230);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        const deployed = this._squad.deployedList();
        label(`出战阵容  ${deployed.length}/${this._squad.squadCap}（点板凳上阵 / 点出战下阵 / ↑调前后）`, 0, 560, 26);

        const rowH = 96, top = 420, x0 = -300, rowW = 600;
        const pushRow = (name: string, y: number, tag: string, onRow: () => void, upBtn?: () => void) => {
            g.fillColor = new Color(48, 58, 72, 255);
            g.roundRect(x0, y - rowH / 2, rowW, rowH - 12, 10); g.fill();
            label(`${tag}  ${name}`, x0 + 20, y, 24);
            this._squadHots.push({ rect: { x: x0, y: y - rowH / 2, w: rowW - 96, h: rowH - 12 }, act: onRow });
            if (upBtn) {
                g.fillColor = new Color(80, 120, 160, 255);
                g.roundRect(x0 + rowW - 84, y - rowH / 2, 72, rowH - 12, 10); g.fill();
                label('↑', x0 + rowW - 56, y, 30);
                this._squadHots.push({ rect: { x: x0 + rowW - 84, y: y - rowH / 2, w: 72, h: rowH - 12 }, act: upBtn });
            }
        };

        let y = top;
        deployed.forEach((cls, i) => {
            pushRow(CHARACTER_LABEL[cls], y, `出战${i + 1}`,
                () => this._squadUndeploy(cls),
                i > 0 ? () => this._squadMove(cls, i - 1) : undefined);
            y -= rowH;
        });
        y -= 24;
        for (const cls of this._squad.benchList()) {
            pushRow(CHARACTER_LABEL[cls], y, '板凳', () => this._squadDeploy(cls));
            y -= rowH;
        }

        // 关闭按钮
        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(-90, -560, 180, 70, 12); g.fill();
        label('关闭', 0, -525, 26);
        this._squadHots.push({ rect: { x: -90, y: -560, w: 180, h: 70 }, act: () => this._hideSquadPanel() });
    }

    private _onSquadTap(e: EventTouch) {
        const ui = e.getUILocation();
        const p = this._squadRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        for (const h of this._squadHots) {
            if (p.x >= h.rect.x && p.x <= h.rect.x + h.rect.w && p.y >= h.rect.y && p.y <= h.rect.y + h.rect.h) {
                h.act();
                return;
            }
        }
    }

    private _squadDeploy(cls: SoldierClass) {
        if (this._squad.deploy(cls)) this._afterSquadChange();
    }
    private _squadUndeploy(cls: SoldierClass) {
        if (this._squad.undeploy(cls)) this._afterSquadChange();
    }
    private _squadMove(cls: SoldierClass, toIndex: number) {
        if (this._squad.move(cls, toIndex)) this._afterSquadChange();
    }
    private _afterSquadChange() {
        void saveSquad(this._squad);
        this._drawSquadPanel();
        if (this._gameStarted && !this._settlementOpen()) this._startBattle();
    }

    private _createCraftView() {
        this._craftRoot = new Node('CraftView');
        this._craftRoot.layer = this.node.layer;
        this._craftRoot.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        const gfxNode = new Node('CraftGfx');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform);
        this._craftGfx = gfxNode.addComponent(Graphics);
        this._craftRoot.addChild(gfxNode);
        this.node.addChild(this._craftRoot);
        this._craftRoot.active = false;
        this._craftRoot.on(Node.EventType.TOUCH_START, this._onCraftTouchStart, this);
        this._craftRoot.on(Node.EventType.TOUCH_MOVE, this._onCraftTouchMove, this);
        this._craftRoot.on(Node.EventType.TOUCH_END, this._onCraftTap, this);
        this._craftRoot.on(Node.EventType.TOUCH_CANCEL, this._onCraftTouchCancel, this);
    }

    private _craftOpen(): boolean {
        return !!this._craftRoot && this._craftRoot.active;
    }

    private _toggleCraftPanel() {
        if (this._craftOpen()) this._hideCraftPanel();
        else this._showCraftPanel();
    }

    private _showCraftPanel() {
        if (!this._craftRoot) return;
        this._hideSettlement();
        this._hideChestPanel();
        this._ensureSelectedCraftTier();
        this._craftRoot.active = true;
        this._craftRoot.setSiblingIndex(this.node.children.length - 1);
        this._renderCraftPanel();
    }

    private _hideCraftPanel() {
        if (this._craftRoot) this._craftRoot.active = false;
        this._pressedCraftKind = null;
        this._pressedCraftTierId = '';
        this._pressedCraftSlot = null;
    }

    private _ensureSelectedCraftTier(): string {
        const ids = craftTierIds();
        if (ids.includes(this._craftSelectedTier)) return this._craftSelectedTier;
        this._craftSelectedTier = ids[0] ?? '';
        return this._craftSelectedTier;
    }

    private _craftLabel(i: number): Label {
        while (i >= this._craftLabels.length) {
            const n = new Node('CraftLbl');
            n.layer = this._craftRoot.layer;
            n.addComponent(UITransform);
            const lb = n.addComponent(Label);
            this._craftRoot.addChild(n);
            this._craftLabels.push(lb);
        }
        return this._craftLabels[i];
    }

    private _renderCraftPanel() {
        const g = this._craftGfx;
        g.clear();
        this._craftHots = [];
        const tierId = this._ensureSelectedCraftTier();
        const tier = tierId ? getCraftTier(tierId) : null;
        let li = 0;
        const lbl = (x: number, y: number, text: string, size = 20, color = new Color(235, 238, 245)) => {
            const lb = this._craftLabel(li++);
            lb.node.active = true;
            lb.node.setPosition(x, y, 0);
            lb.string = text;
            lb.fontSize = size;
            lb.lineHeight = size + 4;
            lb.color = color;
            lb.horizontalAlign = Label.HorizontalAlign.CENTER;
            lb.verticalAlign = Label.VerticalAlign.CENTER;
        };

        g.fillColor = new Color(8, 10, 14, 170);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        const w = Math.min(760, this._halfW * 2 - 80);
        const h = Math.min(650, this._halfH * 2 - 90);
        const x = -w / 2;
        const y = -h / 2;
        g.fillColor = new Color(28, 31, 40, 246);
        g.roundRect(x, y, w, h, 8);
        g.fill();
        g.strokeColor = new Color(140, 200, 255, 205);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();

        lbl(0, y + h - 42, '材料合成', 30, new Color(140, 200, 255));
        lbl(0, y + h - 82, this._materialsHoldingText(), 18, new Color(190, 220, 190));

        this._drawCraftTierRow(g, lbl, x + 28, y + h - 130, w - 56, 54);
        this._drawCraftSlotRow(g, lbl, x + 28, y + h - 206, w - 56, 54);
        this._drawCraftCost(g, lbl, x + 28, y + h - 260, w - 56, 78, tier);
        this._drawCraftResult(g, lbl, x + 28, y + 96, w - 56, 150);
        if (this._craftMessage) lbl(0, y + 78, this._craftMessage, 17, new Color(255, 210, 150));

        const by = y + 40;
        const canCraft = !!tier && canAffordCraftTier(this._materials, tierId);
        this._craftButton(g, lbl, x + 70, by, 200, 50, '合成', 'craft', canCraft);
        this._craftButton(g, lbl, x + w - 250, by, 180, 50, '关闭', 'close', true);

        for (let i = li; i < this._craftLabels.length; i++) this._craftLabels[i].node.active = false;
    }

    private _materialsHoldingText(): string {
        const ids: MaterialId[] = ['forge_stone', 'gem_shard', 'rune_dust'];
        return ids.map(id => `${MATERIAL_LABEL[id]} ${this._materials[id] ?? 0}`).join('  ·  ');
    }

    private _drawCraftTierRow(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        rowH: number,
    ) {
        const ids = craftTierIds();
        const gap = 10;
        const btnW = (w - gap * Math.max(0, ids.length - 1)) / Math.max(1, ids.length);
        for (let i = 0; i < ids.length; i++) {
            const tierId = ids[i];
            const tier = getCraftTier(tierId);
            const bx = x + i * (btnW + gap);
            const selected = tierId === this._craftSelectedTier;
            const pressed = this._pressedCraftKind === 'tier' && this._pressedCraftTierId === tierId;
            const r = this._pressRect(bx, topY, btnW, rowH, pressed);
            g.fillColor = selected ? new Color(72, 110, 150, 245) : new Color(43, 48, 60, 235);
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill();
            g.strokeColor = selected ? new Color(140, 200, 255, 230) : new Color(88, 96, 112, 190);
            g.lineWidth = selected ? 3 : 2;
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.stroke();
            lbl(bx + btnW / 2, topY + rowH / 2 + 8, tier.label, 17, new Color(245, 248, 255));
            lbl(bx + btnW / 2, topY + rowH / 2 - 13, `Lv.${tier.levelMin}-${tier.levelMax}`, 13, new Color(180, 188, 204));
            this._craftHots.push({ x: bx, y: topY, w: btnW, h: rowH, kind: 'tier', tierId });
        }
    }

    private _drawCraftSlotRow(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        rowH: number,
    ) {
        const gap = 8;
        const btnW = (w - gap * (SLOTS.length - 1)) / SLOTS.length;
        for (let i = 0; i < SLOTS.length; i++) {
            const slot = SLOTS[i];
            const bx = x + i * (btnW + gap);
            const selected = slot === this._craftSelectedSlot;
            const pressed = this._pressedCraftKind === 'slot' && this._pressedCraftSlot === slot;
            const r = this._pressRect(bx, topY, btnW, rowH, pressed);
            g.fillColor = selected ? new Color(72, 110, 150, 245) : new Color(43, 48, 60, 235);
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill();
            g.strokeColor = selected ? new Color(140, 200, 255, 230) : new Color(88, 96, 112, 190);
            g.lineWidth = selected ? 3 : 2;
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.stroke();
            lbl(bx + btnW / 2, topY + rowH / 2, SLOT_LABEL[slot], 16, new Color(245, 248, 255));
            this._craftHots.push({ x: bx, y: topY, w: btnW, h: rowH, kind: 'slot', slot });
        }
    }

    private _drawCraftCost(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        h: number,
        tier: CraftTierConfig | null,
    ) {
        g.fillColor = new Color(35, 39, 50, 235);
        g.roundRect(x, topY - h, w, h, 8); g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, topY - h, w, h, 8); g.stroke();
        if (!tier) {
            lbl(x + w / 2, topY - h / 2, '暂无可用合成档位', 17, new Color(170, 178, 194));
            return;
        }
        const materialIds: MaterialId[] = ['forge_stone', 'gem_shard', 'rune_dust'];
        const costText = materialIds
            .filter(id => (tier.cost[id] ?? 0) > 0)
            .map(id => {
                const need = tier.cost[id] ?? 0;
                const have = this._materials[id] ?? 0;
                return `${MATERIAL_LABEL[id]} ${have}/${need}${have >= need ? '' : '（不足）'}`;
            })
            .join('   ');
        lbl(x + w / 2, topY - 26, `消耗材料：${costText}`, 16, new Color(230, 232, 238));
        lbl(x + w / 2, topY - 54, `产出：Lv.${tier.levelMin}-${tier.levelMax} 随机品质装备`, 15, new Color(180, 220, 190));
    }

    private _drawCraftResult(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
    ) {
        g.fillColor = new Color(32, 35, 45, 235);
        g.roundRect(x, y, w, h, 8); g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8); g.stroke();
        lbl(x + w / 2, y + h - 28, '本次合成结果', 20, new Color(230, 232, 238));
        if (!this._lastCraftResult) {
            lbl(x + w / 2, y + h / 2 - 8, '合成后在这里查看结果', 17, new Color(165, 174, 192));
            return;
        }
        const r = this._lastCraftResult;
        const qc = QUALITY_COLOR[r.item.quality];
        const cardW = Math.min(260, w - 40);
        const cx = x + (w - cardW) / 2;
        const cy = y + h - 118;
        g.fillColor = new Color(qc[0], qc[1], qc[2], 210);
        g.roundRect(cx, cy, cardW, 60, 6); g.fill();
        g.strokeColor = new Color(255, 255, 255, 90);
        g.lineWidth = 1;
        g.roundRect(cx, cy, cardW, 60, 6); g.stroke();
        lbl(cx + cardW / 2, cy + 38, `Lv.${r.item.level ?? 1} ${QUALITY_LABEL[r.item.quality]} · ${r.item.name}`, 15, new Color(245, 248, 255));
        lbl(cx + cardW / 2, cy + 16, `${SLOT_LABEL[r.item.slot]} → ${r.target}`, 13, new Color(245, 248, 255));
    }

    private _craftButton(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        kind: CraftHot['kind'],
        enabled: boolean,
    ) {
        const r = this._pressRect(x, y, w, h, enabled && this._pressedCraftKind === kind);
        g.fillColor = enabled ? new Color(67, 76, 96, 245) : new Color(48, 52, 62, 200);
        g.roundRect(r.x, r.y, r.w, r.h, 8);
        g.fill();
        g.strokeColor = enabled ? new Color(140, 200, 255, 220) : new Color(90, 94, 104, 180);
        g.lineWidth = 2;
        g.roundRect(r.x, r.y, r.w, r.h, 8);
        g.stroke();
        lbl(x + w / 2, y + h / 2, text, 18, enabled ? new Color(245, 248, 255) : new Color(145, 150, 160));
        if (enabled) this._craftHots.push({ x, y, w, h, kind });
    }

    private async _craftSelectedEquipment(): Promise<void> {
        if (this._availableEquipmentSlots() < 1) {
            this._craftMessage = '背包/仓库空间不足，无法合成';
            this._renderCraftPanel();
            return;
        }
        const tierId = this._ensureSelectedCraftTier();
        const result = craftEquipment(this._materials, tierId, this._craftSelectedSlot, Math.random);
        if (!result.ok || !result.item || !result.remainingMaterials) {
            this._craftMessage = result.reason ?? '合成失败';
            this._renderCraftPanel();
            return;
        }
        const placed = this._addRewardEquipments([result.item]);
        if (placed.failed > 0 || placed.received.length === 0) {
            this._craftMessage = '装备入库失败，材料未消耗';
            this._renderCraftPanel();
            return;
        }
        const data = await loadPlayerData();
        data.materials = result.remainingMaterials;
        data.inventory = this._inv.serialize();
        this._materials = { ...result.remainingMaterials };
        await savePlayerData();
        this._invView.refresh();
        const receivedEntry = placed.received[0];
        this._lastCraftResult = receivedEntry;
        this._craftMessage = `合成成功：${this._formatEquipReward(receivedEntry.item)}（进${receivedEntry.target}）`;
        this._renderCraftPanel();
    }

    private _craftHit(e: EventTouch): CraftHot | null {
        if (!this._craftOpen()) return null;
        const ui = e.getUILocation();
        const p = this._craftRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        return this._craftHots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) ?? null;
    }

    private _onCraftTouchStart(e: EventTouch) {
        if (!this._craftOpen()) return;
        e.propagationStopped = true;
        const hit = this._craftHit(e);
        this._pressedCraftKind = hit?.kind ?? null;
        this._pressedCraftTierId = hit?.tierId ?? '';
        this._pressedCraftSlot = hit?.slot ?? null;
        if (this._pressedCraftKind) this._renderCraftPanel();
    }

    private _onCraftTouchMove(e: EventTouch) {
        if (!this._pressedCraftKind) return;
        const hit = this._craftHit(e);
        if (hit?.kind === this._pressedCraftKind && (hit.tierId ?? '') === this._pressedCraftTierId && (hit.slot ?? null) === this._pressedCraftSlot) return;
        this._pressedCraftKind = null;
        this._pressedCraftTierId = '';
        this._pressedCraftSlot = null;
        this._renderCraftPanel();
    }

    private _onCraftTouchCancel() {
        if (!this._pressedCraftKind) return;
        this._pressedCraftKind = null;
        this._pressedCraftTierId = '';
        this._pressedCraftSlot = null;
        this._renderCraftPanel();
    }

    private _onCraftTap(e: EventTouch) {
        if (!this._craftOpen()) return;
        e.propagationStopped = true;
        const hit = this._craftHit(e);
        if (this._pressedCraftKind) {
            this._pressedCraftKind = null;
            this._pressedCraftTierId = '';
            this._pressedCraftSlot = null;
            this._renderCraftPanel();
        }
        if (!hit) return;
        if (hit.kind === 'close') {
            this._hideCraftPanel();
            return;
        }
        if (hit.kind === 'tier' && hit.tierId) {
            this._craftSelectedTier = hit.tierId;
            this._craftMessage = '';
            this._renderCraftPanel();
            return;
        }
        if (hit.kind === 'slot' && hit.slot) {
            this._craftSelectedSlot = hit.slot;
            this._craftMessage = '';
            this._renderCraftPanel();
            return;
        }
        if (hit.kind === 'craft') void this._craftSelectedEquipment();
    }

    private _chestOpen(): boolean {
        return !!this._chestRoot && this._chestRoot.active;
    }

    private _toggleChestPanel() {
        if (this._chestOpen()) this._hideChestPanel();
        else this._showChestPanel();
    }

    private _showChestPanel() {
        if (!this._chestRoot) return;
        this._hideSettlement();
        this._hideCraftPanel();
        this._ensureSelectedChest();
        this._chestRoot.active = true;
        this._chestRoot.setSiblingIndex(this.node.children.length - 1);
        this._renderChestPanel();
    }

    private _hideChestPanel() {
        if (this._chestRoot) this._chestRoot.active = false;
        this._pressedChestKind = null;
        this._pressedChestId = '';
    }

    private _chestLabel(i: number): Label {
        while (i >= this._chestLabels.length) {
            const n = new Node('ChestLbl');
            n.layer = this._chestRoot.layer;
            n.addComponent(UITransform);
            const lb = n.addComponent(Label);
            this._chestRoot.addChild(n);
            this._chestLabels.push(lb);
        }
        return this._chestLabels[i];
    }

    private _renderChestPanel() {
        const g = this._chestGfx;
        g.clear();
        this._chestHots = [];
        const selected = this._ensureSelectedChest();
        let li = 0;
        const lbl = (x: number, y: number, text: string, size = 20, color = new Color(235, 238, 245)) => {
            const lb = this._chestLabel(li++);
            lb.node.active = true;
            lb.node.setPosition(x, y, 0);
            lb.string = text;
            lb.fontSize = size;
            lb.lineHeight = size + 4;
            lb.color = color;
            lb.horizontalAlign = Label.HorizontalAlign.CENTER;
            lb.verticalAlign = Label.VerticalAlign.CENTER;
        };

        g.fillColor = new Color(8, 10, 14, 170);
        g.rect(-this._halfW, -this._halfH, this._halfW * 2, this._halfH * 2);
        g.fill();

        const w = Math.min(760, this._halfW * 2 - 80);
        const h = Math.min(650, this._halfH * 2 - 90);
        const x = -w / 2;
        const y = -h / 2;
        g.fillColor = new Color(28, 31, 40, 246);
        g.roundRect(x, y, w, h, 8);
        g.fill();
        g.strokeColor = new Color(255, 226, 126, 205);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8);
        g.stroke();

        const total = this._chests?.chests.length ?? 0;
        const maxChests = this._chests?.maxChests ?? 0;
        lbl(0, y + h - 42, `宝箱库存：${total}/${maxChests}`, 30, new Color(255, 226, 126));
        if (total === 0) {
            lbl(0, y + h - 118, '暂无宝箱，战斗和离线会自动积累', 20, new Color(190, 198, 214));
        } else {
            const counts = this._chestCountsText();
            lbl(0, y + h - 82, counts, 18, new Color(190, 220, 190));
            this._drawChestList(g, lbl, x + 28, y + h - 132, 292, 54);
            this._drawSelectedChest(g, lbl, x + 350, y + h - 132, w - 378, 146, selected);
        }
        this._drawChestOpenResult(g, lbl, x + 28, y + 118, w - 56, 210);
        if (this._chestMessage) lbl(0, y + 90, this._chestMessage, 17, new Color(255, 210, 150));

        const by = y + 40;
        this._chestButton(g, lbl, x + 70, by, 180, 50, '开启选中', 'open', !!selected);
        this._chestButton(g, lbl, x + w - 250, by, 180, 50, '关闭', 'close', true);

        for (let i = li; i < this._chestLabels.length; i++) this._chestLabels[i].node.active = false;
    }

    private _ensureSelectedChest(): ChestItem | null {
        if (!this._chests || this._chests.chests.length === 0) {
            this._selectedChestId = '';
            return null;
        }
        const selected = this._chests.chests.find(chest => chest.id === this._selectedChestId);
        if (selected) return selected;
        this._selectedChestId = this._chests.chests[0].id;
        return this._chests.chests[0];
    }

    private _drawChestList(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        rowH: number,
    ) {
        lbl(x + w / 2, topY + 22, '选择宝箱', 20, new Color(230, 232, 238));
        const maxRows = 3;
        const list = this._chests.chests.slice(0, maxRows);
        for (let i = 0; i < list.length; i++) {
            const chest = list[i];
            const y = topY - 34 - i * (rowH + 8);
            const selected = chest.id === this._selectedChestId;
            const pressed = this._pressedChestKind === 'select' && this._pressedChestId === chest.id;
            const r = this._pressRect(x, y, w, rowH, pressed);
            g.fillColor = selected ? new Color(72, 82, 104, 245) : new Color(43, 48, 60, 235);
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill();
            g.strokeColor = selected ? new Color(255, 226, 126, 230) : new Color(88, 96, 112, 190);
            g.lineWidth = selected ? 3 : 2;
            g.roundRect(r.x, r.y, r.w, r.h, 8); g.stroke();
            const levelName = BattleConfig.levels[chest.sourceLevelIndex]?.name ?? `第 ${chest.sourceLevelIndex + 1} 关`;
            lbl(x + 70, y + rowH / 2 + 8, chestTypeLabel(chest.type), 17, new Color(245, 248, 255));
            lbl(x + w - 92, y + rowH / 2 + 8, levelName, 14, new Color(180, 188, 204));
            lbl(x + w / 2, y + rowH / 2 - 13, chest.sourceDropGroup, 13, new Color(150, 158, 178));
            this._chestHots.push({ x, y, w, h: rowH, kind: 'select', chestId: chest.id });
        }
        const remain = this._chests.chests.length - list.length;
        if (remain > 0) lbl(x + w / 2, topY - 34 - maxRows * (rowH + 8) + 18, `另有 ${remain} 个，开启前列宝箱后继续显示`, 14, new Color(165, 174, 192));
    }

    private _drawSelectedChest(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        topY: number,
        w: number,
        h: number,
        chest: ChestItem | null,
    ) {
        g.fillColor = new Color(35, 39, 50, 235);
        g.roundRect(x, topY - h, w, h, 8); g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, topY - h, w, h, 8); g.stroke();
        lbl(x + w / 2, topY - 28, '当前选中', 20, new Color(230, 232, 238));
        if (!chest) {
            lbl(x + w / 2, topY - 78, '暂无可开启宝箱', 17, new Color(170, 178, 194));
            return;
        }
        const levelName = BattleConfig.levels[chest.sourceLevelIndex]?.name ?? `第 ${chest.sourceLevelIndex + 1} 关`;
        const preview = openChest(chest);
        const equipCount = preview.reward?.equipments.length ?? 0;
        const materials = this._formatMaterials(preview.reward?.materials ?? []);
        lbl(x + w / 2, topY - 62, `${chestTypeLabel(chest.type)} · ${levelName}`, 20, new Color(255, 226, 126));
        lbl(x + w / 2, topY - 94, `预计：装备 ${equipCount} 件  材料 ${materials || '无'}`, 15, new Color(205, 214, 232));
        lbl(x + w / 2, topY - 122, `空间：${this._availableEquipmentSlots()} / 需要 ${equipCount}`, 15, new Color(170, 220, 180));
    }

    private _drawChestOpenResult(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
    ) {
        g.fillColor = new Color(32, 35, 45, 235);
        g.roundRect(x, y, w, h, 8); g.fill();
        g.strokeColor = new Color(88, 96, 112, 190);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8); g.stroke();
        lbl(x + w / 2, y + h - 28, '本次开箱奖励', 20, new Color(230, 232, 238));
        if (!this._lastChestOpen) {
            lbl(x + w / 2, y + h / 2 - 8, '开启宝箱后在这里查看奖励明细', 17, new Color(165, 174, 192));
            return;
        }
        const result = this._lastChestOpen;
        lbl(x + w / 2, y + h - 62, `${result.chestLabel}：装备 ${result.received.length} 件  材料 ${this._formatMaterials(result.materials) || '无'}`, 17, new Color(255, 226, 126));
        const items = result.received.slice(0, 6);
        const cardW = Math.min(176, (w - 56) / 3);
        for (let i = 0; i < items.length; i++) {
            const r = items[i];
            const col = i % 3;
            const row = Math.floor(i / 3);
            const cx = x + 28 + col * (cardW + 10);
            const cy = y + h - 130 - row * 58;
            const qc = QUALITY_COLOR[r.item.quality];
            g.fillColor = new Color(qc[0], qc[1], qc[2], 210);
            g.roundRect(cx, cy, cardW, 46, 6); g.fill();
            g.strokeColor = new Color(255, 255, 255, 90);
            g.lineWidth = 1;
            g.roundRect(cx, cy, cardW, 46, 6); g.stroke();
            lbl(cx + cardW / 2, cy + 28, `Lv.${r.item.level ?? 1} ${QUALITY_LABEL[r.item.quality]} · ${r.item.name}`, 14, new Color(245, 248, 255));
            lbl(cx + cardW / 2, cy + 12, `${SLOT_LABEL[r.item.slot]} → ${r.target}`, 12, new Color(245, 248, 255));
        }
        if (result.received.length > items.length) lbl(x + w / 2, y + 18, `另有 ${result.received.length - items.length} 件装备已入库`, 14, new Color(190, 198, 214));
    }

    private _chestCountsText(): string {
        const counts: Record<string, number> = { normal: 0, boss: 0, chapter: 0 };
        for (const chest of this._chests.chests) counts[chest.type] = (counts[chest.type] ?? 0) + 1;
        return `普通 ${counts.normal}  ·  Boss ${counts.boss}  ·  章节 ${counts.chapter}`;
    }

    private _chestButton(
        g: Graphics,
        lbl: (x: number, y: number, text: string, size?: number, color?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
        text: string,
        kind: ChestHot['kind'],
        enabled: boolean,
    ) {
        const r = this._pressRect(x, y, w, h, enabled && this._pressedChestKind === kind);
        g.fillColor = enabled ? new Color(67, 76, 96, 245) : new Color(48, 52, 62, 200);
        g.roundRect(r.x, r.y, r.w, r.h, 8);
        g.fill();
        g.strokeColor = enabled ? new Color(255, 226, 126, 220) : new Color(90, 94, 104, 180);
        g.lineWidth = 2;
        g.roundRect(r.x, r.y, r.w, r.h, 8);
        g.stroke();
        lbl(x + w / 2, y + h / 2, text, 18, enabled ? new Color(245, 248, 255) : new Color(145, 150, 160));
        if (enabled) this._chestHots.push({ x, y, w, h, kind });
    }

    private _chestHit(e: EventTouch): ChestHot | null {
        if (!this._chestOpen()) return null;
        const ui = e.getUILocation();
        const p = this._chestRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        return this._chestHots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) ?? null;
    }

    private _onChestTouchStart(e: EventTouch) {
        if (!this._chestOpen()) return;
        e.propagationStopped = true;
        const hit = this._chestHit(e);
        this._pressedChestKind = hit?.kind ?? null;
        this._pressedChestId = hit?.chestId ?? '';
        if (this._pressedChestKind) this._renderChestPanel();
    }

    private _onChestTouchMove(e: EventTouch) {
        if (!this._pressedChestKind) return;
        const hit = this._chestHit(e);
        if (hit?.kind === this._pressedChestKind && (hit.chestId ?? '') === this._pressedChestId) return;
        this._pressedChestKind = null;
        this._pressedChestId = '';
        this._renderChestPanel();
    }

    private _onChestTouchCancel() {
        if (!this._pressedChestKind) return;
        this._pressedChestKind = null;
        this._pressedChestId = '';
        this._renderChestPanel();
    }

    private _onChestTap(e: EventTouch) {
        if (!this._chestOpen()) return;
        e.propagationStopped = true;
        const hit = this._chestHit(e);
        if (this._pressedChestKind) {
            this._pressedChestKind = null;
            this._pressedChestId = '';
            this._renderChestPanel();
        }
        if (!hit) return;
        if (hit.kind === 'close') {
            this._hideChestPanel();
            return;
        }
        if (hit.kind === 'select' && hit.chestId) {
            this._selectedChestId = hit.chestId;
            this._chestMessage = '';
            this._renderChestPanel();
            return;
        }
        if (hit.kind === 'open') void this._openSelectedChest();
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
        this._hideCraftPanel();
        this._lastComplete = complete;
        this._settleRewards = rewards;
        this._settleFailed = failed;
        this._pressedSettleKind = null;
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

    private _rerenderSettlement() {
        if (!this._lastComplete || !this._settlementOpen()) return;
        this._renderSettlement(this._settleRewards, this._settleFailed, this._lastComplete);
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
        const r = this._pressRect(x, y, w, h, enabled && this._pressedSettleKind === kind);
        g.fillColor = enabled ? new Color(67, 76, 96, 245) : new Color(48, 52, 62, 200);
        g.roundRect(r.x, r.y, r.w, r.h, 8);
        g.fill();
        g.strokeColor = enabled ? new Color(255, 226, 126, 220) : new Color(90, 94, 104, 180);
        g.lineWidth = 2;
        g.roundRect(r.x, r.y, r.w, r.h, 8);
        g.stroke();
        lbl(x + w / 2, y + h / 2, text, 18, enabled ? new Color(245, 248, 255) : new Color(145, 150, 160));
        if (enabled) this._settleHots.push({ x, y, w, h, kind });
    }

    private _settlementHit(e: EventTouch): SettleHot | null {
        if (!this._settlementOpen()) return null;
        const ui = e.getUILocation();
        const p = this._settleRoot.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        return this._settleHots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) ?? null;
    }

    private _onSettlementTouchStart(e: EventTouch) {
        if (!this._settlementOpen()) return;
        e.propagationStopped = true;
        const hit = this._settlementHit(e);
        this._pressedSettleKind = hit?.kind ?? null;
        if (this._pressedSettleKind) this._rerenderSettlement();
    }

    private _onSettlementTouchMove(e: EventTouch) {
        if (!this._pressedSettleKind) return;
        const hit = this._settlementHit(e);
        if (hit?.kind === this._pressedSettleKind) return;
        this._pressedSettleKind = null;
        this._rerenderSettlement();
    }

    private _onSettlementTouchCancel() {
        if (!this._pressedSettleKind) return;
        this._pressedSettleKind = null;
        this._rerenderSettlement();
    }

    private _onSettlementTap(e: EventTouch) {
        if (!this._settlementOpen()) return;
        e.propagationStopped = true;
        const hit = this._settlementHit(e);
        if (this._pressedSettleKind) {
            this._pressedSettleKind = null;
            this._rerenderSettlement();
        }
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
        this._actionPreviewAnim?.update(Math.min(dt, 0.05));
        if (!this._mgr) return;
        this._bg.update(dt);   // 背景（云飘动）
        if (this._offlineNoticeTtl > 0) this._offlineNoticeTtl = Math.max(0, this._offlineNoticeTtl - dt);
        // dt 兜底，防止切后台回来一帧巨大导致瞬移
        const phaseBefore = this._mgr.phase;
        this._mgr.tick(Math.min(dt, 0.05));
        this._processBattleEvents();
        if (phaseBefore !== 'won' && this._mgr.phase === 'won') this._awardVictoryDrop();
        this._updateSoldierVisualActions();
        this._render();
        this._renderFloats();
        this._renderSkillStatus(Math.min(dt, 0.05));
        this._updateSoldierAnimations(Math.min(dt, 0.05));
        this._updateLabels();
        this._invView.update(dt);
    }

    private _updateSoldierVisualActions() {
        for (const sol of this._mgr.soldiers) {
            this._setSoldierVisualAction(sol.cls, sol.action);
        }
    }

    private _updateSoldierAnimations(dt: number) {
        for (const sol of this._mgr.soldiers) {
            const art = this._solSprite[sol.cls];
            if (art) art.anim.update(dt);
        }
    }

    // —— 战斗飘字（用 Label 池，按需复用）——
    private _floats: Label[] = [];
    private _getFloat(i: number): Label {
        while (i >= this._floats.length) {
            const node = new Node('Float');
            node.layer = this.node.layer;
            node.addComponent(UITransform);
            const lb = node.addComponent(Label);
            lb.cacheMode = Label.CacheMode.CHAR;   // 飘字每帧变，逐字符缓存避免整张纹理重建
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
                case 'crit':  lb.fontSize = 42; lb.color = this._tmpColor.set(255, 180, 40, a); break;
                case 'block': lb.fontSize = 28; lb.color = this._tmpColor.set(120, 200, 255, a); break;
                case 'skill': lb.fontSize = 36; lb.color = this._tmpColor.set(120, 235, 255, a); break;
                case 'dodge': lb.fontSize = 28; lb.color = this._tmpColor.set(210, 210, 210, a); break;
                default:      lb.fontSize = 30; lb.color = this._tmpColor.set(255, 255, 255, a); break;
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
            if (!e.alive && e.action !== 'death') continue;
            const deathFade = e.action === 'death' ? Math.max(0, 1 - e.actionTime / 0.9) : 1;
            const actionScale = e.action === 'attack' ? 1.08 : (e.action === 'death' ? 1.12 : 1);
            const er = e.radius * actionScale;
            const alpha = e.action === 'death' ? Math.max(35, Math.round(180 * deathFade)) : 220;
            g.fillColor = this._tmpColor.set(
                Math.max(48, Math.round(e.color[0] * 0.42)),
                Math.max(42, Math.round(e.color[1] * 0.42)),
                Math.max(38, Math.round(e.color[2] * 0.42)),
                alpha,
            );
            g.circle(e.x, e.y, er);
            g.fill();

            if (e.action === 'attack' && e.alive) {
                g.strokeColor = this._cEnemyAtkRing;
                g.lineWidth = 3;
                g.circle(e.x, e.y, er + 5);
                g.stroke();
            }

            if (!e.alive) continue;

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

        // 近战劈砍连线（白色粗线，近战单位→正在劈的怪）；光束数组是池，只有前 count 条有效
        g.strokeColor = this._cMeleeBeam;
        g.lineWidth = 7;
        for (let i = 0; i < this._mgr.meleeBeamCount; i++) {
            const mb = this._mgr.meleeBeams[i];
            g.moveTo(mb.fromX, mb.fromY);
            g.lineTo(mb.toX, mb.toY);
        }
        g.stroke();

        // 治疗光束（绿色细线，治疗→被奶的队友）
        g.strokeColor = this._cHealBeam;
        g.lineWidth = 4;
        for (let i = 0; i < this._mgr.healBeamCount; i++) {
            const hb = this._mgr.healBeams[i];
            g.moveTo(hb.fromX, hb.fromY);
            g.lineTo(hb.toX, hb.toY);
        }
        g.stroke();

        // 士兵（按职业上色的方块，受伤变灰；坦克更大）
        for (const sol of this._mgr.soldiers) {
            const showDeath = !sol.alive && sol.action === 'death';
            if (!sol.alive && !showDeath) {
                const hidden = this._solSprite[sol.cls];
                if (hidden) hidden.node.active = false;
                continue;
            }
            const size = BattleConfig.classes[sol.cls].size;
            const ratio = Math.max(0, sol.hp / sol.maxHp);

            const art = this._solSprite[sol.cls];
            if (art) {
                art.node.active = true;
                art.node.setPosition(sol.x + art.offsetX, sol.y + art.offsetY, 0);
            }
            if (!art) {
                g.fillColor = this._cSolShadow;
                g.circle(sol.x, sol.y - size * 0.48, size * 0.45);
                g.fill();
                g.fillColor = ratio > 0.35 ? this._cClass[sol.cls] : this._cSoldierHurt;
                g.roundRect(sol.x - size / 2, sol.y - size / 2, size, size, 8);
                g.fill();
            }

            if (!sol.alive) continue;

            // 士兵头顶血条
            const w = size;
            const visualHeight = art ? art.visualHeight : size;
            const by = sol.y + visualHeight / 2 + 6;
            g.fillColor = this._cEnemyHpBg;
            g.rect(sol.x - w / 2, by, w, 5);
            g.fill();
            g.fillColor = this._cAllyHp;
            g.rect(sol.x - w / 2, by, w * ratio, 5);
            g.fill();
        }
    }

    private _shownWaveKey = -1;   // levelIndex*1000+waveIndex，波次文本脏标记（避免每帧拼字符串）

    private _updateLabels() {
        const m = this._mgr;
        if (this._waveLabel.node.active) this._waveLabel.string = m.levelName;
        const waveKey = m.levelIndex * 1000 + m.waveIndex;
        if (this._hpLabel.node.active && this._shownWaveKey !== waveKey) {
            this._shownWaveKey = waveKey;
            this._hpLabel.string = `${m.waveIndex + 1}/${m.totalWaves}波`;
        }

        if (m.phase === 'won') {
            this._statusLabel.string = '通关！';
            this._rewardLabel.string = this._winRewardText;
        } else if (m.phase === 'lost') {
            this._statusLabel.string = '小队全灭  点击重开';
            this._rewardLabel.string = '';
        } else {
            this._statusLabel.string = '';
            this._rewardLabel.string = this._offlineNoticeTtl > 0 ? this._offlineNoticeText : '';
        }
    }

    private _awardVictoryDrop() {
        const result = this._grantDropItems(this._mgr.levelIndex);
        const complete = this._progress.completeLevel(this._mgr.levelIndex);
        void saveProgress(this._progress);
        const chestText = this._battleChestDropCount > 0 ? `；宝箱 +${this._battleChestDropCount}` : '';

        if (result.received.length > 0) {
            this._winRewardText = this._formatDropSummary(result.received, result.failed) + chestText;
            void saveInventory(this._inv);
            this._invView.refresh();
        } else {
            this._winRewardText = `奖励未领取：背包/仓库已满${chestText}`;
        }
        this._showSettlement(result.received, result.failed, complete);
    }

    // 技能 UI 的数据源：第一个有技能的存活士兵（当前=单人 dps）
    private _skillSource() {
        if (!this._mgr) return null;
        const s = this._mgr.soldiers.find(u => u.alive && u.skills.count > 0);
        return s ? s.skills : null;
    }

    private _onSkillCast(event: SkillCastEvent) {
        const sk = this._skillSource();
        if (!sk) return;
        for (let i = 0; i < Math.min(3, sk.count); i++) {
            if (sk.defAt(i)?.id === event.skillId) { this._skillFlash[i] = 0.3; break; }
        }
    }

    // 技能按钮状态：未就绪部分盖半透明遮罩（进度从下往上点亮），释放瞬间白光一闪
    private _renderSkillStatus(dt: number) {
        const g = this._skillGfx;
        if (!g) return;
        g.clear();
        const sk = this._skillSource();
        if (!sk) return;
        const rects = [UI_RECTS.skill1, UI_RECTS.skill2, UI_RECTS.skill3];
        for (let i = 0; i < Math.min(3, sk.count); i++) {
            const box = this._sourceRect(rects[i]);
            const p = sk.progress(i);
            if (p < 1) {
                g.fillColor = this._tmpColor.set(0, 0, 0, 140);
                g.rect(box.x - box.w / 2, box.y - box.h / 2 + box.h * p, box.w, box.h * (1 - p));
                g.fill();
            }
            if (this._skillFlash[i] > 0) {
                this._skillFlash[i] = Math.max(0, this._skillFlash[i] - dt);
                g.fillColor = this._tmpColor.set(255, 255, 255, Math.round(160 * (this._skillFlash[i] / 0.3)));
                g.rect(box.x - box.w / 2, box.y - box.h / 2, box.w, box.h);
                g.fill();
            }
        }
    }

    private _processBattleEvents() {
        if (!this._mgr || !this._chests) return;
        if (this._mgr.eventCount <= 0) return;
        const events = this._mgr.drainEvents();

        const createdAt = Date.now();
        let gained = 0;
        for (const event of events) {
            if (event.type === 'skillCast') {
                this._onSkillCast(event);
                continue;
            }
            const level = BattleConfig.levels[event.levelIndex];
            if (!level) continue;
            const mobReward = rollChestDrop({
                levelIndex: event.levelIndex,
                dropGroup: level.dropGroup,
                source: 'monster',
                seed: `${this._battleSeed}|kill|${event.killIndex}|${event.enemyType}|monster`,
                createdAt,
            });
            for (const chest of mobReward.chests) {
                const r = this._chests.addChest(chest);
                if (r.ok) gained++;
            }
            if (!event.isStageFinalKill) continue;
            const finalReward = rollChestDrop({
                levelIndex: event.levelIndex,
                dropGroup: level.dropGroup,
                source: 'stageFinal',
                seed: `${this._battleSeed}|kill|${event.killIndex}|${event.enemyType}|stageFinal`,
                createdAt,
            });
            for (const chest of finalReward.chests) {
                const r = this._chests.addChest(chest);
                if (r.ok) gained++;
            }
        }

        if (gained <= 0) return;
        this._battleChestDropCount += gained;
        this._offlineNoticeText = `获得宝箱 +${gained}`;
        this._offlineNoticeTtl = 5;
        if (this._chestOpen()) this._renderChestPanel();
        void saveChests(this._chests);
    }

    private _currentLevelIndex(): number {
        if (this._mgr) return this._mgr.levelIndex;
        return this._progress ? this._progress.currentLevel : BattleConfig.startLevel;
    }

    private _configuredDebugDrop(): OpResult {
        const result = this._grantDropItems(this._currentLevelIndex());
        if (result.received.length > 0) return { ok: true, item: result.received[0].item };
        return { ok: false, reason: '背包/仓库已满' };
    }

    private _grantDropItems(levelIndex: number): { received: RewardEntry[]; failed: number } {
        const reward = generateStageReward({
            levelIndex,
            source: 'StageClear',
            seed: `stage-clear|${levelIndex}|${Date.now()}|${Math.random()}`,
        });
        return this._addRewardEquipments(reward.equipments);
    }

    private _availableEquipmentSlots(): number {
        if (!this._inv) return 0;
        return Math.max(0, this._inv.maxBackpack - this._inv.backpack.length)
            + Math.max(0, this._inv.maxWarehouse - this._inv.warehouse.length);
    }

    private _addRewardEquipments(drops: EquipItem[]): { received: RewardEntry[]; failed: number } {
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

    private async _openSelectedChest(): Promise<void> {
        if (!this._chests || this._chests.chests.length === 0) {
            this._chestMessage = '暂无可开启宝箱';
            this._renderChestPanel();
            return;
        }
        const chest = this._ensureSelectedChest();
        if (!chest) {
            this._chestMessage = '暂无可开启宝箱';
            this._renderChestPanel();
            return;
        }
        const result = openChest(chest);
        if (!result.ok || !result.reward) {
            this._chestMessage = result.reason ?? '开箱失败';
            this._renderChestPanel();
            return;
        }
        const reward = result.reward;
        if (reward.equipments.length > this._availableEquipmentSlots()) {
            this._chestMessage = '背包/仓库空间不足，无法开箱';
            this._renderChestPanel();
            return;
        }

        const received = this._addRewardEquipments(reward.equipments);
        if (received.failed > 0) {
            this._chestMessage = '装备入库失败，宝箱未消耗';
            this._renderChestPanel();
            return;
        }

        const data = await loadPlayerData();
        data.materials = data.materials ?? {};
        for (const material of reward.materials) {
            data.materials[material.id] = (data.materials[material.id] ?? 0) + material.count;
        }
        this._materials = { ...data.materials };
        this._chests.removeChest(chest.id);
        this._selectedChestId = this._chests.chests[0]?.id ?? '';
        await saveInventory(this._inv);
        await saveChests(this._chests);
        await savePlayerData();
        this._invView.refresh();
        this._lastChestOpen = {
            chestLabel: chestTypeLabel(chest.type),
            received: received.received,
            materials: reward.materials,
        };
        const materialText = this._formatMaterials(reward.materials);
        this._chestMessage = `开启${chestTypeLabel(chest.type)}：${received.received.length} 件装备${materialText ? `，${materialText}` : ''}`;
        this._offlineNoticeText = this._chestMessage;
        this._offlineNoticeTtl = 8;
        this._renderChestPanel();
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
        return `Lv.${item.level ?? 1} ${QUALITY_LABEL[item.quality]}·${item.name}`;
    }

    private _formatMaterials(materials: MaterialItem[], maxParts = 3): string {
        const visible = materials.filter(material => material.count > 0);
        if (visible.length === 0) return '';
        const parts = visible
            .slice(0, maxParts)
            .map(material => `${MATERIAL_LABEL[material.id]} +${material.count}`);
        const extra = visible.length > maxParts ? ` 等${visible.length}种` : '';
        return parts.join('、') + extra;
    }

    private _formatMaterials(materials: MaterialItem[], maxParts = 3): string {
        const visible = materials.filter(material => material.count > 0);
        if (visible.length === 0) return '';
        const parts = visible
            .slice(0, maxParts)
            .map(material => `${MATERIAL_LABEL[material.id]} +${material.count}`);
        const extra = visible.length > maxParts ? ` 等${visible.length}种` : '';
        return parts.join('、') + extra;
    }

    private async _claimOfflineRewards(): Promise<void> {
        const result = await claimOfflineReward({ levelIndex: this._progress.currentLevel });
        const hasReward = result.gold > 0 || result.exp > 0 || result.chests.length > 0 || result.chestOverflow > 0;
        if (!hasReward || result.seconds <= 0) return;
        const overflow = result.chestOverflow > 0 ? `，${result.chestOverflow} 个宝箱因库存已满未入库` : '';
        this._offlineNoticeText = `离线收益：+${result.gold} 金币 +${result.exp} 经验 +${result.chests.length} 宝箱${overflow}`;
        this._offlineNoticeTtl = 10;
    }

    private _ensureActionPreviewRoot() {
        if (this._actionPreviewRoot) return;

        const root = new Node('ActionPreview');
        root.layer = this.node.layer;
        root.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        this.node.addChild(root);
        root.setPosition(0, 0, 0);

        const gfxNode = new Node('ActionPreviewGuide');
        gfxNode.layer = this.node.layer;
        gfxNode.addComponent(UITransform).setContentSize(this._halfW * 2, this._halfH * 2);
        this._actionPreviewGfx = gfxNode.addComponent(Graphics);
        root.addChild(gfxNode);

        const spriteNode = new Node('ActionPreviewSprite');
        spriteNode.layer = this.node.layer;
        spriteNode.addComponent(UITransform);
        const sprite = spriteNode.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        root.addChild(spriteNode);

        const blendNode = new Node('ActionPreviewBlend');
        blendNode.layer = this.node.layer;
        blendNode.addComponent(UITransform);
        const blendSprite = blendNode.addComponent(Sprite);
        blendSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        blendNode.active = false;
        spriteNode.addChild(blendNode);

        const labelNode = new Node('ActionPreviewLabel');
        labelNode.layer = this.node.layer;
        labelNode.addComponent(UITransform);
        const label = labelNode.addComponent(Label);
        label.fontSize = 22;
        label.lineHeight = 28;
        label.color = new Color(245, 235, 210, 245);
        root.addChild(labelNode);

        this._actionPreviewRoot = root;
        this._actionPreviewNode = spriteNode;
        this._actionPreviewBlendNode = blendNode;
        this._actionPreviewLabel = label;
        this._actionPreviewAnim = new FrameAnimPlayer(sprite, [], 1, true, false, blendSprite, 0);
        root.setSiblingIndex(this.node.children.length - 1);
    }

    private async _showActionPreview(req: ActionPreviewRequest) {
        if (!this._art || !req.key) return;
        this._ensureActionPreviewRoot();
        await this._art.preload([req.key]);
        const clip = this._art.getFrames(req.key);
        if (!clip || !clip.frames.length) {
            this._showActionPreviewMessage(`缺图或非序列帧: ${req.key}`);
            return;
        }

        const root = this._actionPreviewRoot!;
        const spriteNode = this._actionPreviewNode!;
        const blendNode = this._actionPreviewBlendNode!;
        const anim = this._actionPreviewAnim!;
        // 与战斗单位同一套显示框/锚点算法，预览即所得
        const targetH = Math.max(32, req.height);
        const box = this._clipBoxForHeight(targetH, clip);
        const w = box.w;
        const h = box.h;

        root.active = true;
        root.setSiblingIndex(this.node.children.length - 1);
        spriteNode.active = true;
        spriteNode.getComponent(UITransform)!.setContentSize(w, h);
        blendNode.getComponent(UITransform)!.setContentSize(w, h);
        // 等价于战斗里 sol.y = floorY + targetH/2，脚点（身体底）落在地面线
        spriteNode.setPosition(req.x + box.offsetX, req.floorY + targetH / 2 + box.offsetY, 0);
        anim.setClip(clip.frames, clip.fps, clip.loop, clip.pingpong, clip.blend);
        this._drawActionPreviewGuide(req, w, h);
        if (this._actionPreviewLabel) {
            this._actionPreviewLabel.string = `${req.key}  ${clip.frames.length}帧 · ${clip.fps}fps`;
            this._actionPreviewLabel.node.setPosition(req.x, req.floorY + h + 34, 0);
        }
    }

    private _hideActionPreview() {
        if (this._actionPreviewRoot) this._actionPreviewRoot.active = false;
    }

    private _showActionPreviewMessage(text: string) {
        this._ensureActionPreviewRoot();
        if (this._actionPreviewRoot) this._actionPreviewRoot.active = true;
        if (this._actionPreviewGfx) this._actionPreviewGfx.clear();
        if (this._actionPreviewNode) this._actionPreviewNode.active = false;
        if (this._actionPreviewLabel) {
            this._actionPreviewLabel.string = text;
            this._actionPreviewLabel.node.setPosition(0, 0, 0);
        }
    }

    private _drawActionPreviewGuide(req: ActionPreviewRequest, w: number, h: number) {
        const g = this._actionPreviewGfx;
        if (!g) return;
        g.clear();
        const pad = 24;
        g.fillColor = new Color(0, 0, 0, 118);
        g.roundRect(req.x - w / 2 - pad, req.floorY - 24, w + pad * 2, h + 78, 12);
        g.fill();
        g.strokeColor = new Color(255, 238, 180, 190);
        g.lineWidth = 3;
        g.moveTo(req.x - w / 2 - 18, req.floorY);
        g.lineTo(req.x + w / 2 + 18, req.floorY);
        g.stroke();
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
        if (this._actionPreviewDestroy) {
            this._actionPreviewDestroy();
            this._actionPreviewDestroy = null;
        }
        this.node.off(Node.EventType.TOUCH_END, this._onTap, this);
        if (this._bootRoot) {
            this._bootRoot.off(Node.EventType.TOUCH_START, this._onBootTouchStart, this);
            this._bootRoot.off(Node.EventType.TOUCH_MOVE, this._onBootTouchMove, this);
            this._bootRoot.off(Node.EventType.TOUCH_END, this._onBootTap, this);
            this._bootRoot.off(Node.EventType.TOUCH_CANCEL, this._onBootTouchCancel, this);
        }
        if (this._settleRoot) {
            this._settleRoot.off(Node.EventType.TOUCH_START, this._onSettlementTouchStart, this);
            this._settleRoot.off(Node.EventType.TOUCH_MOVE, this._onSettlementTouchMove, this);
            this._settleRoot.off(Node.EventType.TOUCH_END, this._onSettlementTap, this);
            this._settleRoot.off(Node.EventType.TOUCH_CANCEL, this._onSettlementTouchCancel, this);
        }
        if (this._chestRoot) {
            this._chestRoot.off(Node.EventType.TOUCH_START, this._onChestTouchStart, this);
            this._chestRoot.off(Node.EventType.TOUCH_MOVE, this._onChestTouchMove, this);
            this._chestRoot.off(Node.EventType.TOUCH_END, this._onChestTap, this);
            this._chestRoot.off(Node.EventType.TOUCH_CANCEL, this._onChestTouchCancel, this);
        }
    }
}
