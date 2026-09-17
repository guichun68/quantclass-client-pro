# Windows 打包指南与踩坑记录

本文面向接手 Windows 打包的同学。README 里已有的提示不再重复，这里记录的是**实际构建过程中踩到的坑、根因和判定标准**，照着走可以少绕一大圈。

适用范围（本文所有命令与结论基于以下版本验证）：

| 组件 | 版本 |
| --- | --- |
| 应用 | quantclass 4.2.1 |
| Electron | 39.2.7 |
| electron-builder | 25.1.8 |
| electron-vite | 3.1.0（内置 Vite 5.4.21） |
| 构建机 | Windows 10 22H2（10.0.19045）x64 |
| 构建机 Node | v24.21.0（**可用，但不推荐**，见「坑 8」） |

---

## 一、最短路径

在 **Windows** 构建机上（必须 Windows，`build:win` 依赖 `chcp` / `tar` / NSIS，不能交叉编译）：

```powershell
# 0. 环境变量（国内网络强烈建议先设，见「坑 3」）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

# 1. pnpm 必须用 10.x，不要用 11（见「坑 1」）
npm i -g pnpm@10
pnpm -v

# 2. 安装依赖（会自动跑 postinstall = electron-builder install-app-deps）
pnpm install --registry=https://registry.npmmirror.com

# 3. 拉取内置 Python 运行时（可提前单独跑，便于提前暴露网络问题）
pnpm download-python

# 4. 打包
pnpm build:win
```

前置条件：Node ≥ 22（`package.json` 的 `engines`）、`curl.exe` 与 `tar.exe`（Win10 1803+ 自带，精简版镜像可能被裁掉）。

## 二、产物

| 路径 | 说明 |
| --- | --- |
| `dist\QuantclassClient-4.2.1.exe` | NSIS 安装包，交付用 |
| `dist\QuantclassClient-4.2.1.exe.blockmap` | 增量更新用，一并留存 |
| `dist\win-unpacked\` | **免安装绿色版**，整目录拷到 Win10 双击 `quantclass.exe` 即可 |
| `dist\builder-effective-config.yaml` | electron-builder 解析后的最终配置，排错时看它 |

安装行为（来自 `electron-builder.yml` + `build/win/installer.nsh`）：

- `perMachine: true` → **安装需要管理员权限**
- 默认目录 `C:\Quantclass`，且 `.onVerifyInstDir` 会强制把你选的目录再追加一层 `\Quantclass`
- `oneClick: false` → 有安装向导，可改目录
- 创建桌面 + 开始菜单快捷方式；卸载时删除 AppData 数据
- 可执行文件名是 `quantclass.exe`（`win.executableName`）
- **未配置代码签名** → 目标机首次运行会弹 SmartScreen「Windows 已保护你的电脑」，需点「更多信息 → 仍要运行」。内网分发时请附上这一句说明

---

## 三、踩坑记录

### 坑 1：`ERR_PNPM_IGNORED_BUILDS`（pnpm 11 不认旧白名单键）

**现象**

```
Error: ERR_PNPM_IGNORED_BUILDS
  x installing dependencies
  `-> Ignored build scripts: @biomejs/biome@1.9.4, @heroui/shared-utils@2.1.12,
      better-sqlite3@12.5.0, electron@39.2.7, esbuild@0.18.20, ... , lefthook@1.13.6
```

被忽略的清单恰好等于 `pnpm-workspace.yaml` 里 `onlyBuiltDependencies` 的内容 —— 说明**白名单根本没被读取**。

**根因**

- pnpm 10 起默认**不执行依赖的构建脚本**，靠白名单放行
- 本仓库的白名单写在 `pnpm-workspace.yaml`，这个位置需要较新的 pnpm 10（社区反馈 10.5+）
- **pnpm 11 把该键改名为 `allowBuilds`**，旧键不再生效，同时把这条提示**从警告升级为致命错误**

**为什么必须解决而不能绕过**

被拦掉的是 `electron`（不下载 Electron 二进制）和 `better-sqlite3`（不构建原生模块）。**用 `--config.strict-dep-builds=false` 把错误压成警告是无效的**：报错消失了，但二进制依然不存在，最后会变成「打包成功、目标机上启动崩溃」这种最难查的问题。

**解决（二选一）**

```powershell
# 方案 A（推荐）：把 pnpm 钉到 10，仓库本来就是按 pnpm 10 配的
npm i -g pnpm@10
# 或 corepack enable && corepack use pnpm@10

# 方案 B：留在 pnpm 11，补上新键
pnpm approve-builds   # 交互式勾选，让它自己写 allowBuilds
```

方案 B 的 `allowBuilds` 请**不要手写** —— 该键在两个大版本间改过名也改过结构，手写容易再踩一次。

**长期修复**：在 `package.json` 加 `"packageManager": "pnpm@10.26.0"`，让 corepack 自动选对版本。

### 坑 2：`better-sqlite3` 安装失败的真正根因是网络，不是 Python

**现象**

```
.../node_modules/better-sqlite3 install$ prebuild-install || node-gyp rebuild --release
prebuild-install warn install read ECONNRESET
gyp ERR! find Python Python is not set from command line or npm configuration
gyp ERR! find Python THIS VERSION OF PYTHON IS NOT SUPPORTED     ← 刷屏几十行
ELIFECYCLE  Command failed with exit code 1
```

**根因**

`better-sqlite3` 的安装脚本是「**先下载预编译 `.node` 二进制，失败才回退到本地编译**」。第一段 `prebuild-install` 被网络中断（`ECONNRESET`），第二段 `node-gyp rebuild` 需要 Python + MSVC，构建机上都没有。

> ⚠️ **关键认知：后面所有 `gyp ERR! find Python` 都是退路上的噪音，根因只有一个 —— 预编译二进制下不下来。** 不要一看到 Python 报错就去装 Python，先修网络。

**解决优先级**

1. **让预编译二进制下得下来**（最优）。先确认是不是纯网络问题：

   ```powershell
   node -p "process.versions.modules"   # Node 24 → 137
   curl.exe -I -L "https://github.com/WiseLibs/better-sqlite3/releases/download/v12.5.0/better-sqlite3-v12.5.0-node-v137-win32-x64.tar.gz"
   ```

   返回 200 就是通的（`ECONNRESET` 可能只是抖动，重跑即可）；超时/重置则上代理或 binary 镜像：

   ```powershell
   $env:HTTP_PROXY="http://127.0.0.1:7890"
   $env:HTTPS_PROXY="http://127.0.0.1:7890"
   # 或（prebuild-install 认这个环境变量，用前先 curl 验证镜像路径存在）
   $env:npm_config_better_sqlite3_binary_host_mirror="https://registry.npmmirror.com/-/binary/better-sqlite3"
   ```

   怀疑缓存被半截文件污染时，清 `%LOCALAPPDATA%\prebuild-install` 与 `~\.npm\_prebuilds`。

2. **从装成功的机器拷 `node_modules`**（含 `.pnpm`）。原生模块绑定的是 **Node/Electron 版本 + 系统 + 架构**，**不绑定机器** —— 同为 Windows x64、同为 Electron 39.2.7 时可直接复用。有第二条构建机时这比装编译器便宜得多。

3. **装编译链**（最后手段，约 6–7 GB）：Python 3 进 PATH（或 `npm config set python "..."`）+ Visual Studio Build Tools 勾选「使用 C++ 的桌面开发」。

   ⚠️ **编完必须再跑一次**，否则拿到的是 Node ABI 而非 Electron ABI：

   ```powershell
   pnpm exec electron-builder install-app-deps
   ```

   注意 `bin/rebuild.js` 在 win32 上**直接 return 不重建**（源码里 `if (platform() === "win32") return false`），`prebuild` 钩子帮不上忙，这步只能手动。

### 坑 3：网络贯穿全程，有四个下载源要分别处理

**现象**：`WARN Tarball download average speed 25 KiB/s ... (69 other warnings)` —— 说明没走国内镜像。

| 下载源 | 时机 | 处理方式 |
| --- | --- | --- |
| npm registry | `pnpm install` | `--registry=https://registry.npmmirror.com` |
| Electron 二进制（`pnpm install` 阶段） | electron 的 postinstall | `$env:ELECTRON_MIRROR`（`@electron/get` 认这个变量） |
| Electron 二进制（打包阶段） | electron-builder 打包 | `electron-builder.yml` 里已配 `electronDownload.mirror`，实测 137 MB / 2.9 s |
| electron-builder 工具包 | 打包时 | `$env:ELECTRON_BUILDER_BINARIES_MIRROR` |
| Python standalone 运行时 | `download-python` | `$env:PYTHON_MIRROR` |

> 注意：`.npmrc` 里的 `electron_mirror` 是**注释掉的**，等于没生效；`electron-builder.yml` 的 `electronDownload.mirror` 只影响打包阶段，**管不到 `pnpm install` 时 electron 自己的 postinstall 下载**。两者要分别设置。

### 坑 4：`winCodeSign` 首次下载超时 —— 虚惊，别中断构建

**现象**

```
⨯ Get "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z": ... failed to respond
github.com/develar/app-builder/pkg/download.(*Downloader).follow ...
  • Above command failed, retrying 3 more times
  • downloading     url=...winCodeSign-2.6.0.7z size=5.6 MB parts=1
  • downloaded      url=...winCodeSign-2.6.0.7z duration=3.696s
```

那个 `⨯` 加一大段 Go 堆栈**长得很像致命错误，其实只是第一次超时**，electron-builder 随后自动重试并成功了。**看到它就 ctrl+c 是自找麻烦，让它跑完。**

### 坑 5：`no signing info identified, signing is skipped` 刷屏

electron-builder 会对包里每个 `.exe` 尝试签名，没有证书就逐个跳过 —— 内置 Python 运行时里有几十个 exe（`python.exe`、`setuptools\cli.exe`、`pip` 里的 `t32.exe` 等），所以会刷屏几十行。**预期行为，不用管。**

### 坑 6：成功构建的判定标准

不要只看有没有红色的 `⨯`，按这几条判定：

1. 输出**没有** `ELIFECYCLE` / 非零退出，命令行干净回到提示符
2. 最后一行是 `building block map blockMapFile=dist\QuantclassClient-4.2.1.exe.blockmap` —— **blockmap 是 NSIS 打包的收尾步骤**，能走到这里说明安装包已写完
3. 三段流水线全绿：`electron-vite build`（main / preload / renderer 都 `✓ built`）→ `@electron/rebuild` → `electron-builder`
4. **`@electron/rebuild` 这几行是关键证据**：

   ```
   • executing @electron/rebuild  electronVersion=39.2.7 arch=x64 buildFromSource=false
   • preparing       moduleName=better-sqlite3 arch=x64
   • finished        moduleName=better-sqlite3 arch=x64
   • completed installing native dependencies
   ```

   `buildFromSource=false` + `finished` 说明按 **Electron 的 ABI** 拿到了预编译产物，没有走源码编译 —— 坑 2 已经绕过去了。

### 坑 7：构建后必须验证，否则会「打包成功、运行崩溃」

```powershell
cd <repo>

# 产物
Get-ChildItem dist | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}, LastWriteTime

# 原生模块（最容易静默出问题的东西）
Test-Path node_modules\better-sqlite3\build\Release\better_sqlite3.node   # 必须 True

# 关键运行时资源
Test-Path dist\win-unpacked\quantclass.exe
Test-Path dist\win-unpacked\resources\python\python.exe
Test-Path dist\win-unpacked\resources\parse_config.py
Test-Path dist\win-unpacked\resources\vs          # monaco 编辑器
Test-Path dist\win-unpacked\resources\app.asar

# afterPack 钩子是否生效（只该剩 en / zh 语言包）
Get-ChildItem dist\win-unpacked\locales | Select-Object -ExpandProperty Name
```

`better_sqlite3.node` 缺失或 ABI 不对时，**打包环节不报任何错**，装到目标机启动才崩。

**最终验证只有一个办法 —— 跑起来**：

```powershell
.\dist\win-unpacked\quantclass.exe     # 免安装版，最快
```

启动后重点确认两件事（正是本次踩过坑的两处）：界面能打开并能登录；本地数据/配置能读写（验证 **better-sqlite3** 与内置 **Python 解析 `config.py`**）。

### 坑 8：Node 版本没被这个项目验证过

构建机当时是 **Node v24.21.0**（能用），但：

- `package.json` 的 `engines` 是 `>=22`
- `.github/workflows/build.yml` 用的是 **Node 20**
- Electron 39 内置 Node 22.x

三个都不一样。**建议统一到 Node 22 LTS**，与开发机和 Electron 内置版本对齐，减少原生模块编译的变数。

### 坑 9：README 已记录的老坑（这里只做索引）

- **Defender 实时防护**会锁住 `win-unpacked` 里的文件导致打包失败 → 打包前关掉
- **`!include` 报错** → 清 `%LOCALAPPDATA%\electron-builder\Cache`，并在 `gpedit.msc` → 计算机配置 → 管理模板 → 系统 → 文件系统 中启用 **Win32 长路径**，然后删 `node_modules` 重启
- **`build:win` 是 cmd 语法**（`chcp 65001 && ...`）。通过 `pnpm run` 执行时 pnpm 用 cmd.exe，没问题；但在 **PowerShell 5.1 里手敲 `&&` 会报错**（PS7 才支持）

---

## 四、排错决策树

```
pnpm install 报 ERR_PNPM_IGNORED_BUILDS
  └─ pnpm -v 是 11.x ? → 降到 pnpm@10，或 pnpm approve-builds
     pnpm -v 是 10.x ? → 检查全局 .npmrc / 环境变量是否开了 strict-dep-builds

pnpm install 报 gyp ERR! find Python
  └─ 先看上面有没有 prebuild-install ... ECONNRESET
     ├─ 有 → 网络问题，修网络/上镜像，别急着装 Python
     └─ 无 → 才考虑装 Python + VS Build Tools

pnpm build:win 中途出现 ⨯ Get ... failed to respond
  └─ 看下一行有没有 "retrying 3 more times" → 有就等着，别中断

pnpm build:win 结束但没有 dist\*.exe
  └─ 看最后一行是不是 blockmap；不是就往回找第一个 ELIFECYCLE / error
```

## 五、其他打包命令

```powershell
pnpm build:unpack      # 只出 dist\win-unpacked（免安装绿色版），最快
pnpm build:win:beta    # 内测版，安装包文件名带时间戳
pnpm publish:win       # 打包并发布（需要 GITHUB_TOKEN）
```

不需要 `.env`：`electron.vite.config.ts` 与 `src/main/vars.ts` 都默认 `https://api.quantclass.cn`。要换后端就建 `.env` 写 `VITE_BASE_URL=...`。

## 六、提效提示

- electron-builder 下载的工具包（winCodeSign / nsis / nsis-resources）和 Electron 都缓存在 `%LOCALAPPDATA%\electron-builder\Cache`，**别清** —— 坑 4 那些几十秒的重试能直接省掉
- `pnpm download-python` 在 `resources\python\<arch>\.python-version` 写标记，版本未变时自动跳过下载
- `Browserslist: browsers data is 9 months old` 和 renderer 那个约 10 MB 的 `index-*.js`（monaco 编辑器体积导致）都只是警告，不影响功能
