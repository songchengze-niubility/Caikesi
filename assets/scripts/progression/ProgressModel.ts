// 关卡进度模型（纯逻辑，不依赖 cc）：当前关、最高解锁、胜利解锁下一关。

export interface ProgressSave {
    currentLevel: number;
    maxUnlockedLevel: number;
}

export interface CompleteLevelResult {
    completedLevel: number;
    nextLevel: number;
    hasNext: boolean;
    unlockedNext: boolean;
}

function clampLevel(index: number, levelCount: number): number {
    if (!Number.isFinite(index)) return 0;
    return Math.max(0, Math.min(Math.floor(index), Math.max(0, levelCount - 1)));
}

export class ProgressModel {
    currentLevel = 0;
    maxUnlockedLevel = 0;

    constructor(
        private levelCount: number,
        private defaultLevel = 0,
    ) {
        this.levelCount = Math.max(1, Math.floor(levelCount));
        this.defaultLevel = clampLevel(defaultLevel, this.levelCount);
        this.currentLevel = this.defaultLevel;
        this.maxUnlockedLevel = this.defaultLevel;
    }

    get lastLevel(): number { return this.levelCount - 1; }
    get isAtLastLevel(): boolean { return this.currentLevel >= this.lastLevel; }

    deserialize(save: Partial<ProgressSave> | undefined): void {
        const savedCurrent = save?.currentLevel;
        const current = clampLevel(savedCurrent ?? this.defaultLevel, this.levelCount);
        const savedMax = save?.maxUnlockedLevel;
        const maxUnlocked = clampLevel(savedMax ?? current, this.levelCount);
        this.currentLevel = current;
        this.maxUnlockedLevel = Math.max(current, maxUnlocked);
    }

    serialize(): ProgressSave {
        return {
            currentLevel: clampLevel(this.currentLevel, this.levelCount),
            maxUnlockedLevel: clampLevel(this.maxUnlockedLevel, this.levelCount),
        };
    }

    selectLevel(levelIndex: number): boolean {
        const level = clampLevel(levelIndex, this.levelCount);
        if (level > this.maxUnlockedLevel) return false;
        this.currentLevel = level;
        return true;
    }

    completeLevel(levelIndex = this.currentLevel): CompleteLevelResult {
        const completedLevel = clampLevel(levelIndex, this.levelCount);
        const nextLevel = Math.min(completedLevel + 1, this.lastLevel);
        const before = this.maxUnlockedLevel;
        if (completedLevel >= this.maxUnlockedLevel) {
            this.maxUnlockedLevel = Math.max(this.maxUnlockedLevel, nextLevel);
        }
        return {
            completedLevel,
            nextLevel,
            hasNext: completedLevel < this.lastLevel,
            unlockedNext: this.maxUnlockedLevel > before,
        };
    }

    selectNextAfter(levelIndex = this.currentLevel): boolean {
        const level = clampLevel(levelIndex, this.levelCount);
        if (level >= this.lastLevel) return false;
        return this.selectLevel(level + 1);
    }
}
