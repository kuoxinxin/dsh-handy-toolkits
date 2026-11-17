# Mermaid 看图器：缩放 / 全屏 / 拷贝

- 日期：2026-11-17
- 状态：待你确认（确认后才进入实现计划）
- 归属：`dsh-handy-toolkits` 的第三个 toolkit（Mermaid fence layer）之上继续加

## 为什么

聊天窗正文大约 700–900 px 宽。流程图一宽就被压小，序列图/ER 图节点一多就挤成一团，只能放大浏览器。另外两件事现在做不到：图转成 SVG 后，原来代码块上的复制按钮跟着消失，拿不到这段 mermaid 源码；也没有任何办法把图贴进文档、PPT 或其它聊天窗口。

你的选择：四种场景都要（看清细节、点开看大图、复制出去、演示），拷贝格式要 **PNG / SVG / 源码** 三种，不做另存为文件。

## 目标

1. **就地**：鼠标移到图上，右上角出现两个小按钮 —— `拷贝 ▾`、`全屏`。不占位、不挡文字。
2. **浮层查看器**：点图或点 `全屏` 打开，覆盖整个窗口；`−` / `100%` / `+` / `适应`、滚轮缩放（以指针为锚点）、拖动平移、双击在「适应」与「100%」之间切换、`Esc` 或点背景关闭。
3. **拷贝三格式**：PNG（2× 清晰度）、SVG（矢量）、mermaid 源码（带 ```mermaid 围栏）。
4. 主题跟随（明/暗），与整页 zoom 插件共存，仍然只依赖 `react`。

## 非目标

不做另存为文件、导出 PDF、编辑 mermaid 源码、标注、多图对比、缩略图导航、右键菜单、触屏手势（单指拖动除外）。

## 现状（实现要贴着这些事实做）

- bundle 里只有 `require("react")` 可用，**没有 react-dom**，所以没有 `createPortal`。
- 图是 `mermaid.render()` 返回的 SVG 字符串，塞进一个 `div` 的 `innerHTML`；SVG 自带 `width="100%"` 和 `max-width:<自然宽度>px`，容器 `maxWidth:100%` + `overflowX:auto`。
- mermaid 默认 `htmlLabels: true`，节点文字是 `<foreignObject>`；`canvas.drawImage(svg)` 不会画 `foreignObject` 里的字，**PNG 会丢字**。
- 整页 zoom 用 `documentElement.style.zoom` 实现，并装了 coordinate shim（把 `getBoundingClientRect` / `innerWidth` 除以 level）。任何铺满窗口的浮层如果不处理，会盖不满或错位。
- 已有一个共享 toast（`showToast`，`lib/client.js:27`）和语言判断（`speaksChinese`），拷贝反馈复用它。

## 方案

| 方案 | 取舍 |
|---|---|
| A. 就地全功能工具栏（±/100%/适应/全屏/拷贝 都挂在图上） | 聊天里常驻 6 个按钮太吵；图本身小，拖动缩放手感差 |
| B. 只做「点开看大图」，就地无按钮，拷贝也进浮层 | 界面最干净，但拷源码要先进浮层；用户不知道图能点 |
| **C. 就地两个按钮 + 浮层里做完整缩放（已选）** | 聊天中零噪音，拷贝一步到位；代价是两条代码路径，但共用同一个看图组件 |

## 关键决定

1. **浮层用原生 DOM 建，不用 React。** 没有 react-dom，最省事的 portal 不可用；而 `position:fixed` 在带 `transform`/`filter` 的祖先里会失灵。浮层直接 `document.createElement` 后 `appendChild` 到 `body`，事件与状态用闭包管理。React 只负责就地那两个按钮和宿主 `div`。
2. **浮层跟随整页 zoom，不暂停它。** 浮层挂在 `body` 里，所以它和其他内容一样被 root 的 `zoom` 缩放。尺寸直接取 `window.innerWidth/innerHeight` 报的值——装了坐标 shim 之后这两个值已经是 layout px（= visual px / level，1.5× 时是 960 而不是 1440），用它当 `width/height` 刚好铺满窗口。**不做 `zoom: 1/level` 反向缩放**（那会让浮层内字号比页面其它地方小）。
   - 只需要 zoom toolkit 暴露 `pageZoomLevel() -> number`，并在 `paint(level)` 时 `window.dispatchEvent(new CustomEvent("dsh-handy-toolkits:zoom", { detail: level }))`；浮层监听它重算尺寸，不重启页面。
3. **坐标系：一律 layout px，完全不碰 `getBoundingClientRect`。** shim 会把 rect 除以 level，浮层内再乘回去就双重补偿（1.5× 时全错）。浮层需要的量都能绕开它：
   - 可视尺寸 = `overlay.clientWidth/clientHeight`（shim 只 patch documentElement 的 clientWidth，非根元素报的就是 layout px，与 `window.innerWidth` 一致）；
   - 指针位置 = `event.clientX/clientY`（本身就是 layout px）；
   - 图的自然尺寸 = `svg.viewBox.baseVal.width/height`。
   所以浮层内不需要任何 level 换算：layout px 与世界坐标一致，painted 放大由浏览器的 zoom 自动完成。
   浮层里是 `overflow:hidden` 的 stage，里面 `transform: translate(tx,ty) scale(s)`、`transform-origin: 0 0` 的 canvas 包着 SVG。滚轮缩放按「指针位置在内容坐标里不变」求新的 `tx/ty`。
   - 同时暴露 `pageZoomLevel() -> number`，并在 `paint(level)` 时 `window.dispatchEvent(new CustomEvent("dsh-handy-toolkits:zoom", { detail: level }))`；浮层监听它重算尺寸，不重启页面。
3. **坐标系：一律 layout px，完全不碰 `getBoundingClientRect`。** shim 会把 rect 除以 level，而浮层已经按 layout 尺寸铺满，混用就会双重补偿（1.5× 时全错）。浮层需要的量都能绕开它：
   - 可视尺寸 = `overlay.clientWidth/clientHeight`（shim 只 patch documentElement 的 clientWidth，非根元素报的就是 layout px）；
   - 指针位置 = `event.clientX/clientY`（本就是 layout px）；
   - 图的自然尺寸 = `svg.viewBox.baseVal.width/height`。
   所以浮层内不需要任何 level 换算：layout px 与世界坐标一致，painted 放大由浏览器的 zoom 自动完成。
   浮层里是 `overflow:hidden` 的 stage，里面 `transform: translate(tx,ty) scale(s)`、`transform-origin: 0 0` 的 canvas 包着 SVG。滚轮缩放按「指针位置在内容坐标里不变」求新的 `tx/ty`。
4. **缩放范围 25%–800%**，按钮步进 1.25；打开时初始为「适应窗口」，但不超过 100%（小图不被拉大）。`100%` 的语义是「1 图 px = 当前页面缩放下 1 个 App px」，所以整页 zoom 150% 时，浮层里的图也比 100% 页面缩放下大 1.5 倍 —— 和页面上其他内容一致。
5. **平移**用 pointer events + `setPointerCapture`，只在内容比窗口大时启用；`cursor: grab / grabbing`。
6. **PNG**：用同一段源码、`htmlLabels:false` 在离屏容器里重渲染一份（屏幕上的观感不变），取 `<svg>` 元素、补 `width`/`height`/`xmlns`、序列化成 `image/svg+xml` Blob → `Image` → canvas（2× 缩放）→ `toBlob("image/png")` → `ClipboardItem({"image/png": blob})` → `navigator.clipboard.write`。背景填主题色，避免透明 PNG 在浅色文档里白字消失。
7. **SVG**：同一份序列化 SVG 写剪贴板；若 `ClipboardItem` 不接受 `image/svg+xml`（Chromium 版本差异），降级为复制源码并提示，不静默失败。
8. **源码**：`` ```mermaid\n<code>\n``` `` 写文本剪贴板。
9. **拷入口**：就地 `拷贝 ▾` 是点击展开的小菜单（PNG / SVG / 源码）；浮层工具栏是三个独立按钮。成功后用共享 toast：`已复制 PNG` / `已复制 SVG` / `已复制源码`；失败说明原因。
10. **打开方式**：单击图（pointerdown 后未发生拖动、且没有文本选区）打开浮层；`全屏` 按钮同样打开。图上的 `pointerdown` 不 `preventDefault`，保留选择图里文字的能力。
11. **键盘**：浮层内 `+`/`-`/`0`、`Esc`；浮层自己 `stopPropagation`，不外泄给 App 的快捷键。就地按钮可 Tab 聚焦，`focus-visible` 描边。
12. **层级**：浮层 `z-index: 2147482999`，压在 App 的菜单/浮层之上，但低于共享 toast（2147483000），这样拷贝反馈仍可见。
13. **整页 zoom 变化时**：浮层监听 `dsh-handy-toolkits:zoom`，重算自身尺寸，并按比例保持当前的相对缩放（不跳回「适应」）。

## 测试

- 纯函数：`fitScale` / `clampScale` / 锚点缩放后的 `translate`、`formatPercent` —— 单测，无 DOM。
- 就地：两个按钮存在、菜单项齐全、点击打开浮层、卸载后浮层一起消失。
- 浮层：`Esc` 关闭、`+`/`-`/`0`、滚轮缩放锚点、双击切换、拖动改变 `translate`、关闭时恢复整页 zoom。
- 拷贝：三种格式各自走到对应代码路径（stub `navigator.clipboard`、`ClipboardItem`、`canvas.toBlob`），失败路径给出提示。
- 现有 25 个测试继续全绿；新增测试同样用 `node --test`。

## 留给实现（不影响你要不要）

- 按钮图标：内联 SVG 还是 `⤢` / `⋯` 字形。
- 就地菜单：点击展开（默认）还是 hover 展开。
- 浮层背景：`rgba(0,0,0,.72)` 还是主题色不透明。
- 拷 PNG 的 2× 是否对超大图降到 1×（canvas 尺寸上限）。
- 是否额外给宽图一个「适应宽度」。