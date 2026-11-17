// Unit test for dsh-handy-toolkits/lib/client.js with a stubbed browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

const clientUrl = new URL("../lib/client.js", import.meta.url).href;

/** A minimal window/document pair, enough for the bundle to run headless. */
function createEnvironment() {
	const listeners = new Map();
	const documentListeners = new Map();
	const store = new Map();
	const style = new Map();
	const timers = new Map();
	const appended = [];
	let timerId = 0;

	const state = {
		copied: "",
		copyWorks: true,
		clipboard: true,
		clipboardText: "",
		clipboardItems: [],
		clipboardRejects: false,
		canvases: [],
		drawn: [],
		pngBlob: new Blob(["png"], { type: "image/png" }),
		selection: null,
		language: "en-US",
		lang: "",
		// Visual (zoomed) pixels, as the browser reports them under CSS zoom.
		visualRect: { x: 300, y: 100, width: 100, height: 40 },
		innerWidth: 1440,
		innerHeight: 900,
		viewportWidth: 1440,
		viewportHeight: 900,
		rootClientWidth: 1440,
		rootClientHeight: 900
	};

	class DOMRect {
		constructor(x, y, width, height) {
			this.x = x;
			this.y = y;
			this.width = width;
			this.height = height;
			this.left = x;
			this.top = y;
			this.right = x + width;
			this.bottom = y + height;
		}
	}
	let documentElement;
	class Element {
		getBoundingClientRect() {
			const rect = state.visualRect;
			return new DOMRect(rect.x, rect.y, rect.width, rect.height);
		}
		get clientWidth() {
			return this === documentElement ? state.rootClientWidth : 640;
		}
		get clientHeight() {
			return this === documentElement ? state.rootClientHeight : 480;
		}
	}
	globalThis.DOMRect = DOMRect;
	globalThis.Element = Element;

	documentElement = new Element();
	documentElement.style = {
		setProperty: (name, value) => style.set(name, value),
		removeProperty: (name) => style.delete(name),
		getPropertyValue: (name) => style.get(name) ?? ""
	};
	Object.defineProperty(documentElement, "lang", {
		configurable: true,
		get: () => state.lang
	});
	/** Attribute bag shared by `body` and `head`; the theme rides on a body attribute. */
	const attributes = new Map();
	class FakeElement {
		constructor(tag) {
			this.tagName = String(tag).toUpperCase();
			this.id = "";
			this.isConnected = false;
			this.textContent = "";
			this.value = "";
			this.innerHTML = "";
			this.className = "";
			this.style = { cssText: "", opacity: "" };
			this.attributes = {};
			this.children = [];
			this.parentNode = null;
			this.handlers = new Map();
			this.classList = {
				add: (...names) => {
					const set = new Set(this.className.split(/\s+/).filter(Boolean));
					for (const name of names) set.add(name);
					this.className = [...set].join(" ");
				},
				remove: (...names) => {
					const set = new Set(this.className.split(/\s+/).filter(Boolean));
					for (const name of names) set.delete(name);
					this.className = [...set].join(" ");
				},
				contains: (name) => this.className.split(/\s+/).includes(name)
			};
		}
		appendChild(node) {
			node.parentNode = this;
			node.isConnected = true;
			this.children.push(node);
			return node;
		}
		removeChild(node) {
			const index = this.children.indexOf(node);
			if (index >= 0) this.children.splice(index, 1);
			node.parentNode = null;
			node.isConnected = false;
			return node;
		}
		addEventListener(type, fn) {
			if (!this.handlers.has(type)) this.handlers.set(type, []);
			this.handlers.get(type).push(fn);
		}
		removeEventListener(type, fn) {
			const list = this.handlers.get(type) ?? [];
			const index = list.indexOf(fn);
			if (index >= 0) list.splice(index, 1);
		}
		dispatchEvent(type, event = {}) {
			const payload = {
				target: this,
				currentTarget: this,
				preventDefault() {},
				stopPropagation() {},
				...event
			};
			for (const fn of [...(this.handlers.get(type) ?? [])]) fn(payload);
			return true;
		}
		setAttribute(name, value) {
			this.attributes[name] = String(value);
		}
		removeAttribute(name) {
			delete this.attributes[name];
		}
		remove() {
			if (this.parentNode !== null) this.parentNode.removeChild(this);
			this.isConnected = false;
		}
		select() {}
		setPointerCapture() {}
		releasePointerCapture() {}
	}
	const body = new FakeElement("body");
	body.isConnected = true;
	body.appendChild = ((appendChild) => (node) => {
		appended.push(node);
		return appendChild.call(body, node);
	})(FakeElement.prototype.appendChild);
	Object.assign(body, {
		hasAttribute: (name) => attributes.has(name),
		getAttribute: (name) => attributes.get(name) ?? null,
		setAttribute(name, value) {
			attributes.set(name, String(value));
		},
		removeAttribute(name) {
			attributes.delete(name);
		}
	});
	const head = new FakeElement("head");
	head.appendChild = (node) => {
		appended.push(node);
		node.isConnected = true;
		return node;
	};
	const document = {
		documentElement,
		body,
		head,
		createElement(tag) {
			if (String(tag).toLowerCase() === "canvas") {
				const canvas = {
					tagName: "CANVAS",
					width: 0,
					height: 0,
					getContext: () => ({
						fillStyle: "",
						fillRect() {},
						drawImage(...args) {
							state.drawn.push(args);
						}
					}),
					toBlob(callback) {
						callback(state.pngBlob);
					}
				};
				state.canvases.push(canvas);
				return canvas;
			}
			return new FakeElement(tag);
		},
		addEventListener(type, fn) {
			if (!documentListeners.has(type)) documentListeners.set(type, []);
			documentListeners.get(type).push(fn);
		},
		removeEventListener(type, fn) {
			const list = documentListeners.get(type) ?? [];
			const index = list.indexOf(fn);
			if (index >= 0) list.splice(index, 1);
		},
		execCommand(command) {
			if (command !== "copy") return false;
			state.copied = window.getSelection?.()?.toString() ?? "";
			return state.copyWorks;
		}
	};
	const window = {
		localStorage: {
			getItem: (key) => (store.has(key) ? store.get(key) : null),
			setItem: (key, value) => store.set(key, value),
			removeItem: (key) => store.delete(key)
		},
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(fn);
		},
		removeEventListener(type, fn) {
			const list = listeners.get(type) ?? [];
			const index = list.indexOf(fn);
			if (index >= 0) list.splice(index, 1);
		},
		clearTimeout: (id) => timers.delete(id),
		setTimeout(fn) {
			timers.set(++timerId, fn);
			return timerId;
		},
		getSelection: () => state.selection
	};
	window.dispatchEvent = (event) => {
		for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);
		return true;
	};
	window.window = window;
	window.document = document;
	globalThis.CustomEvent = class CustomEvent {
		constructor(type, init = {}) {
			this.type = type;
			this.detail = init.detail;
		}
	};
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
	const viewport = {};
	Object.defineProperties(viewport, {
		width: { configurable: true, get: () => state.viewportWidth },
		height: { configurable: true, get: () => state.viewportHeight }
	});
	Object.defineProperties(window, {
		innerWidth: { configurable: true, get: () => state.innerWidth },
		innerHeight: { configurable: true, get: () => state.innerHeight },
		visualViewport: {
			configurable: true,
			get: () => viewport
		}
	});
	window.__ModuleLoader__ = {
		load(registration) {
			window.entry = registration;
		}
	};
	globalThis.window = window;
	globalThis.document = document;
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {
			language: state.language,
			get clipboard() {
				return state.clipboard
					? {
							async writeText(text) {
								state.clipboardText = text;
							},
							async write(items) {
								if (state.clipboardRejects) throw new Error("clipboard rejected the image");
								state.clipboardItems.push(...items);
							}
						}
					: void 0;
			}
		}
	});
	const observers = [];
	globalThis.MutationObserver = class MutationObserver {
		constructor(callback) {
			this.callback = callback;
			this.active = true;
			observers.push(this);
		}
		observe(target, options) {
			this.target = target;
			this.options = options;
		}
		disconnect() {
			this.active = false;
		}
	};
	return {
		window,
		document,
		listeners,
		documentListeners,
		store,
		style,
		appended,
		timers,
		state,
		observers
	};
}

/** Flip the app's light/dark body attribute and notify the observers watching it. */
function setTheme(environment, dark) {
	const body = environment.document.body;
	if (dark) body.setAttribute("data-ds-dark-theme", "");
	else body.removeAttribute("data-ds-dark-theme");
	for (const observer of environment.observers) {
		if (observer.active) observer.callback([], observer);
	}
}

/**
 * The client runtime's `react` peer, reduced to what the fence layer uses: a
 * class with `setState` and an element factory that keeps props and children.
 *
 * Updates are batched into a microtask and followed by
 * `componentDidUpdate(previousProps, previousState)`, the way React 18 behaves.
 * An unbatched fake would apply `setState` before the next line runs and hide
 * ordering bugs that the real app shows.
 */
function createFakeReact() {
	const createElement = (type, props, ...children) => ({
		type,
		props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children }
	});
	class Component {
		constructor(props) {
			this.props = props;
			this.state = {};
			this.patch = null;
			this.scheduled = false;
			this.unmounted = false;
			const onUnmount = this.componentWillUnmount;
			if (typeof onUnmount === "function") {
				this.componentWillUnmount = () => {
					this.unmounted = true;
					onUnmount.call(this);
				};
			}
		}
		setState(next) {
			const patch = typeof next === "function" ? next(this.state, this.props) : next;
			this.patch = { ...(this.patch ?? {}), ...patch };
			if (this.scheduled) return;
			this.scheduled = true;
			Promise.resolve().then(() => {
				this.scheduled = false;
				if (this.patch === null || this.unmounted) return;
				const previousProps = this.props;
				const previousState = this.state;
				const applied = this.patch;
				this.patch = null;
				this.state = { ...this.state, ...applied };
				if (typeof this.componentDidUpdate === "function") this.componentDidUpdate(previousProps, previousState);
			});
		}
	}
	return { Component, createElement, Fragment: "Fragment" };
}

const fakeReact = createFakeReact();

/** A stand-in mermaid engine; `__test.setEngine` swaps it for the bundled one. */
const mermaidApi = { render: "the real engine" };

function createFakeEngine(overrides = {}) {
	const calls = { load: 0, render: [] };
	return {
		calls,
		async load() {
			calls.load += 1;
			return mermaidApi;
		},
		async render(engine, code, theme, options = {}) {
			assert.equal(engine, mermaidApi, "the layer hands the loaded engine back");
			calls.render.push({ code, theme, ...options });
			return `<svg data-theme="${theme}">${code}</svg>`;
		},
		...overrides
	};
}

/** Fresh module instance per test: the bundle caches module state. */
async function loadClient(environment) {
	await import(`${clientUrl}?n=${Math.random()}`);
	const client = environment.window.entry.factory((name) => {
		if (name === "react") return fakeReact;
		throw new Error(`unexpected require(${name})`);
	});
	return client;
}

/** Dispatch one keydown through the listeners the plugin installed. */
function press(environment, code, options = {}) {
	const event = {
		code,
		metaKey: options.metaKey ?? true,
		ctrlKey: options.ctrlKey ?? false,
		shiftKey: options.shiftKey ?? true,
		altKey: options.altKey ?? false,
		defaultPrevented: false,
		stopImmediatePropagation() {},
		preventDefault() {
			this.defaultPrevented = true;
		}
	};
	for (const fn of environment.listeners.get("keydown") ?? []) fn(event);
	return event;
}

/** Dispatch one pointerup through the listeners the plugin installed. */
function release(environment) {
	const event = { type: "pointerup", target: null };
	for (const fn of environment.documentListeners.get("pointerup") ?? []) fn(event);
}

/** A selection whose anchor element answers `closest()` like the real DOM. */
function selectText(environment, text, { zone = "transcript", editable = false } = {}) {
	const anchor = {
		nodeType: 1,
		isContentEditable: editable,
		closest(selector) {
			if (selector === "[data-dsh-handy-toolkits]") return null;
			if (selector === "main") return null;
			return zone === "transcript" ? { id: "transcript" } : null;
		}
	};
	environment.state.selection = {
		isCollapsed: text === "",
		anchorNode: anchor,
		toString: () => text
	};
	return anchor;
}

/** Mount the plugin and return its disposer. */
function mount(environment, client) {
	const disposers = [];
	const registrations = [];
	const injected = [];
	client.apply({
		effect(callback, label) {
			assert.match(label, /^dsh-handy-toolkits: /);
			disposers.push(callback());
		},
		slots: {
			inject(name, callback) {
				injected.push(name);
				const dispose = callback();
				return () => dispose?.();
			},
			register(options, component) {
				registrations.push({ options, component });
				return () => {};
			}
		}
	});
	const dispose = () => {
		for (const entry of disposers) entry();
	};
	dispose.registrations = registrations;
	dispose.injected = injected;
	return dispose;
}

/** Let the async clipboard write and the deferred pass finish. */
async function settle(environment) {
	for (let round = 0; round < 4; round += 1) {
		const pending = [...environment.timers.values()];
		environment.timers.clear();
		for (const fn of pending) fn();
		await new Promise((resolve) => setImmediate(resolve));
	}
}

test("bundle registers the package and exports apply", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	assert.equal(environment.window.entry.id, "dsh-handy-toolkits");
	assert.equal(typeof client.apply, "function");
});

test("chords scale the root and persist the level", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	assert.equal(environment.style.get("zoom"), undefined, "boot at 100% leaves the root untouched");

	assert.equal(press(environment, "Equal").defaultPrevented, true);
	assert.equal(environment.style.get("zoom"), "1.1");
	assert.equal(environment.store.get("dsh-handy-toolkits:level"), "1.1");
	assert.equal(environment.appended.at(-1).textContent, "Page zoom 110%");

	press(environment, "Equal");
	assert.equal(environment.style.get("zoom"), "1.2");
	press(environment, "Minus");
	assert.equal(environment.style.get("zoom"), "1.1");
	press(environment, "Digit0");
	assert.equal(environment.style.get("zoom"), undefined, "reset removes the property");
	assert.equal(environment.store.has("dsh-handy-toolkits:level"), false, "100% is not persisted");
});

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
	const before = handle.state();
	const stage = handle.stage;
	stage.dispatchEvent("wheel", { clientX: 100, clientY: 100, deltaY: -1, preventDefault() {} });
	const after = handle.state();
	assert.equal(after.scale, 1.25);
	assert.equal((100 - after.x) / after.scale, (100 - before.x) / before.scale, "the point under the pointer stays put");
	assert.equal((100 - after.y) / after.scale, (100 - before.y) / before.scale);
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

test("the chords do not steal the built-in font-size commands", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	assert.equal(press(environment, "Equal", { shiftKey: false }).defaultPrevented, false);
	assert.equal(press(environment, "Minus", { shiftKey: false }).defaultPrevented, false);
	assert.equal(press(environment, "Equal", { altKey: true }).defaultPrevented, false);
	assert.equal(press(environment, "Equal", { metaKey: false }).defaultPrevented, false);
	assert.equal(press(environment, "KeyZ").defaultPrevented, false);
});

test("the level clamps to 50%..200% and is restored on mount", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	for (let i = 0; i < 30; i += 1) press(environment, "Equal");
	assert.equal(environment.style.get("zoom"), "2");
	for (let i = 0; i < 40; i += 1) press(environment, "Minus");
	assert.equal(environment.style.get("zoom"), "0.5");

	environment.store.set("dsh-handy-toolkits:level", "0.8");
	mount(environment, client);
	assert.equal(environment.style.get("zoom"), "0.8", "stored level is restored on mount");
});

test("a corrupt stored level falls back to 100%", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	environment.store.set("dsh-handy-toolkits:level", "not-a-number");
	mount(environment, client);
	assert.equal(environment.style.get("zoom"), undefined);
});

test("teardown restores 100%, detaches the listeners and drops the toast", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const dispose = mount(environment, client);
	press(environment, "Equal");
	press(environment, "Equal");
	dispose();
	assert.equal(environment.style.get("zoom"), undefined);
	assert.equal((environment.listeners.get("keydown") ?? []).length, 0);
	assert.equal((environment.documentListeners.get("pointerup") ?? []).length, 0);
	assert.equal(environment.timers.size, 0);
});

test("a drag selection in the transcript is copied and confirmed", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	selectText(environment, "Hello world");
	release(environment);
	await settle(environment);
	assert.equal(environment.state.clipboardText, "Hello world");
	assert.equal(environment.appended.at(-1).textContent, "Copied 11 characters");
});

test("the confirmation follows the document language", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	environment.state.lang = "zh-CN";
	selectText(environment, "你好，世界");
	release(environment);
	await settle(environment);
	assert.equal(environment.state.clipboardText, "你好，世界");
	assert.equal(environment.appended.at(-1).textContent, "已复制 5 个字符");
});

test("the execCommand fallback still copies when the clipboard API is absent", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	environment.state.clipboard = false;
	mount(environment, client);
	selectText(environment, "fallback text");
	release(environment);
	await settle(environment);
	assert.equal(environment.state.copied, "fallback text");
	assert.equal(environment.appended.at(-1).textContent, "Copied 13 characters");
});

test("an empty selection copies nothing", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	selectText(environment, "");
	release(environment);
	await settle(environment);
	assert.equal(environment.state.clipboardText, "");
	assert.equal(environment.appended.length, 0);
});

test("selections inside the composer or outside the transcript are ignored", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);

	selectText(environment, "composer text", { editable: true });
	release(environment);
	await settle(environment);
	assert.equal(environment.state.clipboardText, "", "the composer owns its selection");

	selectText(environment, "settings text", { zone: "elsewhere" });
	release(environment);
	await settle(environment);
	assert.equal(environment.state.clipboardText, "", "outside the transcript nothing is copied");
	assert.equal(environment.appended.length, 0);
});

test("a failed copy says so instead of claiming success", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	environment.state.clipboard = false;
	environment.state.copyWorks = false;
	mount(environment, client);
	selectText(environment, "unreachable");
	release(environment);
	await settle(environment);
	assert.equal(environment.state.clipboardText, "");
	assert.match(environment.appended.at(-1).textContent, /^Copy failed/);
});

/** Measure the DOM the way the GUI's anchored panels measure it. */
function measure(environment) {
	const rect = new globalThis.Element().getBoundingClientRect();
	return {
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height,
		innerWidth: environment.window.innerWidth,
		innerHeight: environment.window.innerHeight,
		viewport: environment.window.visualViewport.width,
		rootClient: environment.document.documentElement.clientWidth,
		nestedClient: new globalThis.Element().clientWidth
	};
}

test("at 100% the browser APIs are passed through untouched", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	assert.deepEqual(measure(environment), {
		left: 300,
		top: 100,
		width: 100,
		height: 40,
		innerWidth: 1440,
		innerHeight: 900,
		viewport: 1440,
		rootClient: 1440,
		nestedClient: 640
	});
});

test("zooming reports layout pixels so anchored panels stay on their anchor", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	press(environment, "Equal");
	press(environment, "Equal");
	press(environment, "Equal");
	press(environment, "Equal");
	press(environment, "Equal");
	assert.equal(environment.style.get("zoom"), "1.5");
	// The stub still answers with visual pixels: 300/1.5, 100/1.5, 100/1.5, 40/1.5.
	const measured = measure(environment);
	assert.equal(Math.round(measured.left * 100) / 100, 200);
	assert.equal(Math.round(measured.top * 100) / 100, 66.67);
	assert.equal(Math.round(measured.width * 100) / 100, 66.67);
	assert.equal(Math.round(measured.height * 100) / 100, 26.67);
	assert.equal(Math.round(measured.innerWidth), 960);
	assert.equal(Math.round(measured.innerHeight), 600);
	assert.equal(Math.round(measured.viewport), 960);
	assert.equal(Math.round(measured.rootClient), 960, "the root reports the viewport");
	assert.equal(measured.nestedClient, 640, "nested boxes are layout pixels already");
});

test("the shim keeps up with level changes and is undone at 100%", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	mount(environment, client);
	press(environment, "Equal");
	assert.equal(Math.round(measure(environment).innerWidth), Math.round(1440 / 1.1));
	for (let i = 0; i < 4; i += 1) press(environment, "Equal");
	assert.equal(environment.style.get("zoom"), "1.5");
	assert.equal(Math.round(measure(environment).innerWidth), 960);
	press(environment, "Digit0");
	assert.equal(measure(environment).innerWidth, 1440, "reset drops the shim");
	assert.equal(measure(environment).left, 300);
});

test("teardown removes every patched accessor", async () => {
	const environment = createEnvironment();
	const ElementProto = globalThis.Element.prototype;
	const rectBefore = ElementProto.getBoundingClientRect;
	const client = await loadClient(environment);
	const dispose = mount(environment, client);
	press(environment, "Equal");
	assert.notEqual(ElementProto.getBoundingClientRect, rectBefore);
	dispose();
	assert.equal(ElementProto.getBoundingClientRect, rectBefore);
	assert.equal(environment.window.innerWidth, 1440);
	assert.equal(environment.window.visualViewport.width, 1440);
	assert.equal(environment.style.get("zoom"), undefined);
});

/** Let the asynchronous fence render finish. */
async function flush() {
	for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Read the text a rendered tree would show. */
function actionOf(node, action) {
	if (node === undefined || node === null) return undefined;
	if (node.attributes?.["data-viewer-action"] === action) return node;
	for (const child of node.children ?? []) {
		const found = actionOf(child, action);
		if (found !== undefined) return found;
	}
	return undefined;
}

function textOf(node) {
	if (node === undefined || node === null) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	return textOf(node.props?.children);
}

/** Mount the registered fence layer and return its React instance. */
async function mountFence(environment, client, props, engine) {
	client.__test.setEngine(engine);
	const dispose = mount(environment, client);
	const registration = dispose.registrations.find(
		(entry) => entry.options.name === "conversation.chat.markdown.fence"
	);
	assert.ok(registration, "the plugin registers a chat fence layer");
	const instance = new registration.component(props);
	instance.componentDidMount();
	await flush();
	return { instance, registration, dispose };
}

test("registers one chat fence layer keyed on the mermaid language", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	assert.deepEqual(client.inject, ["slots"]);
	const dispose = mount(environment, client);
	assert.deepEqual(dispose.injected, ["conversation.chat.markdown.fence"]);
	const [registration] = dispose.registrations;
	assert.equal(registration.options.key, "mermaid");
	assert.match(registration.options.id, /^dsh-handy-toolkits/);
	dispose();
});

test("a streaming fence keeps the plain code block and skips the engine", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const engine = createFakeEngine();
	const { instance } = await mountFence(
		environment,
		client,
		{ code: "graph TD; A-->B", streaming: true, children: "CODE BLOCK" },
		engine
	);
	assert.equal(instance.render(), "CODE BLOCK");
	assert.deepEqual(engine.calls.render, [], "no diagram is drawn mid-stream");
	assert.equal(engine.calls.load, 0, "the engine is not even loaded");
});

test("a finished fence renders into an SVG through the engine", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const engine = createFakeEngine();
	const { instance } = await mountFence(
		environment,
		client,
		{ code: "graph TD; A-->B", streaming: false, children: "CODE BLOCK" },
		engine
	);
	const tree = instance.render();
	assert.match(tree.props.dangerouslySetInnerHTML.__html, /^<svg data-theme="light">/);
	assert.match(tree.props.dangerouslySetInnerHTML.__html, /graph TD/);
	assert.deepEqual(engine.calls.render, [{ code: "graph TD; A-->B", theme: "light" }]);
});

test("a broken diagram falls back to the code block and names the error", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const engine = createFakeEngine({
		async render() {
			throw new Error("Parse error on line 2");
		}
	});
	const { instance } = await mountFence(
		environment,
		client,
		{ code: "graph TD; !!!", streaming: false, children: "CODE BLOCK" },
		engine
	);
	const tree = instance.render();
	assert.equal(textOf(tree).includes("CODE BLOCK"), true, "the plain code block stays visible");
	assert.equal(textOf(tree).includes("Parse error on line 2"), true, "the reason is shown");
	assert.equal(textOf(tree).includes("<svg"), false);
});

test("the engine is loaded once for every diagram on the page", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const engine = createFakeEngine();
	const { registration } = await mountFence(
		environment,
		client,
		{ code: "graph TD; A-->B", streaming: false, children: null },
		engine
	);
	const second = new registration.component({ code: "graph TD; B-->C", streaming: false, children: null });
	second.componentDidMount();
	await flush();
	assert.equal(engine.calls.load, 1, "the mermaid module is decoded once");
	assert.equal(engine.calls.render.length, 2);
});

test("a fence renders when its stream ends", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const engine = createFakeEngine();
	const props = { code: "graph TD; A-->B", streaming: true, children: "CODE BLOCK" };
	const { instance } = await mountFence(environment, client, props, engine);
	assert.equal(instance.render(), "CODE BLOCK");
	const previousState = instance.state;
	instance.props = { ...props, streaming: false };
	instance.componentDidUpdate(props, previousState);
	await flush();
	assert.match(instance.render().props.dangerouslySetInnerHTML.__html, /^<svg/);
});

test("switching the app to dark mode redraws the diagram dark", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const engine = createFakeEngine();
	const { instance } = await mountFence(
		environment,
		client,
		{ code: "graph TD; A-->B", streaming: false, children: "CODE BLOCK" },
		engine
	);
	assert.equal(engine.calls.render.at(-1).theme, "light");
	setTheme(environment, true);
	const whilePending = instance.render();
	assert.match(
		whilePending.props.dangerouslySetInnerHTML.__html,
		/data-theme="light"/,
		"the finished diagram stays on screen while the new theme is drawn"
	);
	await flush();
	assert.equal(engine.calls.render.at(-1).theme, "dark");
	assert.match(instance.render().props.dangerouslySetInnerHTML.__html, /data-theme="dark"/);
});

test("unmounting the diagram stops watching the theme", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const engine = createFakeEngine();
	const { instance } = await mountFence(
		environment,
		client,
		{ code: "graph TD; A-->B", streaming: false, children: null },
		engine
	);
	assert.equal(environment.observers.some((observer) => observer.active), true);
	instance.componentWillUnmount();
	assert.equal(environment.observers.every((observer) => !observer.active), true);
});

test("the vendored payload decodes back to the mermaid source", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const source = '"use strict";globalThis.mermaid = { diagram: "«中文»" };';
	const encoded = gzipSync(Buffer.from(source, "utf8"), { level: 9 }).toString("base64");
	assert.equal(await client.__test.decodePayload(encoded), source);
});
