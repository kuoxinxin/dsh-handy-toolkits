// Unit test for dsh-handy-toolkits/lib/client.js with a stubbed browser.
import assert from "node:assert/strict";
import { test } from "node:test";

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
	const body = {
		appendChild(node) {
			appended.push(node);
			node.isConnected = true;
			return node;
		}
	};
	const document = {
		documentElement,
		body,
		createElement(tag) {
			return {
				tagName: String(tag).toUpperCase(),
				id: "",
				isConnected: false,
				textContent: "",
				value: "",
				style: { cssText: "", opacity: "" },
				attributes: {},
				setAttribute(name, value) {
					this.attributes[name] = value;
				},
				select() {},
				remove() {
					this.isConnected = false;
				}
			};
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
	window.window = window;
	window.document = document;
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
							}
						}
					: void 0;
			}
		}
	});
	return { window, document, listeners, documentListeners, store, style, appended, timers, state };
}

/** Fresh module instance per test: the bundle caches module state. */
async function loadClient(environment) {
	await import(`${clientUrl}?n=${Math.random()}`);
	const client = environment.window.entry.factory((name) => {
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
	client.apply({
		effect(callback, label) {
			assert.match(label, /^dsh-handy-toolkits: /);
			disposers.push(callback());
		}
	});
	return () => {
		for (const dispose of disposers) dispose();
	};
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
