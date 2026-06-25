// 战斗管理器（BattleManager）—— 战斗核心逻辑，纯数据、不碰渲染
// 职责：布阵（前排坦克/后排输出治疗）、按波次刷怪、自动开火、子弹命中、
//      敌人推进到防线后贴身缠斗、治疗奶血、胜负判定。
// 只算数据，怎么画交给 BattleEntry。

import { BattleConfig, SoldierClass } from '../config/BattleConfig';

// 一名士兵
export interface Soldier {
    cls: SoldierClass;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    damage: number;       // 单发伤害（治疗为 0）
    fireInterval: number; // 开火间隔（治疗为 0）
    healPerSec: number;   // 每秒治疗量（非治疗为 0）
    cd: number;           // 开火冷却
    alive: boolean;
}

// 一只敌人
export interface Enemy {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    atkCd: number;        // 贴身攻击冷却
    alive: boolean;
}

// 一颗子弹
export interface Bullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    alive: boolean;
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

    phase: BattlePhase = 'spawning';
    waveIndex = 0;
    private spawnedInWave = 0;
    private spawnTimer = 0;
    private gapTimer = 0;

    constructor(halfW: number, halfH: number) {
        this.halfW = halfW;
        this.halfH = halfH;
        this._setupSquad();
    }

    // —— 布阵（单排一字阵）：全员同一条横线 y=0，按 roster 顺序从前到后沿 x 排开 ——
    private _setupSquad() {
        const L = BattleConfig.layout;
        const frontX = -this.halfW + L.frontMargin;
        BattleConfig.roster.forEach((cls, i) => {
            const def = BattleConfig.classes[cls];
            this.soldiers.push({
                cls,
                x: frontX - i * L.spacing,   // 越靠后（i 越大）越靠左
                y: 0,
                hp: def.hp,
                maxHp: def.hp,
                damage: def.damage,
                fireInterval: def.fireInterval,
                healPerSec: def.healPerSec,
                cd: Math.random() * Math.max(def.fireInterval, 0.3),
                alive: true,
            });
        });
    }

    private get aliveSoldiers(): Soldier[] {
        return this.soldiers.filter(s => s.alive);
    }

    // 当前防线位置 = 最前面（x 最大、最靠右）还活着的单位那条竖线；没人活着则 -Infinity
    private get defenseLineX(): number {
        let x = -Infinity;
        for (const s of this.soldiers) if (s.alive && s.x > x) x = s.x;
        return x;
    }

    tick(dt: number) {
        if (this.phase === 'won' || this.phase === 'lost') return;
        this._updateSpawning(dt);
        this._updateFiring(dt);
        this._updateBullets(dt);
        this._updateEnemies(dt);
        this._updateHealing(dt);
        this._checkWinLose();
    }

    // —— 刷怪 ——
    private _updateSpawning(dt: number) {
        const wave = BattleConfig.waves[this.waveIndex];
        if (this.phase === 'gap') {
            this.gapTimer -= dt;
            if (this.gapTimer <= 0) this.phase = 'spawning';
            return;
        }
        if (this.spawnedInWave < wave.count) {
            this.spawnTimer -= dt;
            if (this.spawnTimer <= 0) {
                this.spawnTimer = wave.interval;
                this._spawnEnemy(wave.hp);
                this.spawnedInWave++;
            }
        }
    }

    private _spawnEnemy(hp: number) {
        // 从右边进场，同样站在 y=0 这条线上，单列排队
        this.enemies.push({
            x: this.halfW, y: 0, hp, maxHp: hp,
            atkCd: BattleConfig.enemy.attackInterval * 0.5,
            alive: true,
        });
    }

    // —— 自动开火：坦克/输出瞄准最近敌人；治疗不开火 ——
    private _updateFiring(dt: number) {
        for (const s of this.soldiers) {
            if (!s.alive || s.damage <= 0 || s.fireInterval <= 0) continue;
            s.cd -= dt;
            if (s.cd > 0) continue;
            const target = this._nearestEnemy(s.x, s.y);
            if (!target) continue;
            s.cd = s.fireInterval;
            this._fireBullet(s, target);
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

    private _fireBullet(s: Soldier, target: Enemy) {
        const speed = BattleConfig.bullet.speed;
        const dx = target.x - s.x, dy = target.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        this.bullets.push({
            x: s.x, y: s.y,
            vx: (dx / len) * speed,
            vy: (dy / len) * speed,
            damage: s.damage,
            alive: true,
        });
    }

    // —— 子弹飞行 + 命中 ——
    private _updateBullets(dt: number) {
        const br = BattleConfig.bullet.radius;
        const er = BattleConfig.enemy.radius;
        const hitDist = (br + er) * (br + er);

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
                const dx = e.x - b.x, dy = e.y - b.y;
                if (dx * dx + dy * dy <= hitDist) {
                    e.hp -= b.damage;
                    b.alive = false;
                    if (e.hp <= 0) e.alive = false;
                    break;
                }
            }
        }
        this.bullets = this.bullets.filter(b => b.alive);
    }

    // —— 敌人推进（向左）：单列前后排队，最前的顶在防线打，后面的依次等位 ——
    //   没有碰撞物理：每只怪只是停在「防线前」或「前一只怪身后」，互不推挤。
    private _updateEnemies(dt: number) {
        const speed = BattleConfig.enemy.speed;
        const qs = BattleConfig.enemy.queueSpacing;
        const contact = BattleConfig.enemy.contactGap;
        const front = this.defenseLineX + contact;  // 最前怪贴防线时的位置

        for (const e of this.enemies) {
            if (!e.alive) continue;

            // 正前方（x 更小）最近的同伴，决定我能停到哪
            let stopX = front;
            for (const o of this.enemies) {
                if (o.alive && o !== e && o.x < e.x) {
                    stopX = Math.max(stopX, o.x + qs);
                }
            }

            if (e.x > stopX + 0.5) {
                e.x -= speed * dt;                 // 还没到位：继续向左压
                if (e.x < stopX) e.x = stopX;
            } else if (e.x <= front + 1) {
                // 排在最前、贴着防线：定期攻击最近的士兵
                e.atkCd -= dt;
                if (e.atkCd <= 0) {
                    e.atkCd = BattleConfig.enemy.attackInterval;
                    this._enemyAttack(e);
                }
            }
            // 否则：在队伍中段等位，不动也不打
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
        target.hp -= BattleConfig.enemy.damage;
        if (target.hp <= 0) target.alive = false;
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

        const wave = BattleConfig.waves[this.waveIndex];
        const waveCleared = this.spawnedInWave >= wave.count && this.enemies.length === 0;
        if (!waveCleared) return;

        if (this.waveIndex >= BattleConfig.waves.length - 1) {
            this.phase = 'won';
        } else if (this.phase !== 'gap') {
            this.waveIndex++;
            this.spawnedInWave = 0;
            this.spawnTimer = 0;
            this.gapTimer = BattleConfig.waveGap;
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
