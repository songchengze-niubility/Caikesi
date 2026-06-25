// 战斗管理器（BattleManager）—— 战斗核心逻辑，纯数据、不碰渲染
// 职责：布阵（前排坦克/后排输出治疗）、按波次刷怪、自动开火、子弹命中、
//      敌人推进到防线后贴身缠斗、治疗奶血、胜负判定。
// 只算数据，怎么画交给 BattleEntry。

import { BattleConfig, SoldierClass, AttackType, CombatStats } from '../config/BattleConfig';
import { calcDamage, DamageResult } from './CombatFormula';

// 一名士兵（战斗属性走统一 stats，行为字段从职业配置拷来）
export interface Soldier {
    cls: SoldierClass;
    attackType: AttackType; // 近战 / 远程 / 治疗
    stats: CombatStats;     // 统一战斗属性（引用配置，便于实时调参）
    x: number;            // 当前位置（近战会冲出去）
    y: number;
    homeX: number;        // 原始站位（防线、退守都用它）
    homeY: number;
    hp: number;           // 当前血量
    maxHp: number;
    fireInterval: number; // 基础攻击间隔（治疗为 0）
    range: number;        // 攻击距离
    moveSpeed: number;    // 移动速度（0=不动）
    advanceLimit: number; // 离原站位最多前压多远
    healPerSec: number;   // 每秒治疗量（非治疗为 0）
    cd: number;           // 攻击冷却
    alive: boolean;
}

// 一只敌人（属性/移动/外观来自其怪物类型 EnemyType）
export interface Enemy {
    typeName: string;     // 怪物类型名（飘字/调试）
    stats: CombatStats;   // 战斗属性（引用该类型的 stats）
    speed: number;        // 推进速度
    radius: number;       // 体型 + 命中半径
    attackInterval: number;
    color: [number, number, number];
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    atkCd: number;        // 贴身攻击冷却
    alive: boolean;
}

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
    kind: 'normal' | 'crit' | 'block' | 'dodge';
}

// 治疗光束（仅供界面画反馈，逻辑不依赖）
export interface HealBeam {
    fromX: number; fromY: number;
    toX: number; toY: number;
}

export type BattlePhase = 'spawning' | 'gap' | 'won' | 'lost';

export class BattleManager {
    private halfW = 0;
    private halfH = 0;

    soldiers: Soldier[] = [];
    enemies: Enemy[] = [];
    bullets: Bullet[] = [];
    healBeams: HealBeam[] = [];
    meleeBeams: HealBeam[] = [];   // 近战正在劈的连线（仅供界面画反馈）
    floatTexts: FloatText[] = [];  // 战斗飘字

    phase: BattlePhase = 'spawning';
    levelIndex = 0;
    waveIndex = 0;
    private gapTimer = 0;
    // 当前波每个刷怪组的运行时状态
    private _groups: { type: string; count: number; interval: number; hp?: number; spawned: number; timer: number }[] = [];

    constructor(halfW: number, halfH: number, levelIndex = BattleConfig.startLevel) {
        this.halfW = halfW;
        this.halfH = halfH;
        this.levelIndex = Math.max(0, Math.min(levelIndex, BattleConfig.levels.length - 1));
        this._setupSquad();
        this._startWave(0);
    }

    get level() { return BattleConfig.levels[this.levelIndex]; }
    get levelName(): string { return this.level.name; }
    get totalWaves(): number { return this.level.waves.length; }

    // —— 布阵（单排一字阵）：全员同一条横线 y=0，按 roster 顺序从前到后沿 x 排开 ——
    private _setupSquad() {
        const L = BattleConfig.layout;
        const frontX = -this.halfW + L.frontMargin;
        BattleConfig.roster.forEach((cls, i) => {
            const cdef = BattleConfig.classes[cls];   // 职业行为配置
            const st = BattleConfig.stats[cls];       // 职业战斗属性（统一表）
            const hx = frontX - i * L.spacing;   // 越靠后（i 越大）越靠左
            this.soldiers.push({
                cls,
                attackType: cdef.attackType,
                stats: st,
                x: hx,
                y: 0,
                homeX: hx,
                homeY: 0,
                hp: st.hp,
                maxHp: st.hp,
                fireInterval: cdef.fireInterval,
                range: cdef.range,
                moveSpeed: cdef.moveSpeed,
                advanceLimit: cdef.advanceLimit,
                healPerSec: cdef.healPerSec,
                cd: Math.random() * Math.max(cdef.fireInterval, 0.3),
                alive: true,
            });
        });
    }

    private get aliveSoldiers(): Soldier[] {
        return this.soldiers.filter(s => s.alive);
    }

    // 防线 = 最前面还活着单位的【原始站位】（用 homeX，不随近战冲出去而漂移）
    private get defenseLineX(): number {
        let x = -Infinity;
        for (const s of this.soldiers) if (s.alive && s.homeX > x) x = s.homeX;
        return x;
    }

    tick(dt: number) {
        if (this.phase === 'won' || this.phase === 'lost') return;
        this._updateSpawning(dt);
        this._updateMovement(dt);
        this._updateFiring(dt);
        this._updateBullets(dt);
        this._updateEnemies(dt);
        this._updateHealing(dt);
        this._updateFloats(dt);
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
        const t = BattleConfig.enemyTypes[type];
        if (!t) return;
        const hp = hpOverride ?? t.stats.hp;
        this.enemies.push({
            typeName: t.name,
            stats: t.stats,
            speed: t.speed,
            radius: t.radius,
            attackInterval: t.attackInterval,
            color: t.color,
            x: this.halfW, y: 0, hp, maxHp: hp,
            atkCd: t.attackInterval * 0.5,
            alive: true,
        });
    }

    // —— 移动：近战冲向最近的怪贴脸，没怪了退回站位；远程/治疗守在原位 ——
    private _updateMovement(dt: number) {
        for (const s of this.soldiers) {
            if (!s.alive) continue;

            if (s.attackType !== 'melee' || s.moveSpeed <= 0) {
                s.x = s.homeX; s.y = s.homeY;   // 远程/治疗：钉在站位
                continue;
            }

            const target = this._frontmostEnemy();   // 盯最前面那只，守住阵线不追后排
            if (!target) {
                this._moveToward(s, s.homeX, s.homeY, s.moveSpeed * dt);  // 没怪：退守
                continue;
            }

            const dx = target.x - s.x, dy = target.y - s.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d > s.range) {
                // 冲上去，但停在 range 内
                const step = Math.min(s.moveSpeed * dt, d - s.range * 0.85);
                let nx = s.x + (dx / d) * step;
                const ny = s.y + (dy / d) * step;
                // 前压上限；且硬保险——绝不越过「怪停靠线 − 射程」，保证怪永远在坦克前方
                const lineLimit = this.defenseLineX + BattleConfig.formation.contactGap - s.range;
                const limitX = Math.min(s.homeX + s.advanceLimit, lineLimit);
                if (nx > limitX) nx = limitX;
                s.x = nx; s.y = ny;
            }
        }
    }

    private _moveToward(s: Soldier, tx: number, ty: number, step: number) {
        const dx = tx - s.x, dy = ty - s.y;
        const d = Math.hypot(dx, dy);
        if (d <= step || d === 0) { s.x = tx; s.y = ty; return; }
        s.x += (dx / d) * step; s.y += (dy / d) * step;
    }

    // —— 自动攻击：近战贴身劈、远程发子弹（都瞄最近敌人，受 range 限制）；治疗不攻击 ——
    private _updateFiring(dt: number) {
        this.meleeBeams = [];
        for (const s of this.soldiers) {
            if (!s.alive || s.attackType === 'heal' || s.stats.atk <= 0) continue;

            // 近战盯最前面的怪（守线）；远程打最近的
            const target = s.attackType === 'melee'
                ? this._frontmostEnemy()
                : this._nearestEnemy(s.x, s.y);
            if (!target) continue;

            // 够不够得着
            const dx = target.x - s.x, dy = target.y - s.y;
            const dist = Math.hypot(dx, dy);
            if (dist > s.range) continue;   // 不够近就不打，也不进冷却，靠近即出手

            // 近战：持续画一条「正在劈」的连线
            if (s.attackType === 'melee') {
                this.meleeBeams.push({ fromX: s.x, fromY: s.y, toX: target.x, toY: target.y });
            }

            s.cd -= dt;
            if (s.cd > 0) continue;
            s.cd = s.fireInterval / Math.max(0.01, s.stats.attackSpeed);  // 攻速缩短间隔

            if (s.attackType === 'melee') {
                this._applyDamage(s.stats, target);   // 近战：走完整公式
            } else {
                this._fireBullet(s, target);    // 远程：发子弹（命中再结算）
            }
        }
    }

    private _nearestEnemy(x: number, y: number): Enemy | null {
        let best: Enemy | null = null;
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
    private _frontmostEnemy(): Enemy | null {
        let best: Enemy | null = null;
        let bestX = Infinity;
        for (const e of this.enemies) {
            if (!e.alive) continue;
            if (e.x < bestX) { bestX = e.x; best = e; }
        }
        return best;
    }

    private _fireBullet(s: Soldier, target: Enemy) {
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
                    this._applyDamage(b.stats, e);   // 命中：走完整公式
                    b.alive = false;
                    break;
                }
            }
        }
        this.bullets = this.bullets.filter(b => b.alive);
    }

    // —— 敌人推进（向左）：无碰撞，全部冲到防线叠在一起，各自一起攻击（群殴） ——
    private _updateEnemies(dt: number) {
        const front = this.defenseLineX + BattleConfig.formation.contactGap;

        for (const e of this.enemies) {
            if (!e.alive) continue;

            if (e.x > front) {
                e.x -= e.speed * dt;               // 各怪按自己的速度向左推进
                if (e.x < front) e.x = front;
            } else {
                // 到达防线：贴身攻击。所有到达的怪都各自攻击，可叠在一起一起打
                e.atkCd -= dt;
                if (e.atkCd <= 0) {
                    e.atkCd = e.attackInterval / Math.max(0.01, e.stats.attackSpeed);
                    this._enemyAttack(e);
                }
            }
        }
        this.enemies = this.enemies.filter(e => e.alive);
    }

    private _enemyAttack(e: Enemy) {
        const alive = this.aliveSoldiers;
        if (alive.length === 0) return;
        // 打最近的士兵（贴在坦克前的怪自然打到坦克）
        let target = alive[0];
        let bestD = Infinity;
        for (const s of alive) {
            const dx = s.x - e.x, dy = s.y - e.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; target = s; }
        }
        this._applyDamage(e.stats, target);   // 走完整公式
    }

    // —— 统一伤害结算：算伤害 → 扣血 → 飘字 → 判死 ——
    private _applyDamage(att: CombatStats, defender: { stats: CombatStats; x: number; y: number; hp: number; alive: boolean }) {
        const r = calcDamage(att, defender.stats);
        defender.hp -= r.damage;
        this._spawnFloat(defender.x, defender.y, r);
        if (defender.hp <= 0) defender.alive = false;
    }

    // 生成一条战斗飘字
    private _spawnFloat(x: number, y: number, r: DamageResult) {
        let text: string;
        let kind: FloatText['kind'];
        if (r.dodged) { text = '闪避'; kind = 'dodge'; }
        else {
            text = String(r.damage);
            kind = r.crit ? 'crit' : (r.blocked ? 'block' : 'normal');
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
        for (const ft of this.floatTexts) {
            ft.y += ft.vy * dt;
            ft.ttl -= dt;
        }
        this.floatTexts = this.floatTexts.filter(ft => ft.ttl > 0);
    }

    // —— 治疗：每帧奶「血量百分比最低」的受伤队友 ——
    private _updateHealing(dt: number) {
        this.healBeams = [];
        for (const h of this.soldiers) {
            if (!h.alive || h.healPerSec <= 0) continue;
            const target = this._mostHurtAlly();
            if (!target) continue;
            target.hp = Math.min(target.maxHp, target.hp + h.healPerSec * dt);
            this.healBeams.push({ fromX: h.x, fromY: h.y, toX: target.x, toY: target.y });
        }
    }

    private _mostHurtAlly(): Soldier | null {
        let best: Soldier | null = null;
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
        if (this.aliveSoldiers.length === 0) { this.phase = 'lost'; return; }

        const waveCleared = this._waveFullySpawned && this.enemies.length === 0;
        if (!waveCleared) return;

        if (this.waveIndex >= this.level.waves.length - 1) {
            this.phase = 'won';                  // 通关本关
        } else if (this.phase !== 'gap') {
            this.gapTimer = this.level.waveGap;  // 进入波次间隔，结束后开下一波
            this.phase = 'gap';
        }
    }

    get squadHpTotal(): number {
        return this.aliveSoldiers.reduce((s, x) => s + Math.max(0, x.hp), 0);
    }
    get squadHpMax(): number {
        return this.soldiers.reduce((s, x) => s + x.maxHp, 0);
    }
}
