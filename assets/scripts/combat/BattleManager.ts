// 战斗管理器（BattleManager）—— 战斗核心逻辑，纯数据、不碰渲染
// 职责：布阵（前排坦克/后排输出治疗）、按波次刷怪、自动开火、子弹命中、
//      敌人推进到防线后贴身缠斗、治疗奶血、胜负判定。
// 只算数据，怎么画交给 BattleEntry。

import { BattleConfig, SoldierClass, CombatStats } from '../config/BattleConfig';
import { DamageResult } from './CombatFormula';
import type { EffectiveStatsMap } from './EffectiveStats';
import { CombatUnit, createSoldierUnit, createEnemyUnit, recomputeDerived, UnitAction, UnitSide } from './CombatUnit';
import { applyEffect, EffectHooks } from './Effects';
import { tickBuffs, BuffInstance } from './BuffSystem';
import { getBuffDef, BuffDef } from '../config/BuffConfig';
import type { Effect } from '../config/EffectTypes';

// 统一单位模型定义迁到 CombatUnit.ts；这里 re-export 保住既有消费端 import 路径。
export type { UnitAction, UnitSide, CombatUnit } from './CombatUnit';

const ATTACK_ACTION_HOLD = 0.32;
const DEATH_ACTION_HOLD = 0.9;

// 普攻用的常量效果（模块级复用，热路径零分配）
const DMG1: Effect = { kind: 'damage', mult: 1 };

// 一颗子弹（携带开火者的属性引用，命中时结算）
export interface Bullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    stats: CombatStats;   // 开火者的攻击属性
    alive: boolean;
}

// 战斗飘字（伤害数字 / 暴击 / 格挡 / 闪避），纯展示
export interface FloatText {
    x: number;
    y: number;
    vy: number;
    ttl: number;
    maxTtl: number;
    text: string;
    kind: 'normal' | 'crit' | 'block' | 'dodge' | 'skill' | 'heal';
}

// 治疗光束（仅供界面画反馈，逻辑不依赖）
export interface HealBeam {
    fromX: number; fromY: number;
    toX: number; toY: number;
}

export type BattlePhase = 'spawning' | 'gap' | 'won' | 'lost';

export interface EnemyKilledEvent {
    type: 'enemyKilled';
    levelIndex: number;
    waveIndex: number;
    enemyType: string;
    killIndex: number;
    isStageFinalKill: boolean;
}

export interface SkillCastEvent {
    type: 'skillCast';
    skillId: string;
    skillName: string;
    casterCls: SoldierClass;
    hits: { damage: number; crit: boolean; dodged: boolean }[];
}

// Buff 增删事件（applied=true 施加/叠层，false 到期/被驱散）；渲染层画图标/变色用
export interface BuffChangedEvent {
    type: 'buffChanged';
    targetSide: UnitSide;
    targetKey: string;
    buffId: string;      // 驱散时为驱散标签
    applied: boolean;
    stacks: number;
}

export type BattleEvent = EnemyKilledEvent | SkillCastEvent | BuffChangedEvent;

export class BattleManager {
    private halfW = 0;
    private halfH = 0;

    soldiers: CombatUnit[] = [];
    enemies: CombatUnit[] = [];
    bullets: Bullet[] = [];
    private _unitSeq = 0;
    // 光束数组做对象池复用：只有前 count 条有效，渲染层按 count 遍历（避免每帧新建数组/对象）
    healBeams: HealBeam[] = [];
    healBeamCount = 0;
    meleeBeams: HealBeam[] = [];   // 近战正在劈的连线（仅供界面画反馈）
    meleeBeamCount = 0;
    floatTexts: FloatText[] = [];  // 战斗飘字
    private events: BattleEvent[] = [];
    private killIndex = 0;

    phase: BattlePhase = 'spawning';
    levelIndex = 0;
    waveIndex = 0;
    private gapTimer = 0;
    private effectiveStats: EffectiveStatsMap;
    private _roster: SoldierClass[];

    // Effect 管线回调（构造时建一次，不每帧建闭包）
    private _effectHooks: EffectHooks = {
        spawnFloat: (x, y, r, kind) => this._spawnFloat(x, y, r, kind),
        markDead: (u) => this._markDead(u),
        onBuffChanged: (target, buffId, applied, stacks) => {
            this.events.push({ type: 'buffChanged', targetSide: target.side, targetKey: target.key, buffId, applied, stacks });
        },
    };

    // Buff 周期/到期回调的当前单位上下文（避免每单位每帧新建闭包）
    private _buffUnit: CombatUnit | null = null;
    private _onBuffPeriodic = (def: BuffDef, inst: BuffInstance) => {
        const u = this._buffUnit!;
        if (!u.alive || !def.periodicEffect) return;
        const eff = def.periodicEffect;
        // DoT/HoT 语义：按施加时的 srcAtk 快照 × 层数直接结算，不走 calcDamage（无闪避暴击，可预期）
        if (eff.kind === 'damage') {
            const dmg = Math.max(1, Math.round(inst.srcAtk * eff.mult * inst.stacks));
            u.hp -= dmg;
            this._spawnFloat(u.x, u.y, { damage: dmg, crit: false, blocked: false, dodged: false }, 'skill');
            if (u.hp <= 0) this._markDead(u);
        } else if (eff.kind === 'heal') {
            const amount = Math.max(1, Math.round(inst.srcAtk * eff.mult * inst.stacks));
            u.hp = Math.min(u.maxHp, u.hp + amount);
            this._spawnFloat(u.x, u.y, { damage: amount, crit: false, blocked: false, dodged: false }, 'heal');
        } else if (eff.kind === 'applyBuff') {
            applyEffect(u, u, eff, this._effectHooks);
        }
    };
    private _onBuffExpired = (def: BuffDef) => {
        const u = this._buffUnit!;
        this.events.push({ type: 'buffChanged', targetSide: u.side, targetKey: u.key, buffId: def.id, applied: false, stacks: 0 });
    };
    // 当前波每个刷怪组的运行时状态
    private _groups: { type: string; count: number; interval: number; hp?: number; spawned: number; timer: number }[] = [];

    constructor(halfW: number, halfH: number, levelIndex = BattleConfig.startLevel, effectiveStats: EffectiveStatsMap = {}, roster: SoldierClass[] = BattleConfig.roster) {
        this.halfW = halfW;
        this.halfH = halfH;
        this.effectiveStats = effectiveStats;
        this._roster = roster;
        this.levelIndex = Math.max(0, Math.min(levelIndex, BattleConfig.levels.length - 1));
        this._setupSquad();
        this._startWave(0);
    }

    get level() { return BattleConfig.levels[this.levelIndex]; }
    get levelName(): string { return this.level.name; }
    get totalWaves(): number { return this.level.waves.length; }
    get eventCount(): number { return this.events.length; }

    drainEvents(): BattleEvent[] {
        const out = this.events;
        this.events = [];
        return out;
    }

    // —— 布阵（单排一字阵）：全员同一条横线 y=0，按 roster 顺序从前到后沿 x 排开 ——
    private _setupSquad() {
        const L = BattleConfig.layout;
        const frontX = -this.halfW + L.frontMargin;
        this._roster.forEach((cls, i) => {
            const st = this.effectiveStats[cls] ?? BattleConfig.stats[cls]; // 职业战斗属性（统一表）
            const hx = frontX - i * L.spacing;   // 越靠后（i 越大）越靠左
            this.soldiers.push(createSoldierUnit(this._unitSeq++, cls, st, hx, 0));
        });
    }

    private _hasAliveSoldier(): boolean {
        for (const s of this.soldiers) if (s.alive) return true;
        return false;
    }

    // 复用 list[count] 上的旧对象写入一条光束，返回新的 count
    private _pushBeam(list: HealBeam[], count: number, fromX: number, fromY: number, toX: number, toY: number): number {
        let b = list[count];
        if (!b) { b = { fromX: 0, fromY: 0, toX: 0, toY: 0 }; list[count] = b; }
        b.fromX = fromX; b.fromY = fromY; b.toX = toX; b.toY = toY;
        return count + 1;
    }

    // 防线 = 最前面还活着单位的【原始站位】（用 homeX，不随近战冲出去而漂移）
    private get defenseLineX(): number {
        let x = -Infinity;
        for (const s of this.soldiers) if (s.alive && s.homeX > x) x = s.homeX;
        return x;
    }

    tick(dt: number) {
        if (this.phase === 'won' || this.phase === 'lost') return;
        this._updateActionClocks(dt);
        this._updateBuffs(dt);
        this._updateSpawning(dt);
        this._updateMovement(dt);
        this._updateFiring(dt);
        this._updateSkills(dt);
        this._updateBullets(dt);
        this._updateEnemies(dt);
        this._updateHealing(dt);
        this._updateFloats(dt);
        this._cleanupDeadEnemies();
        this._checkWinLose();
    }

    // 进入第 index 波：把该波的刷怪组展开成运行时状态
    private _startWave(index: number) {
        this.waveIndex = index;
        const wave = this.level.waves[index];
        this._groups = wave.spawns.map(s => ({
            type: s.type, count: s.count, interval: s.interval, hp: s.hp,
            spawned: 0, timer: 0,
        }));
        this.phase = 'spawning';
    }

    // 本波是否已全部刷完
    private get _waveFullySpawned(): boolean {
        return this._groups.every(g => g.spawned >= g.count);
    }

    // —— 刷怪 ——
    private _updateSpawning(dt: number) {
        if (this.phase === 'gap') {
            this.gapTimer -= dt;
            if (this.gapTimer <= 0) this._startWave(this.waveIndex + 1);
            return;
        }
        // spawning：各刷怪组各自按间隔出怪
        for (const g of this._groups) {
            if (g.spawned >= g.count) continue;
            g.timer -= dt;
            if (g.timer <= 0) {
                g.timer = g.interval;
                this._spawnEnemyOfType(g.type, g.hp);
                g.spawned++;
            }
        }
    }

    private _spawnEnemyOfType(type: string, hpOverride?: number) {
        const u = createEnemyUnit(this._unitSeq++, type, hpOverride, this.halfW, 0);
        if (u) this.enemies.push(u);
    }

    private _updateActionClocks(dt: number) {
        for (const u of this.soldiers) this._tickActionClock(u, dt);
        for (const u of this.enemies) this._tickActionClock(u, dt);
    }

    // —— Buff 帧逻辑：时长/周期/到期；无 buff 单位零开销跳过 ——
    private _updateBuffs(dt: number) {
        this._tickUnitBuffs(this.soldiers, dt);
        this._tickUnitBuffs(this.enemies, dt);
    }

    private _tickUnitBuffs(list: CombatUnit[], dt: number) {
        for (const u of list) {
            if (!u.alive || u.buffs.length === 0) continue;
            this._buffUnit = u;
            const dirty = tickBuffs(u.buffs, dt, getBuffDef, this._onBuffPeriodic, this._onBuffExpired);
            if (dirty) recomputeDerived(u);
        }
        this._buffUnit = null;
    }

    private _tickActionClock(u: CombatUnit, dt: number) {
        u.actionTime += dt;
        if (u.actionLock > 0) u.actionLock = Math.max(0, u.actionLock - dt);
        if (u.alive && u.actionLock <= 0 && u.action !== 'idle') this._setAction(u, 'idle');
    }

    private _setAction(u: CombatUnit, action: UnitAction, lock = 0) {
        if (u.action !== action) {
            u.action = action;
            u.actionTime = 0;
        }
        if (lock > u.actionLock) u.actionLock = lock;
    }

    private _markDead(u: CombatUnit) {
        if (!u.alive) return;
        u.hp = 0;
        u.alive = false;
        this._setAction(u, 'death', DEATH_ACTION_HOLD);
        if (u.side === 'enemy') this._emitEnemyKilled(u);
    }

    private _emitEnemyKilled(e: CombatUnit) {
        const isStageFinalKill = this.waveIndex >= this.level.waves.length - 1
            && this._waveFullySpawned
            && !this.enemies.some(enemy => enemy.alive);
        this.events.push({
            type: 'enemyKilled',
            levelIndex: this.levelIndex,
            waveIndex: this.waveIndex,
            enemyType: e.key,
            killIndex: this.killIndex++,
            isStageFinalKill,
        });
    }

    private _forceIdle(u: CombatUnit) {
        u.action = 'idle';
        u.actionTime = 0;
        u.actionLock = 0;
    }

    private _idleLivingSoldiers() {
        for (const s of this.soldiers) {
            if (s.alive) this._forceIdle(s);
        }
    }

    private _cleanupDeadEnemies() {
        // 原地稳定压缩，不每帧新建数组
        let w = 0;
        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (e.alive || e.actionLock > 0) this.enemies[w++] = e;
        }
        this.enemies.length = w;
    }

    // —— 移动：近战冲向最近的怪贴脸，没怪了退回站位；远程/治疗守在原位 ——
    private _updateMovement(dt: number) {
        for (const s of this.soldiers) {
            if (!s.alive) continue;
            if (!s.gate.canMove) continue;   // 眩晕：钉在原地

            if (s.archetype !== 'melee' || s.moveSpeed <= 0) {
                s.x = s.homeX; s.y = s.homeY;   // 远程/治疗：钉在站位
                continue;
            }

            const target = this._frontmostEnemy();   // 盯最前面那只，守住阵线不追后排
            if (!target) {
                const moved = this._moveToward(s, s.homeX, s.homeY, s.moveSpeed * dt);  // 没怪：退守
                if (moved && s.actionLock <= 0) this._setAction(s, 'run');
                continue;
            }

            const dx = target.x - s.x, dy = target.y - s.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d > s.stats.range) {
                // 冲上去，但停在 range 内
                const step = Math.min(s.moveSpeed * dt, d - s.stats.range * 0.85);
                let nx = s.x + (dx / d) * step;
                const ny = s.y + (dy / d) * step;
                // 前压上限；且硬保险——绝不越过「怪停靠线 − 射程」，保证怪永远在坦克前方
                const lineLimit = this.defenseLineX + BattleConfig.formation.contactGap - s.stats.range;
                const limitX = Math.min(s.homeX + s.advanceLimit, lineLimit);
                if (nx > limitX) nx = limitX;
                s.x = nx; s.y = ny;
                if (step > 0.01 && s.actionLock <= 0) this._setAction(s, 'run');
            }
        }
    }

    private _moveToward(s: CombatUnit, tx: number, ty: number, step: number): boolean {
        const dx = tx - s.x, dy = ty - s.y;
        const d = Math.hypot(dx, dy);
        if (d === 0) return false;
        if (d <= step) { s.x = tx; s.y = ty; return true; }
        s.x += (dx / d) * step; s.y += (dy / d) * step;
        return true;
    }

    // —— 自动攻击：近战贴身劈、远程发子弹（都瞄最近敌人，受 range 限制）；治疗不攻击 ——
    private _updateFiring(dt: number) {
        this.meleeBeamCount = 0;
        for (const s of this.soldiers) {
            if (!s.alive || !s.gate.canAct || s.archetype === 'heal' || s.stats.atk <= 0) continue;

            // 近战盯最前面的怪（守线）；远程打最近的
            const target = s.archetype === 'melee'
                ? this._frontmostEnemy()
                : this._nearestEnemy(s.x, s.y);
            if (!target) continue;

            // 够不够得着
            const dx = target.x - s.x, dy = target.y - s.y;
            const dist = Math.hypot(dx, dy);
            if (dist > s.stats.range) continue;   // 不够近就不打，也不进冷却，靠近即出手

            // 近战：持续画一条「正在劈」的连线
            if (s.archetype === 'melee') {
                this.meleeBeamCount = this._pushBeam(this.meleeBeams, this.meleeBeamCount, s.x, s.y, target.x, target.y);
            }

            s.cd -= dt;
            if (s.cd > 0) continue;
            s.cd = s.attackInterval / Math.max(0.01, s.stats.attackSpeed);  // 攻速缩短间隔
            if (s.skills) s.skills.onBasicAttack();   // 普攻挥出计数（不管命中与否）

            if (s.archetype === 'melee') {
                this._setAction(s, 'attack', ATTACK_ACTION_HOLD);
                applyEffect(s, target, DMG1, this._effectHooks);   // 近战：走完整公式
            } else {
                this._setAction(s, 'attack', ATTACK_ACTION_HOLD);
                this._fireBullet(s, target);    // 远程：发子弹（命中再结算）
            }
        }
    }

    // —— 自动技能：计时/计数就绪且有目标即释放；伤害走唯一公式 × 技能倍率 ——
    private _updateSkills(dt: number) {
        for (const s of this.soldiers) {
            if (!s.alive || !s.skills || !s.gate.canAct) continue;   // 眩晕期间技能进度也暂停
            s.skills.tick(dt);
            const currentTarget = s.archetype === 'melee'
                ? this._frontmostEnemy()
                : this._nearestEnemy(s.x, s.y);
            const casts = s.skills.collectCasts(s.x, s.y, this.enemies, currentTarget);
            for (const cast of casts) {
                const hits: SkillCastEvent['hits'] = [];
                for (const target of cast.targets) {
                    if (!target.alive) continue;
                    hits.push(this._applySkillDamage(s, target, cast.def.dmgMult));
                }
                // 同帧前序技能清场导致目标全灭：本次落空不发事件（触发已重置，属可接受损耗）
                if (hits.length === 0) continue;
                this._setAction(s, 'attack', ATTACK_ACTION_HOLD);
                this.events.push({
                    type: 'skillCast',
                    skillId: cast.def.id,
                    skillName: cast.def.name,
                    casterCls: s.key as SoldierClass,
                    hits,
                });
            }
        }
    }

    // 技能伤害：走 applyEffect（Task 5 会连同效果列表一起消掉这里的每次对象分配）
    private _applySkillDamage(att: CombatUnit, defender: CombatUnit, mult: number): { damage: number; crit: boolean; dodged: boolean } {
        return applyEffect(att, defender, { kind: 'damage', mult }, this._effectHooks, 'skill');
    }

    private _nearestEnemy(x: number, y: number): CombatUnit | null {
        let best: CombatUnit | null = null;
        let bestD = Infinity;
        for (const e of this.enemies) {
            if (!e.alive) continue;
            const dx = e.x - x, dy = e.y - y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    // 最前面（x 最小、最靠左、离小队最近的推进者）的怪
    private _frontmostEnemy(): CombatUnit | null {
        let best: CombatUnit | null = null;
        let bestX = Infinity;
        for (const e of this.enemies) {
            if (!e.alive) continue;
            if (e.x < bestX) { bestX = e.x; best = e; }
        }
        return best;
    }

    private _fireBullet(s: CombatUnit, target: CombatUnit) {
        const speed = BattleConfig.bullet.speed;
        const dx = target.x - s.x, dy = target.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        this.bullets.push({
            x: s.x, y: s.y,
            vx: (dx / len) * speed,
            vy: (dy / len) * speed,
            stats: s.stats,   // 携带开火者攻击属性
            alive: true,
        });
    }

    // —— 子弹飞行 + 命中 ——
    private _updateBullets(dt: number) {
        const br = BattleConfig.bullet.radius;

        for (const b of this.bullets) {
            if (!b.alive) continue;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if (Math.abs(b.x) > this.halfW + 40 || Math.abs(b.y) > this.halfH + 40) {
                b.alive = false;
                continue;
            }
            for (const e of this.enemies) {
                if (!e.alive) continue;
                const hit = br + e.radius;   // 命中半径随怪体型
                const dx = e.x - b.x, dy = e.y - b.y;
                if (dx * dx + dy * dy <= hit * hit) {
                    applyEffect(b, e, DMG1, this._effectHooks);   // 命中：走完整公式（子弹携带开火者 stats）
                    b.alive = false;
                    break;
                }
            }
        }
        // 原地压缩存活子弹，不每帧新建数组
        let w = 0;
        for (let i = 0; i < this.bullets.length; i++) {
            if (this.bullets[i].alive) this.bullets[w++] = this.bullets[i];
        }
        this.bullets.length = w;
    }

    // —— 敌人推进（向左）：无碰撞，全部冲到防线叠在一起，各自一起攻击（群殴） ——
    private _updateEnemies(dt: number) {
        const front = this.defenseLineX + BattleConfig.formation.contactGap;

        for (const e of this.enemies) {
            if (!e.alive) continue;

            if (e.x > front) {
                if (!e.gate.canMove) continue;     // 眩晕：原地罚站
                e.x -= e.moveSpeed * dt;           // 各怪按自己的速度向左推进
                if (e.x < front) e.x = front;
                if (e.actionLock <= 0) this._setAction(e, 'run');
            } else if (e.gate.canAct) {
                // 到达防线：贴身攻击。所有到达的怪都各自攻击，可叠在一起一起打
                e.cd -= dt;
                if (e.cd <= 0) {
                    e.cd = e.attackInterval / Math.max(0.01, e.stats.attackSpeed);
                    this._setAction(e, 'attack', ATTACK_ACTION_HOLD);
                    this._enemyAttack(e);
                }
            }
        }
    }

    private _enemyAttack(e: CombatUnit) {
        // 打最近的活着士兵（贴在坦克前的怪自然打到坦克）
        let target: CombatUnit | null = null;
        let bestD = Infinity;
        for (const s of this.soldiers) {
            if (!s.alive) continue;
            const dx = s.x - e.x, dy = s.y - e.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; target = s; }
        }
        if (!target) return;
        applyEffect(e, target, DMG1, this._effectHooks);   // 走完整公式（统一状态变更入口）
    }

    // 生成一条战斗飘字
    private _spawnFloat(x: number, y: number, r: DamageResult, kindOverride?: FloatText['kind']) {
        let text: string;
        let kind: FloatText['kind'];
        if (r.dodged) { text = '闪避'; kind = 'dodge'; }
        else {
            text = String(r.damage);
            kind = kindOverride ?? (r.crit ? 'crit' : (r.blocked ? 'block' : 'normal'));
        }
        // 限制数量，防刷屏
        if (this.floatTexts.length > 60) this.floatTexts.shift();
        this.floatTexts.push({
            x: x + (Math.random() * 2 - 1) * 18,
            y: y + 20,
            vy: 70,
            ttl: 0.7,
            maxTtl: 0.7,
            text, kind,
        });
    }

    private _updateFloats(dt: number) {
        let w = 0;
        for (let i = 0; i < this.floatTexts.length; i++) {
            const ft = this.floatTexts[i];
            ft.y += ft.vy * dt;
            ft.ttl -= dt;
            if (ft.ttl > 0) this.floatTexts[w++] = ft;
        }
        this.floatTexts.length = w;
    }

    // —— 治疗：每帧奶「血量百分比最低」的受伤队友 ——
    private _updateHealing(dt: number) {
        this.healBeamCount = 0;
        for (const h of this.soldiers) {
            if (!h.alive || !h.gate.canAct || h.healPerSec <= 0) continue;
            const target = this._mostHurtAlly();
            if (!target) continue;
            target.hp = Math.min(target.maxHp, target.hp + h.healPerSec * dt);
            this._setAction(h, 'attack', ATTACK_ACTION_HOLD);
            this.healBeamCount = this._pushBeam(this.healBeams, this.healBeamCount, h.x, h.y, target.x, target.y);
        }
    }

    private _mostHurtAlly(): CombatUnit | null {
        let best: CombatUnit | null = null;
        let bestRatio = 1;
        for (const s of this.soldiers) {
            if (!s.alive) continue;
            const ratio = s.hp / s.maxHp;
            if (ratio < 1 && ratio < bestRatio) { bestRatio = ratio; best = s; }
        }
        return best;
    }

    // —— 胜负 / 波次推进 ——
    private _checkWinLose() {
        if (!this._hasAliveSoldier()) { this.phase = 'lost'; return; }

        const waveCleared = this._waveFullySpawned && this.enemies.length === 0;
        if (!waveCleared) return;

        if (this.waveIndex >= this.level.waves.length - 1) {
            this._idleLivingSoldiers();
            this.phase = 'won';                  // 通关本关
        } else if (this.phase !== 'gap') {
            this.gapTimer = this.level.waveGap;  // 进入波次间隔，结束后开下一波
            this.phase = 'gap';
        }
    }

    get squadHpTotal(): number {
        let sum = 0;
        for (const s of this.soldiers) if (s.alive) sum += Math.max(0, s.hp);
        return sum;
    }
    get squadHpMax(): number {
        let sum = 0;
        for (const s of this.soldiers) sum += s.maxHp;
        return sum;
    }
}
