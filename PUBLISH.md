# 发布 dsh-handy-toolkits

DSH 装插件走的是 **npm 包**这一条路：插件页的「添加插件」接受包名（可带版本）、Git 地址、压缩包链接或本地绝对路径，Host 用 pnpm 把它装进 profile 的 `node_modules` 并把它登记为一个**组合包（bundle）**。

所以"发布"分成两件事：

1. **能被装上**——包在 npm 上，且清单里声明了 `dsh.bundle.patch`（否则 pnpm 装完只会留一句 `declares no dsh.bundle — installed as a plain dependency, not a profile layer`，插件不会启用）。
2. **能被发现**——出现在某个插件市场索引里（官方「发现」页的 format 1 索引，或社区精选列表）。

第 1 步是硬性的，第 2 步可选。

## 1. 清单要求（本仓库已就绪）

GUI 安装的前置校验在 `bundleManifest()` 里：读包 `package.json` 的 `dsh.bundle.patch`，没有就判 `not-bundle`。关键字段：

| 字段 | 作用 | 本包取值 |
|---|---|---|
| `dsh.bundle.patch` | 必填。组合包 patch 文件路径，字符串或路径数组 | `./cordis.patch.yml` |
| `dsh.client.platform` | 浏览器半侧的运行平台 | `web` |
| `exports["./client"]` | 已构建好的浏览器 bundle（ESM，`__ModuleLoader__.load({ id, factory })` 形式） | `./lib/client.js` |
| `exports["."]` | 宿主半侧入口（Cordis 插件） | `./lib/index.js` |
| `dsh.client.external` | 仅当 bundle 里 `require()` 了非基线的模块才需要 | 不需要（本包零依赖） |
| `engines.dsh` | 兼容的 DSH 版本区间；**写了它就只认它**，`peerDependencies` 会被忽略 | `>=0.2.0-rc.2` |
| `files` | npm 打包白名单，别把 `test/`、`docs/` 发上去 | 5 项 |

`cordis.patch.yml` 内容是往 profile 层里插一行，`name` 写**包名**（包已在 node_modules 里，按名字解析）：

```yaml
# dsh bundle patch: inserts this plugin into a profile's layer stack.
- insert:
    - id: dsh-handy-toolkits
      name: dsh-handy-toolkits
```

> 实测：从组合包 patch 装进来的行，在 Loader 图里 id 会变成包名 `dsh-handy-toolkits`，不会再撞上别人的 `dsh-handy-toolkits`。

## 2. 发布前自测（不用真的发布）

把包放进一份 profile 的 `node_modules`，登记进 `dsh.profile.bundles`，再启动，等价于 pnpm 装好之后的状态：

```sh
cp -R . "$PROFILE/node_modules/dsh-handy-toolkits"
# profile/package.json: dependencies 加 "dsh-handy-toolkits": "0.1.0"，
#                       dsh.profile.bundles 加 "dsh-handy-toolkits"
DSH_HOME=/tmp/pubtest dsh --profile pub --port 63006 --no-open
curl -s http://127.0.0.1:63006/plugins/events | grep -o '"id":"dsh-handy-toolkits"[^}]*}'
```

应当看到 `{"id":"dsh-handy-toolkits","url":"plugins/??dsh-handy-toolkits/client.js&rev=..."}`，且启动日志没有 `did not activate` 或 `declares no dsh.bundle`。本包按这条路径验证过。

## 3. 发到 npm

```sh
# 1) 名字：先确认可用（无 scope 更好记，有 scope 要 --access public）
npm view dsh-handy-toolkits version      # 404 = 可用
# 2) 去掉 "private": true（有这个字段 npm 会拒绝发布）
# 3) repository 已指向 https://github.com/kuoxinxin/dsh-handy-toolkits（包在仓库根）
npm login
npm publish --access public

# 4) 复核：npm 上的内容 = 你要发的内容
npm view dsh-handy-toolkits dist.tarball
npm pack --dry-run
```

要点：

- **不用带构建步骤**——本仓库的 `lib/client.js` 就是最终产物，`files` 已经把它带上。若将来改成 TS/打包器，记得发布前先构建（`prepublishOnly: npm run build`），并且**不要**在 npm 包里塞 `prepare` 去依赖 devDependencies。
- 有 scope 的包名（`@you/dsh-handy-toolkits`）在 GUI 里同样可以输入，`@` 开头不冲突。
- 版本一次一发不可撤回（只能 `npm unpublish` 24h 内且被依赖就不行）。补丁先发 `0.1.1`，别改 `0.1.0`。

### 发布时实际会遇到的几件事（0.4.1 实测）

- **账号开了 WebAuthn 安全密钥时，`--otp=` 永远不可能成功**。npm 的 `otplease()` 只处理 6 位 TOTP，安全密钥要靠浏览器弹窗，非 TTY 的 CLI 触发不了，所以每次 `npm publish` / `npm trust` 都是
  `E403 … Two-factor authentication or granular access token with bypass 2fa enabled is required`。
  可行路径只有一条：在 **Tokens → Granular Access Token** 里勾 **Bypass two-factor authentication**（Organizations 选 **No access**，否则报 "You must select at least one organization…"），用这个 token 发布。
- **发布成功也可能先不完整**：新包第一次发布会返回 `202 Accepted` 和
  `notice Your package is being processed and may take a few minutes to become available`，
  此时 registry 上先出现占位版本 `0.0.0-stage`，自己能访问到的 `<包>-<版本>.tgz` 还是 **404**。这不是 staging 审核，也没有东西需要批准——等几分钟（实测约 2 分钟）就变成 200。**千万不要因为 404 就改版本号重发**，那会多出一个永远需要收尾的版本。
- **bypass token 只能发布、不能撤回**：`npm unpublish` 会报 `E403 … Granular access tokens that bypass two-factor authentication may not perform this action`。发错版本只能用 `npm dist-tag add <pkg>@<正确版本> latest` 纠正 `latest`，再 `npm deprecate` 标记错误版本。
- 发完用这三条确认（不需要浏览器）：
  ```sh
  npm view dsh-handy-toolkits version          # 期望 latest 版本号
  npm view dsh-handy-toolkits dist-tags        # latest 指向对的版本
  curl -sI "$(npm view dsh-handy-toolkits dist.tarball | tr -d '\"')" | head -1   # 期望 200
  ```

## 4. 别人怎么装

- **插件页（推荐）**：插件 → 已安装 → 添加插件 → 输入 `dsh-handy-toolkits`（或 `@you/dsh-handy-toolkits@0.1.0`）。GUI 装完会调用 `reconcile()`，把包登记进 profile 的 `dsh.profile.bundles`，所以重启后插件就在图里。
- **CLI**：`dsh plugin --profile desktop add dsh-handy-toolkits`（需要 App 完全退出）。注意 `dsh plugin` 只是**把参数转发给 profile 目录里的 pnpm**（见 `dsh plugin --help`），它会把包装进 `node_modules` 并写进 `dependencies`，但**不会**把包加进 `dsh.profile.bundles`——少了这一步插件装上了也不会加载。用 CLI 时要自己补一行：

  ```jsonc
  // ~/.dsh/profiles/desktop/package.json
  "dsh": { "profile": { "bundles": [ ... , "dsh-handy-toolkits" ] } }
  ```
- 也接受 `git+https://...`、`https://.../x.tgz`、本地绝对路径——但只有 npm/Git/tarball 才具备"更新"语义。

装好那一刻不会自动启用（除非点「立即启用」）；启用后重启生效。

> 自查"包本身有没有问题"：把名字手动加进 `dsh.profile.bundles` 后启动，Loader 图里应出现
> `{"id":"dsh-handy-toolkits","url":"plugins/??dsh-handy-toolkits/client.js&rev=…","inject":["slots"]}`。
> 图里有行 = 包内容与清单都对；没行 = 包没问题、是 profile 没登记。

## 5. 让插件被"发现"

### a. 官方「发现」页索引（format 1）

官方 Discover 读的是任意 https 上的 JSON。索引不一定要自己写——**一个 npm 包就能当索引源**：把 `index.json` 发到 npm，索引地址就是 `https://cdn.jsdelivr.net/npm/<包名>/index.json`。结构（校验器是 `@deepseek-ai/dsh-plugin-market-index`，未定义成员会被丢弃，缺的元数据组会补空）：

```json
{
  "format": 1,
  "title": { "en": "dsh-handy-toolkits", "zh": "整页缩放" },
  "plugins": [
    {
      "name": "dsh-handy-toolkits",
      "title": { "en": "Page zoom", "zh": "整页缩放" },
      "description": { "en": "Whole-page zoom for the DSH GUI.", "zh": "DSH 界面整页缩放。" },
      "author": "you",
      "homepage": "https://github.com/kuoxinxin/dsh-handy-toolkits",
      "repository": { "url": "https://github.com/kuoxinxin/dsh-handy-toolkits" },
      "versions": [
        {
          "version": "0.1.0",
          "publishTimestamp": 1761184200,
          "source": { "type": "npm" },
          "engines": { "dsh": ">=0.2.0-rc.2" }
        }
      ]
    }
  ]
}
```

硬性规则（违反第一条就整份文件读不出来）：

- 顶层 `format` 必须等于数字 `1`；`plugins` 必须是数组；`name` 必须是不重复的合法 npm 包名。
- 每个插件 `versions` 非空、每项有精确 SemVer `version` 和不重复、`publishTimestamp` 是 Unix 秒整数。
- `title`/`description` 是字符串或 `{ "en": "...", ... }`（**必须有 en**，语言 id 小写）。
- `icon` 若用相对路径，只能解析到 https 或索引自身 origin；内联 `data:` 图标解码后 ≤ 32 KiB。
- `source` 只有两种：`{ "type": "npm", "registry"?: "https://..." }` 或 `{ "type": "git", "url": "https://…", "commit": "<40 位小写 sha>", "path"?: "packages/x" }`。
- `metadata.category` / `labels` / `sortKeys` 只能引用索引顶层 `metadata` 里声明过的 id。

发布后：插件 → 发现 → 索引源 → 添加 `https://cdn.jsdelivr.net/npm/<你的包>/index.json`。用户可以加任意索引源，所以这条路你不需要任何人批准。

### b. 社区精选列表（dshmarket / awesome-dsh-plugin）

第三方市场 `dshmarket` 与 dshmarket.com、awesome-dsh-plugin.com 共用一份精选列表，条目来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 仓库：**在那边的列表里加一条、提 PR**即可，站点和插件市场会自动收录（CI 每日刷新，通常一天内生效）。插件市场应用自身不接收插件条目。

## 6. 兼容性、升级与常见坑

- `engines.dsh` 写成宽区间（`>=0.2.0-rc.2`）比精确版本友好；一旦不满足，安装会被 `incompatible-version` 直接拒绝，用户只能逐版本授权豁免（`dsh plugin allow-version`）。
- 只写 `peerDependencies` 里的 `@deepseek-ai/dsh*` 也能表达兼容性，但**不要和 `engines.dsh` 同时写**——后者单独决定。
- 已装插件的升级=先卸载再安装（官方按需插件除外），所以别在 patch 里改动别人的行 id。
- 客户端 bundle 只能 `require()` 基线模块表里的东西；要用别的包必须写进 `dsh.client.external`，否则组合阶段直接拒绝。
- `lib/client.js` 是手写/预构建的最终形态：它注册工厂，**模块顶层不能有副作用**（DOM 操作要放进 `factory` 里，或用 `ctx.effect` 挂载/清理）。

## 7. 发布检查清单

- [ ] `package.json`：`private` 已删除、`repository` 已指向自己的仓库、`version` 已 bump
- [ ] `dsh.bundle.patch` 指向的文件存在，`files` 里包含它
- [ ] `npm pack --dry-run` 里没有 `test/`、`docs/`、`node_modules`
- [ ] 用第 2 节的假安装跑过一次，Loader 图里出现自己的行
- [ ] `npm publish` 后用 `npm view <pkg> version` 复核
- [ ] （可选）索引 JSON 用官方校验器跑一遍，再加进「发现」页
- [ ] （可选）向 awesome-dsh-plugin 提 PR
