// 资源加载/缓存/回退（泛型，不依赖 cc）。
// 加载逻辑由注入的 loader 决定（真实用 Cocos resources.load，测试用假 loader）。
// 解析不到的键 → 返回 null（不抛），并记入 missing 供调试。

import { ArtManifest, entryFiles } from './ArtManifest';

export type Loader<T> = (path: string) => Promise<T | null>;

export class ArtRegistry<T> {
    private cache = new Map<string, T | null>();   // 资源路径 → 资源（null=确认缺失）
    private missing = new Set<string>();           // 缺失的逻辑键

    constructor(private loader: Loader<T>) {}

    // 进场前批量预载这些逻辑键涉及的全部文件
    async preload(keys: string[]): Promise<void> {
        for (const key of keys) {
            const entry = ArtManifest[key];
            if (!entry) { this.missing.add(key); continue; }
            for (const p of entryFiles(entry)) await this.loadPath(p, key);
        }
    }

    private async loadPath(path: string, key: string): Promise<void> {
        if (this.cache.has(path)) return;
        const asset = await this.loader(path);
        this.cache.set(path, asset);
        if (asset == null) this.missing.add(key);
    }

    getSprite(key: string): T | null {
        const entry = ArtManifest[key];
        if (!entry || entry.type !== 'sprite') { this.missing.add(key); return null; }
        return this.cache.get(entry.path) ?? null;
    }

    getFrames(key: string): { frames: T[]; fps: number; loop: boolean; pingpong: boolean; blend: number } | null {
        const entry = ArtManifest[key];
        if (!entry || entry.type !== 'frames') { this.missing.add(key); return null; }
        const frames: T[] = [];
        for (const p of entryFiles(entry)) {
            const a = this.cache.get(p);
            if (a == null) { this.missing.add(key); return null; }   // 任一帧缺 → 整体回退
            frames.push(a);
        }
        return { frames, fps: entry.fps, loop: entry.loop, pingpong: entry.pingpong ?? false, blend: entry.blend ?? 0 };
    }

    missingKeys(): string[] { return [...this.missing]; }
}
