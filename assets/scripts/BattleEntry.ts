// 战斗入口（BattleEntry）—— 挂到场景节点上的唯一脚本。
// 作为组合根负责生命周期、读档、战斗会话和跨模块编排；具体表现由 ui/ 下的 View/Panel 承担。

import { _decorator, Component, Node, Graphics, Color, UITransform, Label, view, ResolutionPolicy, Sprite, SpriteFrame, EventTouch, Vec3 } from 'cc';
import { BattleManager } from './combat/BattleManager';
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
import { ChestInventoryModel, MAX_CHEST_COUNT } from './chest/ChestModel';
import { loadChests, saveChests } from './chest/ChestPersistence';
import { rollChestDrop } from './chest/ChestDropService';
import { ProgressModel } from './progression/ProgressModel';
import { loadProgress, saveProgress } from './progression/ProgressPersistence';
import { loadPlayerData, savePlayerData, resetPlayerDataCache } from './core/data/PlayerDataStore';
import { Accounts } from './core/data/DataService';
import { SquadModel } from './squad/SquadModel';
import { loadSquad, saveSquad } from './squad/SquadPersistence';
import { CharacterGrowthModel } from './growth/CharacterGrowthModel';
import { loadGrowth, saveGrowth } from './growth/CharacterGrowthPersistence';
import { QUALITY_LABEL, CHARACTERS, CharacterId, EquipSlot, SLOTS } from './inventory/EquipDefs';
import type { EquipItem } from './inventory/EquipDefs';
import type { MaterialItem, MaterialSave } from './services/RewardTypes';
import { talentAggregate, emptyTalentAggregate, type TalentAggregate } from './talent/TalentStats';
import type { TalentSave } from './talent/TalentModel';
import { firstClearPages } from './talent/TalentConfig';
import { sanitizeCharTalents, type CharTalentSave } from './chartalent/CharTalentModel';
import { charTalentAggregate } from './chartalent/CharTalentStats';
import type { PassiveDef } from './config/SkillConfig';
import type { EquipStats } from './inventory/EquipDefs';
import { SettlementPanel } from './ui/panels/SettlementPanel';
import { SquadPanel } from './ui/panels/SquadPanel';
import { CharTalentPanel } from './ui/panels/CharTalentPanel';
import { InlayPanel } from './ui/panels/InlayPanel';
import { TalentPanel } from './ui/panels/TalentPanel';
import { CraftPanel } from './ui/panels/CraftPanel';
import { ChestPanel } from './ui/panels/ChestPanel';
import { AccountPanel } from './ui/panels/AccountPanel';
import { BootView, BOOT_LOADING_UI_KEYS, BOOT_UI_KEYS } from './ui/BootView';
import { BattleStageView, frameClipVisualBox } from './ui/BattleStageView';
import type { MainUiSnapshot } from './ui/MainScreenView';
import type { RewardEntry } from './ui/UiTypes';
import { expToNext } from './growth/CharGrowthConfig';

const { ccclass } = _decorator;

const UI_REF_W = 941;
const UI_REF_H = 1672;

@ccclass('BattleEntry')
export class BattleEntry extends Component {
    private _mgr: BattleManager = null!;
    private _art: ArtRegistry<SpriteFrame> = null!;
    private _inv: InventoryModel = null!;
    private _invView: InventoryView = null!;
    private _chests: ChestInventoryModel = null!;
    private _progress: ProgressModel = null!;
    private _squad: SquadModel = null!;
    private _growth: CharacterGrowthModel = null!;
    private _settlementPanel: SettlementPanel = null!;
    private _squadPanel: SquadPanel = null!;
    private _inlayPanel: InlayPanel = null!;
    private _talentPanel: TalentPanel = null!;
    private _charTalentPanel: CharTalentPanel = null!;
    private _craftPanel: CraftPanel = null!;
    private _chestPanel: ChestPanel = null!;
    private _accountPanel: AccountPanel = null!;
    private _bootView: BootView = null!;
    private _stageView: BattleStageView = null!;
    private _winRewardText = '';
    private _halfW = 0;
    private _halfH = 0;
    private _gameStarted = false;
    private _materials: MaterialSave = {};
    private _gold = 0;
    private _talents: TalentSave = {};
    private _talentAgg: TalentAggregate = emptyTalentAggregate();
    private _charTalents: CharTalentSave = {};
    private _autoSellOn = false;
    private _offlineNoticeText = '';
    private _offlineNoticeTtl = 0;
    private _battleSeed = '';
    private _battleChestDropCount = 0;
    private _battleExpGained = 0;
    private _actionPreviewRoot: Node | null = null;
    private _actionPreviewGfx: Graphics | null = null;
    private _actionPreviewNode: Node | null = null;
    private _actionPreviewBlendNode: Node | null = null;
    private _actionPreviewAnim: FrameAnimPlayer | null = null;
    private _actionPreviewLabel: Label | null = null;
    private _actionPreviewDestroy: (() => void) | null = null;


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
        const styleScale = Math.min(vs.width / UI_REF_W, vs.height / UI_REF_H);

        // 让本节点铺满全屏，方便接收点击（重开用）
        const ut = this.getComponent(UITransform) || this.addComponent(UITransform);
        ut.setContentSize(vs.width, vs.height);
        this._art = createArtRegistry();
        this._bootView = new BootView({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            styleScale,
            art: this._art,
            currentAccount: () => Accounts.currentAccount(),
            notice: () => this._offlineNoticeText,
            onAccount: () => this._accountPanel.open(),
            onStart: () => this._enterGame(),
        });

        this._stageView = new BattleStageView({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            styleScale,
            art: this._art,
            getMainUiData: (character) => this._mainUiData(character),
            onHeroes: () => this._squadPanel.toggle(),
            onInventory: () => this._invView.toggle(),
            onCraft: () => this._craftPanel.toggle(),
            onChests: () => this._chestPanel.toggle(),
            onTalent: () => { void this._refreshTalentCache().then(() => this._talentPanel.toggle()); },
            onCharTalent: () => this._charTalentPanel.toggle(),
        });

        // 点击重开
        this.node.on(Node.EventType.TOUCH_END, this._onTap, this);

        // —— 装备背包：存储/UI 独立，穿脱时通过 effective-stats 刷新战斗属性 ——
        this._inv = new InventoryModel();
        this._chests = new ChestInventoryModel();
        this._progress = new ProgressModel(BattleConfig.levels.length, BattleConfig.startLevel);
        this._invView = new InventoryView(this.node, this._halfW, this._halfH, this._inv, (kind, payload) => {
            void this._handleInventoryChanged(kind, payload);
        }, () => this._configuredDebugDrop(),
        // 穿戴等级校验：需求=装备等级；_growth 尚未载入时不拦（读档后即正常生效）
        (c) => this._growth ? this._growth.levelOf(c) : Infinity);
        const dataReady = this._loadAllPlayerData();
        this._accountPanel = new AccountPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            currentAccount: () => Accounts.currentAccount(),
            listAccounts: () => Accounts.listAccounts(),
            switchAccount: async (id) => {
                Accounts.setCurrentAccount(id);
                resetPlayerDataCache();
                this._offlineNoticeText = '';
                this._offlineNoticeTtl = 0;
                await this._loadAllPlayerData();
            },
            onSwitched: () => this._bootView.showReady(),
        });
        this._settlementPanel = new SettlementPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            beforeShow: () => {
                if (this._invView.isOpen()) this._invView.toggle();
                this._squadPanel.hide();
                this._chestPanel.hide();
                this._craftPanel.hide();
            },
            levelName: () => this._mgr?.levelName ?? '',
            onOpenBag: () => {
                if (!this._invView.isOpen()) this._invView.toggle();
            },
            onNext: (complete) => {
                if (!this._progress.selectNextAfter(complete.completedLevel)) return;
                void saveProgress(this._progress);
                this._startBattle();
            },
            onRetry: (complete) => {
                this._progress.selectLevel(complete.completedLevel);
                void saveProgress(this._progress);
                this._startBattle();
            },
        });
        this._chestPanel = new ChestPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            getChests: () => this._chests,
            availableEquipmentSlots: () => this._availableEquipmentSlots(),
            addEquipment: (items) => this._addRewardEquipments(items),
            commitOpen: async (chest, materials) => {
                const data = await loadPlayerData();
                data.materials = data.materials ?? {};
                for (const material of materials) {
                    data.materials[material.id] = (data.materials[material.id] ?? 0) + material.count;
                }
                this._materials = { ...data.materials };
                this._chests.removeChest(chest.id);
                await saveInventory(this._inv);
                await saveChests(this._chests);
                await savePlayerData();
                this._invView.refresh();
            },
            onNotice: (message) => {
                this._offlineNoticeText = message;
                this._offlineNoticeTtl = 8;
            },
            beforeShow: () => {
                this._settlementPanel.hide();
                this._craftPanel.hide();
            },
            qualityBonus: () => this._talentAgg.drop.equipQuality,
        });
        this._craftPanel = new CraftPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            getMaterials: () => this._materials,
            availableEquipmentSlots: () => this._availableEquipmentSlots(),
            addEquipment: (items) => this._addRewardEquipments(items),
            persist: async (remainingMaterials) => {
                const data = await loadPlayerData();
                data.materials = remainingMaterials;
                data.inventory = this._inv.serialize();
                this._materials = { ...remainingMaterials };
                await savePlayerData();
                this._invView.refresh();
            },
            beforeShow: () => {
                this._settlementPanel.hide();
                this._chestPanel.hide();
            },
        });
        this._squadPanel = new SquadPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            getSquad: () => this._squad,
            getGrowth: () => this._growth,
            beforeShow: () => {
                this._settlementPanel.hide();
                this._chestPanel.hide();
                this._craftPanel.hide();
            },
            onChanged: () => {
                void saveSquad(this._squad);
                if (this._gameStarted && !this._settlementPanel.isOpen()) this._startBattle();
            },
            onCharTalent: (cls) => this._charTalentPanel.show(cls),
        });
        this._inlayPanel = new InlayPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            getInventory: () => this._inv,
            getMaterials: () => this._materials,
            beforeOpen: () => {
                this._settlementPanel.hide();
                this._chestPanel.hide();
                this._craftPanel.hide();
                this._squadPanel.hide();
            },
            persist: async () => {
                const data = await loadPlayerData();
                data.materials = { ...this._materials };
                data.inventory = this._inv.serialize();
                await savePlayerData();
                this._invView.refresh();
            },
        });
        this._talentPanel = new TalentPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            getTalents: () => this._talents,
            getMaterials: () => this._materials,
            getGold: () => this._gold,
            getAutoSellOn: () => this._autoSellOn,
            setAutoSellOn: (on) => { void this._persistAutoSell(on); },
            beforeShow: () => {
                this._settlementPanel.hide();
                this._chestPanel.hide();
                this._craftPanel.hide();
                this._squadPanel.hide();
            },
            persist: (spentGold) => { void this._persistTalents(spentGold); },
        });
        this._charTalentPanel = new CharTalentPanel({
            host: this.node,
            halfW: this._halfW,
            halfH: this._halfH,
            getSave: () => this._charTalents,
            getGrowth: () => this._growth,
            beforeShow: () => {
                this._settlementPanel.hide();
                this._chestPanel.hide();
                this._craftPanel.hide();
                this._squadPanel.hide();
                this._talentPanel.hide();
            },
            persist: () => { void this._persistCharTalents(); },
        });

        // 挂载游戏内实时调参面板（仅网页预览生效；点「重开战斗」重置局内数值）
        mountConfigPanel(() => this._startBattle());
        this._actionPreviewDestroy = mountActionPreviewPanel(
            (req) => { void this._showActionPreview(req); },
            () => this._hideActionPreview(),
        );

        const loadingArtReady = this._loadBootLoadingArt();
        const artReady = loadingArtReady.then(() => this._loadBattleArt());
        void Promise.all([artReady, dataReady]).then(() => {
            this._bootView.showReady();
        }).catch(() => {
            this._bootView.showReady();
        });
        this._bootView.bringToTop();
    }

    // 完整读档链：冷启动与切账号共用。所有 Model 原位重灌（deserialize/重赋值），
    // 视图持有的引用不失效。
    private _loadAllPlayerData(): Promise<void> {
        return loadInventory(this._inv)
            .then(() => loadProgress(this._progress))
            .then(() => this._claimOfflineRewards())
            .then(() => this._refreshTalentCache())
            .then(() => loadChests(this._chests))
            .then(() => this._refreshMaterialsCache())
            .then(() => loadSquad(this._talentAgg.unlocks.squadSlot3 ? 1 : 0))
            .then((squad) => { this._squad = squad; })
            .then(() => loadGrowth())
            .then((growth) => { this._growth = growth; })
            .then(() => this._refreshCharTalentCache())
            .then(() => { this._invView.refresh(); })
            .catch(() => {
                // 读档失败时仍允许进游戏，掉落会从空背包开始存。
            });
    }

    private _startBattle() {
        if (!this._gameStarted) return;
        this._settlementPanel.hide();
        this._chestPanel.hide();
        this._craftPanel.hide();
        const levels: Partial<Record<SoldierClass, number>> = {};
        if (this._growth) {
            for (const c of CHARACTERS) levels[c] = this._growth.levelOf(c);
        }
        const talentInj = this._charTalentInjection();
        const effective = this._inv
            ? buildEffectiveStatsMap(this._inv.equipped, levels, this._talentAgg.stats, talentInj.perClassStats)
            : buildEffectiveStatsMap(undefined, levels, this._talentAgg.stats, talentInj.perClassStats);
        const levelIndex = this._progress ? this._progress.currentLevel : BattleConfig.startLevel;
        const roster = this._squad ? (this._squad.deployedList() as SoldierClass[]) : BattleConfig.roster;
        this._battleSeed = `${Date.now()}|${Math.random()}|${levelIndex}`;
        this._battleChestDropCount = 0;
        this._battleExpGained = 0;
        this._mgr = new BattleManager(this._halfW, this._halfH, levelIndex, effective, roster, talentInj.extraPassives);
        this._winRewardText = '';
        this._stageView.beginBattle(roster);
    }

    private async _handleInventoryChanged(kind: InventoryChangeKind, payload?: InventoryChangePayload): Promise<void> {
        if (kind === 'inlay') {
            if (payload?.itemId) this._inlayPanel.open(payload.itemId);
            return;
        }
        const data = await loadPlayerData();
        if (payload?.gold && payload.gold > 0) data.gold = (data.gold ?? 0) + payload.gold;
        this._gold = data.gold ?? 0;
        // 出售返还材料（宝石退回+打造石返还，2026-07-11 改名 returnedMaterials）经此落到 materials
        const returned = (payload as any)?.returnedMaterials as { id: string; count: number }[] | undefined;
        if (returned && returned.length) {
            data.materials = data.materials ?? {};
            for (const g of returned) data.materials[g.id] = (data.materials[g.id] ?? 0) + g.count;
            this._materials = { ...data.materials };
        }
        data.inventory = this._inv.serialize();
        await savePlayerData();

        if (this._gameStarted && (kind === 'equip' || kind === 'unequip') && !this._settlementPanel.isOpen()) {
            this._startBattle(); // 穿脱后立即刷新战斗属性；结算页打开时先不打断结算
        }
    }

    private async _loadBattleArt(): Promise<void> {
        const initialRoster = this._squad ? (this._squad.deployedList() as SoldierClass[]) : BattleConfig.roster;
        await this._stageView.loadArt(initialRoster, [...BOOT_LOADING_UI_KEYS, ...BOOT_UI_KEYS]);
    }

    private async _loadBootLoadingArt(): Promise<void> {
        await this._art.preload(BOOT_LOADING_UI_KEYS);
        if (this._bootView.isLoading()) this._bootView.showLoading();
    }

    private _enterGame() {
        if (this._gameStarted) return;
        this._gameStarted = true;
        this._stageView.setActive(true);
        this._invView.refresh();
        this._startBattle();
    }

    private _onTap() {
        if (!this._mgr) return;
        if (this._invView && this._invView.isOpen()) return;  // 面板打开时，点击交给面板，不重开战斗
        if (this._settlementPanel.isOpen()) return;           // 结算页打开时，用结算页按钮处理
        if (this._chestPanel.isOpen()) return;                // 宝箱页打开时，用宝箱页按钮处理
        // 仅在分出胜负后，点击重开
        if (this._mgr.phase === 'won' || this._mgr.phase === 'lost') {
            this._startBattle();
        }
    }

    private async _refreshMaterialsCache(): Promise<void> {
        const data = await loadPlayerData();
        this._materials = { ...(data.materials ?? {}) };
    }

    // 心法缓存：已点档/聚合值/金币/自动卖开关；宝箱容量按解锁扩容（须在 loadChests 之前跑）
    private async _refreshTalentCache(): Promise<void> {
        const data = await loadPlayerData();
        this._talents = { ...(data.talents ?? {}) };
        this._talentAgg = talentAggregate(this._talents);
        this._gold = data.gold ?? 0;
        this._autoSellOn = !!data.autoSellLowQuality;
        this._chests.maxChests = MAX_CHEST_COUNT + this._talentAgg.unlocks.chestCapacity;
    }

    // 点节点后落盘：金币按 delta 扣（防与卖装/离线并发覆盖）；聚合值重算并即时应用容量/上阵位
    private async _persistTalents(spentGold: number): Promise<void> {
        const data = await loadPlayerData();
        data.gold = Math.max(0, (data.gold ?? 0) - spentGold);
        this._gold = data.gold;
        data.talents = { ...this._talents };
        data.materials = { ...this._materials };
        const hadSquad3 = this._talentAgg.unlocks.squadSlot3;
        this._talentAgg = talentAggregate(this._talents);
        this._chests.maxChests = MAX_CHEST_COUNT + this._talentAgg.unlocks.chestCapacity;
        await savePlayerData();
        if (!hadSquad3 && this._talentAgg.unlocks.squadSlot3) {
            this._squad = await loadSquad(1);   // 第 3 位解锁：按新 cap 重灌小队（保留已上阵）
        }
    }

    // 角色天赋缓存：读档 + 自愈（未知节点丢弃/级数钳制/超发按配置序截断）。须在 loadGrowth 之后跑。
    private async _refreshCharTalentCache(): Promise<void> {
        const data = await loadPlayerData();
        this._charTalents = sanitizeCharTalents(data.charTalents, (cls) => this._growth?.levelOf(cls as SoldierClass) ?? 1);
    }

    // 投点/洗点后落盘：面板经 CharTalentModel 就地改 _charTalents，这里整体深拷贝写档
    private async _persistCharTalents(): Promise<void> {
        const data = await loadPlayerData();
        const copy: CharTalentSave = {};
        for (const cls of Object.keys(this._charTalents)) copy[cls] = { ...this._charTalents[cls] };
        data.charTalents = copy;
        await savePlayerData();
    }

    // 开战/面板注入值：每职业聚合一次（属性 → perClassStats；被动 → extraPassives）
    private _charTalentInjection(): { perClassStats: Partial<Record<SoldierClass, EquipStats>>; extraPassives: Partial<Record<SoldierClass, PassiveDef[]>> } {
        const perClassStats: Partial<Record<SoldierClass, EquipStats>> = {};
        const extraPassives: Partial<Record<SoldierClass, PassiveDef[]>> = {};
        for (const c of CHARACTERS) {
            const agg = charTalentAggregate(this._charTalents, c);
            if (Object.keys(agg.stats).length > 0) perClassStats[c as SoldierClass] = agg.stats;
            if (agg.passives.length > 0) extraPassives[c as SoldierClass] = agg.passives;
        }
        return { perClassStats, extraPassives };
    }

    private async _persistAutoSell(on: boolean): Promise<void> {
        const data = await loadPlayerData();
        data.autoSellLowQuality = on;
        this._autoSellOn = on;
        await savePlayerData();
    }

    // 关卡首通发放秘笈残页（心法大节点材料）
    private async _grantTalentPages(count: number): Promise<void> {
        const data = await loadPlayerData();
        data.materials = data.materials ?? {};
        data.materials['talent_page'] = (data.materials['talent_page'] ?? 0) + count;
        this._materials = { ...data.materials };
        await savePlayerData();
    }

    update(dt: number) {
        this._actionPreviewAnim?.update(Math.min(dt, 0.05));
        if (!this._mgr) return;
        if (this._offlineNoticeTtl > 0) this._offlineNoticeTtl = Math.max(0, this._offlineNoticeTtl - dt);
        // dt 兜底，防止切后台回来一帧巨大导致瞬移
        const phaseBefore = this._mgr.phase;
        this._mgr.tick(Math.min(dt, 0.05));
        this._processBattleEvents();
        if (phaseBefore !== 'won' && this._mgr.phase === 'won') this._awardVictoryDrop();
        if (phaseBefore !== 'lost' && this._mgr.phase === 'lost') this._commitBattleExp();
        this._stageView.render(
            this._mgr,
            Math.min(dt, 0.05),
            this._offlineNoticeText,
            this._offlineNoticeTtl,
            this._winRewardText,
        );
        this._invView.update(dt);
    }

    // 战斗结束（胜或负）都提交本场累计经验：每个上阵角色各得全额（心法经济支放大）。
    private _commitBattleExp() {
        if (!this._growth || !this._squad || this._battleExpGained <= 0) return;
        const exp = Math.round(this._battleExpGained * (1 + this._talentAgg.econ.exp));
        for (const cls of this._squad.deployedList()) {
            this._growth.gainExp(cls, exp);
        }
        void saveGrowth(this._growth);
        this._battleExpGained = 0;
    }

    private _awardVictoryDrop() {
        this._commitBattleExp();
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
        if (complete.firstClear) {
            const pages = firstClearPages(complete.completedLevel);
            if (pages > 0) {
                void this._grantTalentPages(pages);
                this._winRewardText += `；秘笈残页 +${pages}`;
            }
        }
        this._settlementPanel.show(result.received, result.failed, complete);
    }

    // 统一消费战斗事件：技能表现交给 StageView，击杀事件结算经验和宝箱。
    private _processBattleEvents() {
        if (!this._mgr || !this._chests) return;
        if (this._mgr.eventCount <= 0) return;
        const events = this._mgr.drainEvents();

        const createdAt = Date.now();
        let gained = 0;
        for (const event of events) {
            if (event.type === 'skillCast') {
                this._stageView.onSkillCast(this._mgr, event);
                continue;
            }
            if (event.type !== 'enemyKilled') continue;   // buffChanged 等表现级事件：色块占位阶段暂不消费
            const enemyDef = BattleConfig.enemyTypes[event.enemyType];
            if (enemyDef) this._battleExpGained += enemyDef.exp;
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
        this._chestPanel.refresh();
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
            qualityBonus: this._talentAgg.drop.equipQuality,
        });
        return this._addRewardEquipments(reward.equipments);
    }

    private _availableEquipmentSlots(): number {
        if (!this._inv) return 0;
        return Math.max(0, this._inv.maxBackpack - this._inv.backpack.length)
            + Math.max(0, this._inv.maxWarehouse - this._inv.warehouse.length);
    }

    private _mainUiData(character: CharacterId): MainUiSnapshot {
        const levels: Partial<Record<SoldierClass, number>> = {};
        for (const id of CHARACTERS) levels[id] = this._growth?.levelOf(id) ?? 1;
        const effective = buildEffectiveStatsMap(this._inv?.equipped, levels, this._talentAgg.stats, this._charTalentInjection().perClassStats);
        const stats = effective[character] ?? BattleConfig.stats[character];
        const level = this._growth?.levelOf(character) ?? 1;
        const exp = this._growth?.expOf(character) ?? 0;
        const dps = Math.max(1, stats.atk * stats.attackSpeed);
        const ehp = Math.max(1, stats.hp * (1 + stats.def / 100));
        const power = Math.max(1, Math.round(Math.sqrt(dps * ehp)));
        let gems = 0;
        for (const key of Object.keys(this._materials)) {
            if (key.startsWith('gem_')) gems += this._materials[key as keyof MaterialSave] ?? 0;
        }
        const equipment: Partial<Record<EquipSlot, string>> = {};
        const equipped = this._inv?.equipped[character];
        for (const slot of SLOTS) {
            const item = equipped?.[slot];
            if (item) equipment[slot] = `Lv.${item.level ?? 1} ${item.name}`;
        }
        return {
            gold: this._gold,
            gems,
            power,
            level,
            exp,
            expNext: expToNext(level),
            stats,
            equipment,
        };
    }

    private _addRewardEquipments(drops: EquipItem[]): { received: RewardEntry[]; failed: number } {
        const received: RewardEntry[] = [];
        let failed = 0;
        let autoSold = 0, autoGold = 0;
        const autoMaterials: MaterialItem[] = [];
        const autoSell = this._talentAgg.unlocks.autoSell && this._autoSellOn;

        for (const item of drops) {
            let r = this._inv.addItemToBackpack(item);
            let target = '背包';
            if (!r.ok && r.reason === '背包已满') {
                r = this._inv.addItemToWarehouse(item);
                target = '仓库';
            }
            if (r.ok && r.item) {
                // 心法「拂尘」：白/绿装入包即时出售（含返石），不进奖励列表
                if (autoSell && (r.item.quality === 'common' || r.item.quality === 'fine') && !r.item.locked) {
                    const s = this._inv.sellItem(r.item.id);
                    if (s.ok) {
                        autoSold++;
                        autoGold += s.gold ?? 0;
                        if (s.returnedMaterials) autoMaterials.push(...s.returnedMaterials);
                        continue;
                    }
                }
                received.push({ item: r.item, target });
            } else {
                failed++;
            }
        }
        if (autoSold > 0) {
            void this._commitAutoSell(autoGold, autoMaterials);
            this._offlineNoticeText = `自动出售 ${autoSold} 件白/绿装 +${autoGold} 金币`;
            this._offlineNoticeTtl = 5;
        }
        return { received, failed };
    }

    private async _commitAutoSell(gold: number, materials: MaterialItem[]): Promise<void> {
        const data = await loadPlayerData();
        data.gold = (data.gold ?? 0) + gold;
        this._gold = data.gold;
        data.materials = data.materials ?? {};
        for (const m of materials) data.materials[m.id] = (data.materials[m.id] ?? 0) + m.count;
        this._materials = { ...data.materials };
        data.inventory = this._inv.serialize();
        await savePlayerData();
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
        const box = frameClipVisualBox(targetH, clip);
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

    onDestroy() {
        if (this._actionPreviewDestroy) {
            this._actionPreviewDestroy();
            this._actionPreviewDestroy = null;
        }
        this.node.off(Node.EventType.TOUCH_END, this._onTap, this);
        this._bootView?.destroy();
        this._settlementPanel?.destroy();
        this._squadPanel?.destroy();
        this._inlayPanel?.destroy();
        this._talentPanel?.destroy();
        this._charTalentPanel?.destroy();
        this._craftPanel?.destroy();
        this._chestPanel?.destroy();
        this._accountPanel?.destroy();
    }
}
