# Caikesi —— 放置挂机刷装备小游戏

微信小游戏，使用 Cocos Creator 3.8.8 开发。

## 项目结构

```
assets/scripts/
├── GameEntry.ts              游戏入口（挂在场景 main 的 Game 节点上）
├── config/
│   └── GameConfig.ts         ★ 数值配置表 —— 策划调玩法主要改这里
└── core/                     框架层（写一次基本不动）
    ├── GameManager.ts        挂机产出、离线收益、自动存档
    ├── data/DataService.ts   数据层，本地/远程可切换（预留后端接口）
    └── event/EventCenter.ts  事件总线，模块解耦
```

## 设计要点

- **框架与玩法分离**：换玩法只动 `game/`，框架层不动。
- **数据驱动**：数值集中在 `config/`，策划改表即调玩法。
- **预留后端**：数据走 `DataService` 接口，现在用本地存储，以后加 `RemoteDataSource`
  连后端（账号/存档同步/排行榜/内购校验/防作弊），玩法代码不改。
- **离线收益**：靠存档时间戳计算，将来需挪到服务器校验防作弊。

## 开发流程

1. 在 Cocos 编辑器改东西 → `Ctrl+S` 保存。
2. 顶部 ▶ 预览（浏览器）快速看效果。
3. 发布微信：`项目 → 构建发布 → 平台选微信小游戏 → 构建`，产物在 `build/wechatgame`。
4. 用微信开发者工具导入 `build/wechatgame` 预览 / 上传。

## 上线资质

参考上层目录 `D:\Cgame\上线资质清单_checklist.md`（路线：先广告+备案上线，后内购+版号）。
