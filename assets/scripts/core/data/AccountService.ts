// 账号服务（纯逻辑，不依赖 cc）：账号名校验、当前账号、本机账号列表、按账号的存档键、老档迁移。
// accountId 同时是将来后端接入的用户标识（RemoteDataSource 从这里读身份），
// 见 docs/superpowers/specs/2026-07-07-account-save-design.md。

export interface KVStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export const DEFAULT_ACCOUNT = 'guest';
const KEY_CURRENT = 'account_current';
const KEY_INDEX = 'account_index';
const LEGACY_SAVE_KEY = 'idle_save_v1';
const SAVE_PREFIX = 'save_';
const ID_RE = /^[0-9A-Za-z_一-龥]{1,20}$/;

// 校验并规范化账号名：trim 后 1~20 字符（中英文/数字/下划线）；非法返回 null。
export function normalizeAccountId(raw: string): string | null {
    const id = (raw ?? '').trim();
    return ID_RE.test(id) ? id : null;
}

export class AccountService {
    constructor(private readonly storage: KVStorage) {}

    // 当前账号；键缺失/损坏回退默认账号（不写回，写入只发生在 setCurrentAccount）。
    currentAccount(): string {
        return normalizeAccountId(this.storage.getItem(KEY_CURRENT) ?? '') ?? DEFAULT_ACCOUNT;
    }

    // 设当前账号并并入本机账号列表（去重）；非法账号名返回 false 且不动存储。
    setCurrentAccount(raw: string): boolean {
        const id = normalizeAccountId(raw);
        if (!id) return false;
        this.storage.setItem(KEY_CURRENT, id);
        const list = this.listAccounts();
        if (list.indexOf(id) < 0) {
            list.push(id);
            this.storage.setItem(KEY_INDEX, JSON.stringify(list));
        }
        return true;
    }

    // 本机已有账号列表；键损坏/为空时自愈为 [当前账号] 并写回。
    listAccounts(): string[] {
        const raw = this.storage.getItem(KEY_INDEX);
        if (raw) {
            try {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    const ids = arr.map(v => normalizeAccountId(String(v))).filter((v): v is string => !!v);
                    const deduped = [...new Set(ids)];
                    if (deduped.length > 0) return deduped;
                }
            } catch { /* 损坏走下方自愈 */ }
        }
        const fallback = [this.currentAccount()];
        this.storage.setItem(KEY_INDEX, JSON.stringify(fallback));
        return fallback;
    }

    saveKeyFor(id: string): string {
        return SAVE_PREFIX + id;
    }

    currentSaveKey(): string {
        return this.saveKeyFor(this.currentAccount());
    }

    // 老档迁移：无账号旧档（idle_save_v1）→ save_guest；已有 save_guest 不覆盖；
    // 旧键一律删除（避免二次迁移歧义）；幂等。
    migrateLegacy(): void {
        const legacy = this.storage.getItem(LEGACY_SAVE_KEY);
        if (legacy === null) return;
        if (this.storage.getItem(this.saveKeyFor(DEFAULT_ACCOUNT)) === null) {
            this.storage.setItem(this.saveKeyFor(DEFAULT_ACCOUNT), legacy);
        }
        this.storage.removeItem(LEGACY_SAVE_KEY);
    }
}
