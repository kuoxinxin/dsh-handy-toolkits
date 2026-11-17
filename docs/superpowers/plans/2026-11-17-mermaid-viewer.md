# Mermaid Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a ```` ```mermaid ```` fence in the chat be opened at full size (zoom, pan, fit, full screen) and copied out as PNG, SVG or source.

**Architecture:** Everything stays inside the existing hand-written bundle `lib/client.js` (the loader serves exactly one file per plugin, so no new modules on disk). A new `//#region toolkit: mermaid viewer` holds four things: pure geometry helpers, clipboard writers, a native-DOM overlay appended to `body`, and a default viewer object that the fence component calls. The fence component gains a hover toolbar (copy menu + full screen) and a click-to-open handler. The page-zoom toolkit gains `pageZoomLevel()` and a `dsh-handy-toolkits:zoom` window event so the overlay resizes when the page zoom changes.

**Tech Stack:** plain ESM in `window.__ModuleLoader__.load(...)`, the `react` peer only (`require("react")`), native DOM for the overlay, `ClipboardItem` + canvas for images, `node:test` with a hand-written DOM stub for tests.

**Spec:** `docs/superpowers/specs/2026-11-17-mermaid-viewer-design.md`

## Global Constraints

- One bundle file: all production code goes into `lib/client.js`, inside the existing factory. Never add a second served file (only `./client` is served, and package-local chunk URLs are rev-coupled).
- Only one import is allowed: `require("react")`. No `react-dom`, no `react-dom/client`, no new dependencies in `package.json`.
- The overlay must respect the page zoom (never suspend it) and must never call `getBoundingClientRect()`: the coordinate shim divides those rects by the zoom level. Use `window.innerWidth/innerHeight`, `element.clientWidth`, `event.clientX/clientY`, and `svg.viewBox.baseVal` only.
- All sizes and offsets in the overlay are **layout px** (the coordinate space `window.innerWidth` reports once the shim is installed).
- Scale range `0.25`–`8`, button step `1.25`, rounded to 3 decimals; the label reads `Math.round(scale * 100) + "%"`.
- User-facing strings are bilingual: pick with the existing `speaksChinese()` helper (`已复制 PNG` / `Copied PNG`, `全屏` / `Full screen`, `拷贝` / `Copy`, `适应` / `Fit`).
- Toasts go through the shared `showToast(message)`; failure toasts must name the reason (`复制失败：…` / `Copy failed: …`).
- Every existing test keeps passing; `npm test` (which runs `node --test`) exits with `25 + new` passing tests.
- Commit messages: conventional commits, English, imperative (`feat: …`, `fix: …`, `docs: …`).
- Plugin version becomes `0.4.0`; the installed copy at `~/.dsh/profiles/desktop/plugins/dsh-handy-toolkits` is refreshed at the end (`./install.sh` is idempotent).

## Review Focus

Each line names an input or condition the spec implies but the task tests would otherwise leave unpinned; the task in brackets owns it.

1. A page zoom other than 100% while the overlay is open — the overlay must still cover the window exactly, with no double compensation and no horizontal scrollbar. [Task 6]
2. A diagram whose `viewBox` is far larger than the window (e.g. 4000×3000) — the PNG path must not allocate an absurd canvas; raster width is capped at 4096 px. [Task 3]
3. Clipboard permission denied or `ClipboardItem` missing — the copy must fail loudly with a toast, never as an unhandled rejection or a silent no-op. [Task 3, Task 5]
4. The fence text changes (stream finishes, or a new message re-uses the component) while the overlay is open — the overlay keeps the diagram it was opened with and does not crash. [Task 5]
5. A theme flip while the overlay is open — the overlay keeps its captured theme (documented behaviour), and a PNG copied after the flip still uses the captured theme. [Task 4, Task 5]

---

### Task 1: Page zoom publishes its level

**Files:**
- Modify: `lib/client.js` — `//#region toolkit: page zoom` (`paint`, `mountZoom`) and its exports
- Test: `test/client.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pageZoomLevel(): number` (current painted level, `1` before mount), the constant `ZOOM_EVENT = "dsh-handy-toolkits:zoom"`, and a `window` event of that name carrying `detail: level` on every `paint()`. Later tasks read the level to size the overlay and listen to the event to resize it.

- [ ] **Step 1: Extend the test environment with `CustomEvent` and `window.dispatchEvent`**

In `createEnvironment()` (after the `window` literal), add:

```js
globalThis.CustomEvent = class CustomEvent {
	constructor(type, init = {}) {
		this.type = type;
		this.detail = init.detail;
	}
};
window.dispatchEvent = (event) => {
	for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);
	return true;
};
```

- [ ] **Step 2: Write the failing test**

```js
test("page zoom publishes its level on every change", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const seen = [];
	environment.window.addEventListener("dsh-handy-toolkits:zoom", (event) => seen.push(event.detail));
	const dispose = mount(environment, client);
	assert.equal(client.__test.pageZoomLevel(), 1);
	press(environment, "Equal");
	assert.equal(client.__test.pageZoomLevel(), 1.1);
	press(environment, "Equal");
	assert.equal(client.__test.pageZoomLevel(), 1.2);
	press(environment, "Digit0");
	assert.equal(client.__test.pageZoomLevel(), 1);
	assert.deepEqual(seen, [1, 1.1, 1.2, 1]);
	dispose();
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test`
Expected: FAIL — `client.__test.pageZoomLevel is not a function`.

- [ ] **Step 4: Implement**

In the page-zoom region, above `function paint(level)`:

```js
const ZOOM_EVENT = "dsh-handy-toolkits:zoom";
/** The level currently painted on the root; `1` until the toolkit mounts. */
let currentLevel = 1;
function pageZoomLevel() {
	return currentLevel;
}
```

Inside `paint(level)`, after `syncShim(level)`:

```js
currentLevel = level;
if (typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: level }));
```

Add `pageZoomLevel` and `ZOOM_EVENT` to the `exports.__test` object at the bottom of the factory.

- [ ] **Step 5: Run the tests**

Run: `node --test`
Expected: 26 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add lib/client.js test/client.test.mjs
git commit -m "feat: publish the page zoom level to other toolkits"
```

---

### Task 2: Viewer geometry helpers

**Files:**
- Modify: `lib/client.js` — new region `//#region toolkit: mermaid viewer` placed directly after the mermaid-diagrams region
- Test: `test/client.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (all pure, all exported through `__test`):
  - `clampViewerScale(scale: number): number` — non-finite → `1`; else clamp to `[0.25, 8]`, rounded to 3 decimals.
  - `fitViewerScale(viewWidth, viewHeight, contentWidth, contentHeight): number` — `min(viewWidth/contentWidth, viewHeight/contentHeight)` capped at `1`, floored at `clampViewerScale`'s minimum; any non-finite or non-positive argument → `1`.
  - `zoomAroundPoint(state: {scale, x, y}, factor, anchorX, anchorY): {scale, x, y}` — keeps the point under the anchor fixed.
  - `formatScale(scale): string` — `Math.round(scale * 100) + "%"`.

- [ ] **Step 1: Write the failing tests**

```js
test("viewer scales clamp to the supported range", async () => {
	const client = await loadClient(createEnvironment());
	assert.equal(client.__test.clampViewerScale(0.1), 0.25);
	assert.equal(client.__test.clampViewerScale(20), 8);
	assert.equal(client.__test.clampViewerScale(1.23456), 1.235);
	assert.equal(client.__test.clampViewerScale(Number.NaN), 1);
});

test("fit never magnifies and floors at the minimum scale", async () => {
	const client = await loadClient(createEnvironment());
	assert.equal(client.__test.fitViewerScale(1200, 800, 600, 400), 1);
	assert.equal(client.__test.fitViewerScale(400, 300, 800, 600), 0.5);
	assert.equal(client.__test.fitViewerScale(400, 300, 4000, 3000), 0.25);
	assert.equal(client.__test.fitViewerScale(1200, 800, 0, 0), 1);
});

test("zooming keeps the anchor point fixed", async () => {
	const client = await loadClient(createEnvironment());
	const state = { scale: 1, x: 100, y: 50 };
	assert.deepEqual(client.__test.zoomAroundPoint(state, 2, 200, 150), { scale: 2, x: 0, y: -50 });
	const clamped = client.__test.zoomAroundPoint({ scale: 8, x: 0, y: 0 }, 2, 10, 10);
	assert.deepEqual(clamped, { scale: 8, x: 0, y: 0 });
	assert.equal(client.__test.formatScale(1.25), "125%");
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test`
Expected: FAIL — `clampViewerScale is not a function`.

- [ ] **Step 3: Implement the four helpers**

Constants: `VIEWER_MIN_SCALE = 0.25`, `VIEWER_MAX_SCALE = 8`, `VIEWER_STEP = 1.25`, `VIEWER_Z_INDEX = "2147482999"`, `VIEWER_CLASS = "dsh-handy-toolkits-viewer"`.
Rounding: `Math.round(value * 1000) / 1000`. `zoomAroundPoint` computes `next = clampViewerScale(state.scale * factor)`; when `next === state.scale` it returns `{ scale: next, x: state.x, y: state.y }`; else `ratio = next / state.scale` and `{ scale: next, x: anchorX - (anchorX - state.x) * ratio, y: anchorY - (anchorY - state.y) * ratio }`.

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: 29 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add lib/client.js test/client.test.mjs
git commit -m "feat: add mermaid viewer geometry helpers"
```

---

### Task 3: Copy a diagram as PNG, SVG or source

**Files:**
- Modify: `lib/client.js` — inside `//#region toolkit: mermaid viewer`
- Test: `test/client.test.mjs`

**Interfaces:**
- Consumes: `MERMAID_CONFIG`, `ensureEngine`, `engine` (module-level engine holder), `showToast`-independent (these functions throw, the caller toasts).
- Produces (all async, all exported through `__test`):
  - `copyDiagramSource(code: string): Promise<"source">` — writes a fenced block; throws `Error("clipboard unavailable")` when `navigator.clipboard.writeText` is missing.
  - `copyDiagramSvg({ svg, code }): Promise<"svg" | "source">` — writes `image/svg+xml`; returns `"source"` after falling back to source when `ClipboardItem` or `navigator.clipboard.write` is unavailable/rejects.
  - `copyDiagramPng({ code, theme }): Promise<"png">` — re-renders with `htmlLabels: false`, rasterises to a PNG at 2× (capped at 4096 px wide), writes it via `ClipboardItem`.
  - `renderForRaster(code, theme): Promise<string>` — the `htmlLabels: false` render used by the PNG path (exported too, so a test can pin the option).
  - `svgTextToPngBlob(svgText, { background }): Promise<Blob>` — `Image` + `<canvas>` rasteriser.

- [ ] **Step 1: Extend the test environment with clipboard, `ClipboardItem`, `Image` and canvas stubs**

Add to `createEnvironment()`, next to the `navigator` definition: `navigator.clipboard = { writeText(text), write(items) }` recording into `state.clipboardText` / `state.clipboardItems` (the existing `writeText` already records the text — extend the object in the same getter). Add globals:

```js
globalThis.ClipboardItem = class ClipboardItem {
	constructor(items) {
		this.items = items;
	}
};
globalThis.Image = class Image {
	set src(value) {
		this._src = value;
		queueMicrotask(() => this.onload?.());
	}
};
```

`document.createElement("canvas")` returns a node that also records itself in `state.canvases` and exposes `{ width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect() {}, drawImage(...args) { state.drawn.push(args); } }), toBlob(callback) { callback(state.pngBlob); } }`; set `state.pngBlob = new Blob(["png"], { type: "image/png" })` and `state.canvases = []` in the environment. The `write(items)` stub must reject when `state.clipboardRejects` is `true`, so the fallback path is testable.

- [ ] **Step 2: Write the failing tests**

```js
test("copying the source writes a fenced mermaid block", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	assert.equal(await client.__test.copyDiagramSource("graph TD; A-->B"), "source");
	assert.equal(environment.state.clipboardText, "```mermaid\ngraph TD; A-->B\n```");
});

test("the PNG path re-renders without html labels and writes one image item", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const engine = createFakeEngine();
	client.__test.setEngine(engine);
	assert.equal(await client.__test.copyDiagramPng({ code: "graph TD; A-->B", theme: "dark" }), "png");
	assert.equal(engine.calls.render.length, 1);
	assert.equal(engine.calls.render[0].htmlLabels, false);
	const [item] = environment.state.clipboardItems;
	assert.ok(item.items["image/png"]);
});

test("SVG copy falls back to the source when the clipboard rejects images", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	environment.state.clipboardRejects = true;
	const result = await client.__test.copyDiagramSvg({ svg: "<svg/>", code: "graph TD; A-->B" });
	assert.equal(result, "source");
	assert.equal(environment.state.clipboardText, "```mermaid\ngraph TD; A-->B\n```");
});

test("a huge diagram is rasterised at a capped pixel width", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	client.__test.setEngine(
		createFakeEngine({
			async render() {
				return '<svg viewBox="0 0 8000 6000"></svg>';
			}
		})
	);
	await client.__test.copyDiagramPng({ code: "graph TD; A-->B", theme: "light" });
	assert.ok(environment.state.canvases.at(-1).width <= 4096);
});

test("a missing clipboard raises instead of failing silently", async () => {
	const environment = createEnvironment();
	environment.state.clipboard = false;
	const client = await loadClient(environment);
	await assert.rejects(() => client.__test.copyDiagramSource("graph TD; A-->B"), /clipboard unavailable/);
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `node --test`
Expected: FAIL — `copyDiagramSource is not a function`.

- [ ] **Step 4: Implement**

Extend the engine contract instead of bypassing it: `bundledEngine.render(mermaid, code, theme, options = {})` initialises with `{ ...MERMAID_CONFIG, theme, htmlLabels: options.htmlLabels !== false, flowchart: { htmlLabels: options.htmlLabels !== false } }` and `renderForRaster` passes `{ htmlLabels: false }`. In `createFakeEngine()`, `async render(engine, code, theme, options = {})` records `calls.render.push({ code, theme, ...options })` (spreading `{}` keeps the existing deep-equal assertions at `test/client.test.mjs:692` intact) and still returns `` `<svg data-theme="${theme}">${code}</svg>` ``.
PNG rasterisation: derive `width/height` from the `<svg>` string's `viewBox` attribute (regex `viewBox="x y w h"`), fall back to `clientWidth=800, clientHeight=600`; `scale = Math.min(2, 4096 / width)`; canvas size `Math.round(width * scale) × Math.round(height * scale)`; `background` is `theme === "dark" ? "#1c1c1e" : "#ffffff"`.
Clipboard writes: `navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])`.

- [ ] **Step 5: Run the tests**

Run: `node --test`
Expected: 34 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add lib/client.js test/client.test.mjs
git commit -m "feat: copy mermaid diagrams as png, svg or source"
```

---

### Task 4: The full-screen viewer overlay

**Files:**
- Modify: `lib/client.js` — inside `//#region toolkit: mermaid viewer`
- Test: `test/client.test.mjs`

**Interfaces:**
- Consumes: `clampViewerScale`, `fitViewerScale`, `zoomAroundPoint`, `formatScale`, `pageZoomLevel`, `ZOOM_EVENT`, `readTheme`, `speaksChinese`, `showToast`.
- Produces:
  - `openViewer({ svg, code, theme }): { overlay, stage, state(): {scale, x, y}, close(): void }` — builds the overlay in `body` and returns its handle; `overlay` is the root node, `stage` the pan/zoom surface, `state()` a snapshot for tests, and calling `close()` twice is a no-op.
  - `naturalSize(svgText: string): { width, height } | undefined` — parses `viewBox`, falls back to `width`/`height` attributes.
  - The overlay root carries `data-dsh-handy-toolkits-viewer`, class `dsh-handy-toolkits-viewer`, `role="dialog"`, `aria-modal="true"`, and inline `z-index: 2147482999`.
  - Toolbar buttons carry `data-viewer-action` values `out`, `in`, `fit`, `close`; the middle label carries `data-viewer-action="scale"`.

- [ ] **Step 1: Replace the minimal `document.createElement` stub with a small DOM**

In `createEnvironment()`, `document.createElement(tag)` returns an object created by a `FakeElement` class that keeps the old surface (`tagName`, `id`, `textContent`, `value`, `style` with `cssText` and arbitrary properties, `attributes`, `setAttribute`, `remove`, `select`) and adds `children`, `parentNode`, `appendChild(child)`, `removeChild(child)`, `addEventListener(type, fn)`, `removeEventListener(type, fn)`, `dispatchEvent(type, event)` (calls the handlers of that type with `{ target: this, currentTarget: this, ...event }`), and a `classList` with `add`/`remove`/`contains` backed by `className`. `remove()` also detaches the node from `parentNode.children`. `document.body.appendChild` keeps pushing into `environment.appended`.

- [ ] **Step 2: Run the existing tests to prove the stub swap is safe**

Run: `node --test`
Expected: 34 passing, 0 failing.

- [ ] **Step 3: Write the failing tests**

```js
test("openViewer covers the window, wires the buttons and closes on Escape", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	const handle = client.__test.openViewer({ svg: '<svg viewBox="0 0 400 300"></svg>', code: "graph TD; A-->B", theme: "light" });
	const overlay = environment.document.body.children.at(-1);
	assert.equal(overlay.attributes["data-dsh-handy-toolkits-viewer"], "");
	assert.equal(overlay.attributes["data-viewer-theme"], "light");
	assert.equal(overlay.style.width, "1440px");
	assert.equal(overlay.style.height, "900px");
	assert.equal(actionOf(overlay, "scale").textContent, "100%");
	actionOf(overlay, "in").dispatchEvent("click", {});
	assert.equal(actionOf(overlay, "scale").textContent, "125%");
	actionOf(overlay, "fit").dispatchEvent("click", {});
	assert.equal(actionOf(overlay, "scale").textContent, "100%");
	environment.window.dispatchEvent({ type: "keydown", key: "Escape" });
	assert.equal(overlay.isConnected, false);
	handle.close();
	assert.equal(overlay.isConnected, false);
});

test("wheel zoom keeps the pointer anchored", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	const handle = client.__test.openViewer({ svg: '<svg viewBox="0 0 400 300"></svg>', code: "graph TD; A-->B", theme: "light" });
	const stage = handle.stage;
	stage.dispatchEvent("wheel", { clientX: 100, clientY: 100, deltaY: -1, preventDefault() {} });
	assert.equal(handle.state().scale, 1.25);
	assert.ok(handle.state().x < 0 && handle.state().y < 0, "the point under the pointer stays put");
	handle.close();
});

test("a page zoom change resizes the overlay instead of restarting it", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	const handle = client.__test.openViewer({ svg: '<svg viewBox="0 0 400 300"></svg>', code: "graph TD; A-->B", theme: "light" });
	const overlay = environment.document.body.children.at(-1);
	environment.state.innerWidth = 960;
	environment.state.innerHeight = 600;
	environment.window.dispatchEvent({ type: "dsh-handy-toolkits:zoom", detail: 1.5 });
	assert.equal(overlay.style.width, "960px");
	assert.equal(overlay.style.height, "600px");
	handle.close();
});
```

`actionOf(overlay, action)` is a helper the plan's implementer adds near `textOf`: walk `overlay.children` recursively and return the first node whose `attributes["data-viewer-action"] === action`.

- [ ] **Step 4: Run them and watch them fail**

Run: `node --test`
Expected: FAIL — `openViewer is not a function`.

- [ ] **Step 5: Implement `openViewer`**

Structure: `overlay` (fixed, `inset:0`, background `rgba(0,0,0,.72)`, `display:flex`, `align-items:center`, `justify-content:center`, `z-index: 2147482999`) → `stage` (fixed size `window.innerWidth × window.innerHeight`, `overflow:hidden`, `cursor:grab`, `touch-action:none`) → `canvas` div (`transform-origin: 0 0`, `transform: translate(x px, y px) scale(s)`, `width/height` = natural size) → the SVG string is assigned to `canvas.innerHTML`.
State: `{ scale, x, y }`; `fit()` computes `fitViewerScale(stage.clientWidth, stage.clientHeight, natural.width, natural.height)` and centres (`x = (stage.clientWidth - natural.width * scale) / 2`, same for `y`); `apply()` writes `canvas.style.transform` and the label.
Buttons: `+`/`−` zoom around the stage centre (`stage.clientWidth / 2`), `适应` re-fits, `✕` closes, the label button resets to `1` centred. Wheel handler (`{ passive: false }`) maps `deltaY < 0` to `×1.25` else `÷1.25` and anchors on `event.clientX - stageOffsetX` where `stageOffsetX` is `0` because the stage starts at the window origin. Pan: `pointerdown` records the position and `setPointerCapture`; `pointermove` translates; `pointerup` releases. `dblclick` toggles between `1` and the fit scale. `keydown` on `window` (capture) handles `Escape` (close), `+`/`-`/`0`; every handled key calls `stopPropagation()`.
Cleanup: remove the `window` keydown, `window` resize, `ZOOM_EVENT` listeners, `overlay.remove()`, and `showToast` nothing.

- [ ] **Step 6: Run the tests**

Run: `node --test`
Expected: 37 passing, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add lib/client.js test/client.test.mjs
git commit -m "feat: open a mermaid diagram in a zoomable overlay"
```

---

### Task 5: Fence toolbar — copy menu, full screen, click to open

**Files:**
- Modify: `lib/client.js` — `//#region toolkit: mermaid diagrams` (the `MermaidFence` render method and `mountMermaid`), `//#region toolkit: mermaid viewer` (the `defaultViewer` object and `installViewerStyle()`)
- Test: `test/client.test.mjs`

**Interfaces:**
- Consumes: `openViewer`, `copyDiagramPng`, `copyDiagramSvg`, `copyDiagramSource`, `showToast`, `speaksChinese`.
- Produces:
  - `const defaultViewer = { open: openViewer, copyPng: copyDiagramPng, copySvg: copyDiagramSvg, copySource: copyDiagramSource }`, a module-level `let viewer = defaultViewer`, and `__test.setViewer(next)` (also exposed as `__test.defaultViewer` so a test can wrap one member).
  - `installViewerStyle(): void` — appends one `<style id="dsh-handy-toolkits-viewer-style">` to `document.head` when absent; the rules keep the toolbar hidden until hover/focus-within.
  - The fence renders, in order: the existing `div.dsh-handy-toolkits-mermaid` (SVG host, unchanged so old tests keep passing), then `div.dsh-handy-toolkits-mermaid-actions` with `button.dsh-handy-toolkits-mermaid-copy` (label `拷贝 ▾` / `Copy ▾`), a menu `div.dsh-handy-toolkits-mermaid-menu` (buttons labelled `PNG`, `SVG`, `源码`/`Source`), and `button.dsh-handy-toolkits-mermaid-expand` (label `全屏` / `Full screen`).

- [ ] **Step 1: Write the failing tests**

```js
test("the fence toolbar opens the viewer with the diagram it shows", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const opened = [];
	client.__test.setViewer({ ...client.__test.defaultViewer, open: (options) => opened.push(options) });
	const engine = createFakeEngine();
	const { instance } = await mountFence(environment, client, { code: "graph TD; A-->B", streaming: false, children: "CODE" }, engine);
	const button = findClass(instance.render(), "dsh-handy-toolkits-mermaid-expand");
	button.props.onClick({ stopPropagation() {} });
	assert.equal(opened.length, 1);
	assert.equal(opened[0].code, "graph TD; A-->B");
	assert.match(opened[0].svg, /^<svg/);
	assert.equal(opened[0].theme, "light");
});

test("the copy menu shows one toast per format and reports failures", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const calls = [];
	client.__test.setViewer({
		open() {},
		copyPng: async () => (calls.push("png"), "png"),
		copySvg: async () => {
			calls.push("svg");
			throw new Error("no image support");
		},
		copySource: async () => (calls.push("source"), "source")
	});
	const engine = createFakeEngine();
	const { instance } = await mountFence(environment, client, { code: "graph TD; A-->B", streaming: false, children: "CODE" }, engine);
	const tree = instance.render();
	findClass(tree, "dsh-handy-toolkits-mermaid-copy").props.onClick({ stopPropagation() {} });
	const menu = instance.render();
	for (const format of ["png", "svg", "source"]) {
		findClass(menu, `dsh-handy-toolkits-mermaid-copy-${format}`).props.onClick({ stopPropagation() {} });
		await settle(environment);
	}
	assert.deepEqual(calls, ["png", "svg", "source"]);
	const toast = environment.document.body.children.find((node) => node.id === "dsh-handy-toolkits-toast");
	assert.match(toast.textContent, /Copy failed: no image support/);
});

test("a failed copy says why and leaves the diagram alone", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	client.__test.setViewer({
		open() {},
		copyPng: async () => {
			throw new Error("clipboard unavailable");
		},
		copySvg: async () => "svg",
		copySource: async () => "source"
	});
	const engine = createFakeEngine();
	const { instance } = await mountFence(environment, client, { code: "graph TD; A-->B", streaming: false, children: "CODE" }, engine);
	const tree = instance.render();
	findClass(tree, "dsh-handy-toolkits-mermaid-copy").props.onClick({ stopPropagation() {} });
	findClass(instance.render(), "dsh-handy-toolkits-mermaid-copy-png").props.onClick({ stopPropagation() {} });
	await settle(environment);
	const toast = environment.document.body.children.find((node) => node.id === "dsh-handy-toolkits-toast");
	assert.match(toast.textContent, /Copy failed: clipboard unavailable/);
	assert.ok(findClass(instance.render(), "dsh-handy-toolkits-mermaid"), "the diagram is still on screen");
});

test("clicking the diagram opens the viewer but selecting text does not", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const opened = [];
	client.__test.setViewer({ ...client.__test.defaultViewer, open: (options) => opened.push(options) });
	const engine = createFakeEngine();
	const { instance } = await mountFence(environment, client, { code: "graph TD; A-->B", streaming: false, children: "CODE" }, engine);
	const host = findClass(instance.render(), "dsh-handy-toolkits-mermaid");
	environment.state.selection = { toString: () => "some borrowed text" };
	host.props.onClick({ stopPropagation() {} });
	assert.equal(opened.length, 0, "a text selection borrows the click");
	environment.state.selection = { toString: () => "" };
	host.props.onClick({ stopPropagation() {} });
	assert.equal(opened.length, 1);
});
```

`findClass(tree, className)` is a helper the implementer adds near `textOf`: depth-first walk of `node.props.children`, returning the first node whose `props.className` **split on spaces contains** `className` exactly (so `dsh-handy-toolkits-mermaid` does not match `dsh-handy-toolkits-mermaid-wrap`).

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test`
Expected: FAIL — `setViewer is not a function`.

- [ ] **Step 3: Implement**

`MermaidFence` gains `this.state.menuOpen = false` (extend the constructor state), a `copy(format)` method that calls the matching `viewer` function and toasts `已复制 PNG`/`Copied PNG` (on `"source"` fallback from the SVG path, toast `已复制源码`), and a `catch` that toasts `复制失败：${message}` / `Copy failed: ${message}`.
`render()` wraps the existing nodes: when `svg !== ""`, return one `div` with `className: "dsh-handy-toolkits-mermaid-wrap"` holding the unchanged `div.dsh-handy-toolkits-mermaid` (with `onClick`) plus the actions block. The error branch is untouched.
`mountMermaid(ctx)` calls `installViewerStyle()` once before registering the layer.
Keep `dangerouslySetInnerHTML` on the inner SVG host only.

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: 41 passing, 0 failing (the four earlier mermaid tests may need their root assertion adjusted to `findClass(tree, "dsh-handy-toolkits-mermaid")`; do it without weakening what they assert).

- [ ] **Step 5: Commit**

```bash
git add lib/client.js test/client.test.mjs
git commit -m "feat: add copy and full-screen actions to mermaid fences"
```

---

### Task 6: Prove it in the real GUI at 150% page zoom

**Files:**
- No source changes expected; any fix goes into `lib/client.js` (with a test first).

**Interfaces:**
- Consumes: the built bundle at `~/.dsh/profiles/desktop/plugins/dsh-handy-toolkits` clone, a clone profile under `/tmp`, headless Chrome over CDP.

- [ ] **Step 1: Boot a clone of the live profile with the new bundle**

```bash
rm -rf /tmp/mvverify && mkdir -p /tmp/mvverify/profiles
cp -cR ~/.dsh/profiles/desktop /tmp/mvverify/profiles/web
cp lib/client.js lib/index.js /tmp/mvverify/profiles/web/plugins/dsh-handy-toolkits/lib/
cp ~/.dsh/.credentials.yaml /tmp/mvverify/.credentials.yaml
DSH_HOME=/tmp/mvverify dsh --profile web --port 63200 --no-open
```

The boot log prints `dsh web: http://127.0.0.1:63200/?token=…`. Confirm the graph advertises the plugin: `curl -s --max-time 3 http://127.0.0.1:63200/plugins/events | grep -o '"id":"dsh-handy-toolkits"[^}]*}'` (the SSE endpoint needs no token).

- [ ] **Step 2: Drive Chrome**

Launch `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9320 --user-data-dir=/tmp/cp9320 --window-size=1440,900 about:blank`, then with a CDP script: open the token URL, dismiss the preview notice (`Continue`), ask the model for a `graph TD` mermaid fence, wait for `.dsh-handy-toolkits-mermaid svg`, press the `Equal` zoom chord 5 times (`Meta+Shift+Equal`) so the page runs at 150%.

- [ ] **Step 3: Measure, do not screenshot**

Report: `pageZoomLevel() === 1.5`; `document.documentElement.style.zoom === "1.5"`; `window.innerWidth` in layout px; after clicking `button.dsh-handy-toolkits-mermaid-expand`, the overlay's `style.width/height` equal `window.innerWidth/innerHeight`; the overlay's rendered box covers the window (`overlay.getBoundingClientRect()` under the shim ≈ `{0,0,innerWidth,innerHeight}`); `document.documentElement.scrollWidth === document.documentElement.clientWidth` (no horizontal overflow); the stage's transform updates when pressing `+`; `Escape` removes the overlay and leaves the inline diagram intact; `errors === []`.

- [ ] **Step 4: Fix what the measurement exposes, with a failing test first**

Any deviation (double compensation, overflow, overlay not covering) gets a unit test in `test/client.test.mjs` before the fix, then `node --test` green.

- [ ] **Step 5: Commit**

```bash
git add lib/client.js test/client.test.mjs
git commit -m "fix: keep the mermaid viewer aligned under page zoom"
```

(Only if Step 4 changed code; otherwise skip the commit.)

---

### Task 7: Docs, version, install

**Files:**
- Modify: `package.json` (version `0.4.0`, description), `README.md`
- Installed copy: `~/.dsh/profiles/desktop/plugins/dsh-handy-toolkits`

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped plugin.

- [ ] **Step 1: README**

Extend the mermaid section with a "Viewing and copying" subsection: the two hover actions, the overlay's controls (`+`/`−`/`100%`/`适应`, wheel, drag, double-click, `Esc`), what "100%" means (1 diagram px = 1 app px at the current page zoom), that the overlay follows the page zoom, the three copy formats, the `htmlLabels: false` trick for PNG, and the theme captured at open time. Add one troubleshooting entry per failure the E2E found.

- [ ] **Step 2: Version**

`package.json`: `"version": "0.4.0"`, description mentions the viewer. Run `node --test` once more (expected: all passing).

- [ ] **Step 3: Install and verify**

```bash
./install.sh
md5 lib/client.js ~/.dsh/profiles/desktop/plugins/dsh-handy-toolkits/lib/client.js
```

Expected: both hashes identical, `copied plugin to …` printed.

- [ ] **Step 4: Commit and report**

```bash
git add -A
git commit -m "docs: document the mermaid viewer and bump to 0.4.0"
```

Tell the user to `Cmd+Q` and reopen the app (the bundle URL is rev-hashed), then clean up `/tmp/mvverify`, the Chrome profile and the :63200 server.