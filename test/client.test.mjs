// Unit test for dsh-handy-toolkits/lib/client.js with a stubbed browser.
import assert from "node:assert/strict";
import { test } from "node:test";

const clientUrl = new URL("../lib/client.js", import.meta.url).href;

/** A minimal window/document pair, enough for the bundle to run headless. */
function createEnvironment() {
	const listeners = new Map();
	const store = new Map();
	const style = new Map();
	const timers = new Map();
	const appended = [];
	let timerId = 0;

	const documentElement = {
		style: {
			setProperty: (name, value) => style.set(name, value),
			removeProperty: (name) => style.delete(name),
			getPropertyValue: (name) => style.get(name) ?? ""
		}
	};
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
				style: { cssText: "", opacity: "" },
				attributes: {},
				setAttribute(name, value) {
					this.attributes[name] = value;
				},
				remove() {
					this.isConnected = false;
				}
			};
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
		}
	};
	window.window = window;
	window.document = document;
	window.__ModuleLoader__ = {
		load(registration) {
			window.entry = registration;
		}
	};
	globalThis.window = window;
	globalThis.document = document;
	return { window, document, listeners, store, style, appended, timers };
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

/** Mount the plugin and return its disposer. */
function mount(environment, client) {
	const disposers = [];
	client.apply({
		effect(callback, label) {
			assert.equal(label, "dsh-handy-toolkits: shortcuts");
			disposers.push(callback());
		}
	});
	return disposers[0];
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

test("teardown restores 100%, detaches the listener and drops the toast", async () => {
	const environment = createEnvironment();
	const client = await loadClient(environment);
	const dispose = mount(environment, client);
	press(environment, "Equal");
	press(environment, "Equal");
	dispose();
	assert.equal(environment.style.get("zoom"), undefined);
	assert.equal((environment.listeners.get("keydown") ?? []).length, 0);
	assert.equal(environment.timers.size, 0);
});
