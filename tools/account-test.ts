// 账号服务单测（纯逻辑，tsx 运行）。
import * as assert from 'node:assert/strict';
import { AccountService, normalizeAccountId, DEFAULT_ACCOUNT, KVStorage } from '../assets/scripts/core/data/AccountService';

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; console.error('  ✗ ' + name + ' — ' + (e as Error).message); }
}

function fakeStorage(init: Record<string, string> = {}): KVStorage & { data: Record<string, string> } {
    const data: Record<string, string> = { ...init };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = v; },
        removeItem: (k) => { delete data[k]; },
    };
}

test('normalize：合法（中英文/数字/下划线，1~20 字）', () => {
    assert.equal(normalizeAccountId('a'), 'a');
    assert.equal(normalizeAccountId('  Ab_1中文  '), 'Ab_1中文');
    assert.equal(normalizeAccountId('a'.repeat(20)), 'a'.repeat(20));
});

test('normalize：非法（空/纯空格/超长/空格/连字符）', () => {
    assert.equal(normalizeAccountId(''), null);
    assert.equal(normalizeAccountId('   '), null);
    assert.equal(normalizeAccountId('a'.repeat(21)), null);
    assert.equal(normalizeAccountId('a b'), null);
    assert.equal(normalizeAccountId('a-b'), null);
});

test('currentAccount：缺失/损坏回退 guest', () => {
    assert.equal(new AccountService(fakeStorage()).currentAccount(), DEFAULT_ACCOUNT);
    assert.equal(new AccountService(fakeStorage({ account_current: '  !!bad!!  ' })).currentAccount(), DEFAULT_ACCOUNT);
});

test('setCurrentAccount：合法写入并并入索引（去重）', () => {
    const s = fakeStorage();
    const svc = new AccountService(s);
    assert.equal(svc.setCurrentAccount('alice'), true);
    assert.equal(svc.currentAccount(), 'alice');
    assert.deepEqual(svc.listAccounts(), ['alice']);
    assert.equal(svc.setCurrentAccount('alice'), true);
    assert.deepEqual(svc.listAccounts(), ['alice']);
    assert.equal(svc.setCurrentAccount('bob'), true);
    assert.deepEqual(svc.listAccounts(), ['alice', 'bob']);
});

test('setCurrentAccount：非法拒绝且不改存储', () => {
    const s = fakeStorage();
    const svc = new AccountService(s);
    assert.equal(svc.setCurrentAccount(' '), false);
    assert.equal(s.getItem('account_current'), null);
});

test('listAccounts：索引损坏自愈为 [当前账号] 并写回', () => {
    const s = fakeStorage({ account_current: 'alice', account_index: '{oops' });
    const svc = new AccountService(s);
    assert.deepEqual(svc.listAccounts(), ['alice']);
    assert.equal(s.getItem('account_index'), JSON.stringify(['alice']));
});

test('listAccounts：索引里非法项被过滤', () => {
    const s = fakeStorage({ account_index: JSON.stringify(['alice', ' ', 'a-b', 'bob', 'alice']) });
    assert.deepEqual(new AccountService(s).listAccounts(), ['alice', 'bob']);
});

test('saveKeyFor / currentSaveKey：键作用域随当前账号变化', () => {
    const s = fakeStorage();
    const svc = new AccountService(s);
    assert.equal(svc.saveKeyFor('alice'), 'save_alice');
    assert.equal(svc.currentSaveKey(), 'save_guest');
    svc.setCurrentAccount('bob');
    assert.equal(svc.currentSaveKey(), 'save_bob');
});

test('两账号存档互不串档（模拟 load/save 键）', () => {
    const s = fakeStorage();
    const svc = new AccountService(s);
    svc.setCurrentAccount('alice');
    s.setItem(svc.currentSaveKey(), '{"gold":1}');
    svc.setCurrentAccount('bob');
    s.setItem(svc.currentSaveKey(), '{"gold":2}');
    assert.equal(s.getItem('save_alice'), '{"gold":1}');
    assert.equal(s.getItem('save_bob'), '{"gold":2}');
});

test('migrateLegacy：旧档拷到 save_guest 并删旧键；幂等', () => {
    const s = fakeStorage({ idle_save_v1: '{"gold":9}' });
    const svc = new AccountService(s);
    svc.migrateLegacy();
    assert.equal(s.getItem('save_guest'), '{"gold":9}');
    assert.equal(s.getItem('idle_save_v1'), null);
    svc.migrateLegacy(); // 二次调用无副作用
    assert.equal(s.getItem('save_guest'), '{"gold":9}');
});

test('migrateLegacy：save_guest 已存在则不覆盖，但仍删旧键', () => {
    const s = fakeStorage({ idle_save_v1: '{"gold":9}', save_guest: '{"gold":100}' });
    new AccountService(s).migrateLegacy();
    assert.equal(s.getItem('save_guest'), '{"gold":100}');
    assert.equal(s.getItem('idle_save_v1'), null);
});

console.log(`\nAccountService：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
