window.__ModuleLoader__.load({
	id: "dsh-handy-toolkits",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		//#region shared: transient readout
		const TOAST_STYLE = [
			"position:fixed",
			"right:16px",
			"bottom:16px",
			"z-index:2147483000",
			"padding:8px 14px",
			"border-radius:10px",
			"font:500 13px/1.4 system-ui, -apple-system, \"Segoe UI\", sans-serif",
			"color:#ffffff",
			"background:rgba(22,22,26,.86)",
			"box-shadow:0 6px 20px rgba(0,0,0,.28)",
			"pointer-events:none",
			"opacity:0",
			"transition:opacity .16s ease"
		].join(";");
		let toast;
		let toastTimer;
		/** Show one short-lived message; the same node is reused by every toolkit. */
		function showToast(message, duration = 900) {
			if (document.body === null || document.body === void 0) return;
			if (toast === void 0 || toast.isConnected === false) {
				toast = document.createElement("div");
				toast.id = "dsh-handy-toolkits-toast";
				toast.setAttribute("role", "status");
				toast.setAttribute("aria-live", "polite");
				toast.setAttribute("data-dsh-handy-toolkits", "");
				toast.style.cssText = TOAST_STYLE;
				document.body.appendChild(toast);
			}
			toast.textContent = message;
			toast.style.opacity = "1";
			window.clearTimeout(toastTimer);
			toastTimer = window.setTimeout(() => {
				if (toast !== void 0) toast.style.opacity = "0";
			}, duration);
		}
		function hideToast() {
			window.clearTimeout(toastTimer);
			if (toast !== void 0) toast.remove();
			toast = void 0;
		}
		/** Language for the readouts: the document locale first, the browser second. */
		function speaksChinese() {
			const browser = typeof navigator === "undefined" ? void 0 : navigator;
			const lang = (document.documentElement?.lang || browser?.language || "en").toLowerCase();
			return lang.startsWith("zh");
		}
		//#endregion

		//#region toolkit: page zoom
		/**
		 * Whole-page zoom for the Web GUI. The desktop window has no page zoom of
		 * its own (its Cmd/Ctrl +/- chords step font sizes), so this toolkit scales
		 * the document root with the CSS `zoom` property and remembers the level.
		 *
		 * Chords use Shift on purpose: Cmd/Ctrl + `=` and Cmd/Ctrl + `-` stay
		 * owned by the built-in font-size commands.
		 */
		/** Keyboard gesture table: physical codes keep the chords layout-independent. */
		const CHORDS = {
			Equal: "in",
			NumpadAdd: "in",
			Minus: "out",
			NumpadSubtract: "out",
			Digit0: "reset",
			Numpad0: "reset"
		};
		//#region toolkit: page zoom — coordinate shim
		/**
		 * CSS `zoom` splits the browser's coordinate space in two: painting is
		 * scaled, but `getBoundingClientRect()`, `innerWidth`/`innerHeight` and
		 * `visualViewport` keep reporting *visual* (zoomed) pixels while
		 * `style.left`/`top` and `event.clientX` stay in *layout* pixels.
		 *
		 * The GUI anchors its menus and popovers with
		 * `getBoundingClientRect()` and applies the result as `left`/`top`, so
		 * under a zoomed root every overlay lands `level ×` too far from its
		 * anchor. Dividing the visual APIs by the level restores a single
		 * coordinate space — the same one native page zoom exposes.
		 */
		/** Divide one rect into layout pixels, keeping the DOMRect shape. */
		function scaleRect(rect, factor) {
			const x = rect.x / factor;
			const y = rect.y / factor;
			const width = rect.width / factor;
			const height = rect.height / factor;
			if (typeof DOMRect === "function") return new DOMRect(x, y, width, height);
			return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
		}
		/**
		 * Patch the visual-pixel APIs so they report layout pixels. Every patch
		 * records its own undo; `setFactor(1)` short-circuits back to the
		 * originals without unpatching, and `uninstall()` restores them.
		 */
		function installCoordinateShim(factor) {
			const state = { factor, undo: [] };
			const scale = (value) => (state.factor === 1 ? value : value / state.factor);
			const restoreProperty = (target, key) => {
				const original = Object.getOwnPropertyDescriptor(target, key);
				state.undo.push(() => {
					if (original === void 0) delete target[key];
					else Object.defineProperty(target, key, original);
				});
			};

			const elementProto = typeof Element === "function" ? Element.prototype : void 0;
			const originalRect = elementProto?.getBoundingClientRect;
			if (elementProto !== void 0 && typeof originalRect === "function") {
				elementProto.getBoundingClientRect = function () {
					const rect = originalRect.call(this);
					return state.factor === 1 ? rect : scaleRect(rect, state.factor);
				};
				state.undo.push(() => {
					elementProto.getBoundingClientRect = originalRect;
				});
			}

			const windowProto = typeof Window === "function" ? Window.prototype : void 0;
			for (const key of ["innerWidth", "innerHeight"]) {
				const descriptor = Object.getOwnPropertyDescriptor(window, key) ?? (windowProto === void 0 ? void 0 : Object.getOwnPropertyDescriptor(windowProto, key));
				if (descriptor?.get === void 0) continue;
				const get = descriptor.get;
				restoreProperty(window, key);
				Object.defineProperty(window, key, {
					configurable: true,
					get: () => scale(get.call(window))
				});
			}

			if (elementProto !== void 0) {
				for (const key of ["clientWidth", "clientHeight"]) {
					const descriptor = Object.getOwnPropertyDescriptor(elementProto, key);
					if (descriptor?.get === void 0) continue;
					const get = descriptor.get;
					state.undo.push(() => {
						Object.defineProperty(elementProto, key, descriptor);
					});
					Object.defineProperty(elementProto, key, {
						configurable: true,
						get() {
							const value = get.call(this);
							// Only the root reports the viewport; nested boxes are layout already.
							return this === document.documentElement ? scale(value) : value;
						}
					});
				}
			}

			const viewport = window.visualViewport;
			const viewportProto = typeof VisualViewport === "function" ? VisualViewport.prototype : void 0;
			if (viewport !== null && viewport !== void 0) {
				for (const key of ["width", "height"]) {
					const descriptor = Object.getOwnPropertyDescriptor(viewport, key) ?? (viewportProto === void 0 ? void 0 : Object.getOwnPropertyDescriptor(viewportProto, key));
					if (descriptor?.get === void 0) continue;
					const get = descriptor.get;
					restoreProperty(viewport, key);
					Object.defineProperty(viewport, key, { configurable: true, get: () => scale(get.call(viewport)) });
				}
			}

			return {
				setFactor(next) {
					state.factor = next;
				},
				uninstall() {
					state.factor = 1;
					for (const undo of state.undo.reverse()) undo();
					state.undo.length = 0;
				}
			};
		}
		//#endregion

		const STORAGE_KEY = "dsh-handy-toolkits:level";
		const MIN_LEVEL = 0.5;
		const MAX_LEVEL = 2;
		const STEP = 0.1;
		/** Coerce any stored or computed value into a supported, 1%-grid level. */
		function clampLevel(level) {
			if (!Number.isFinite(level)) return 1;
			return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level * 100) / 100));
		}
		function readLevel() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				return raw === null ? 1 : clampLevel(Number.parseFloat(raw));
			} catch {
				return 1;
			}
		}
		function writeLevel(level) {
			try {
				if (level === 1) window.localStorage.removeItem(STORAGE_KEY);
				else window.localStorage.setItem(STORAGE_KEY, String(level));
			} catch {}
		}
		/** Keep the coordinate shim in step with the painted level. */
		let coordinateShim;
		function syncShim(level) {
			if (level === 1) {
				coordinateShim?.uninstall();
				coordinateShim = void 0;
				return;
			}
			if (coordinateShim === void 0) coordinateShim = installCoordinateShim(level);
			else coordinateShim.setFactor(level);
		}
		/** Apply one level to the document root; 100% removes the property entirely. */
		function paint(level) {
			const root = document.documentElement;
			if (root === null || root === void 0) return;
			if (level === 1) root.style.removeProperty("zoom");
			else root.style.setProperty("zoom", String(level));
			syncShim(level);
		}
		/** Read the chord out of a keydown, or `undefined` when it is not ours. */
		function chordOf(event) {
			if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return void 0;
			return CHORDS[event.code];
		}
		/** Mount the shortcuts and restore the remembered level. */
		function mountZoom(ctx) {
			let level = readLevel();
			paint(level);
			const onKeyDown = (event) => {
				const chord = chordOf(event);
				if (chord === void 0) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				level = chord === "reset" ? 1 : clampLevel(level + (chord === "in" ? STEP : -STEP));
				paint(level);
				writeLevel(level);
				showToast(`Page zoom ${Math.round(level * 100)}%`);
			};
			window.addEventListener("keydown", onKeyDown, true);
			ctx.effect(() => () => {
				window.removeEventListener("keydown", onKeyDown, true);
				hideToast();
				paint(1);
			}, "dsh-handy-toolkits: shortcuts");
		}
		//#endregion

		//#region toolkit: copy on select
		/**
		 * Copy-on-select for the chat transcript. Dragging over a reply leaves the
		 * text in the clipboard, so the usual "select, then hit Cmd/Ctrl+C" step
		 * disappears.
		 *
		 * The transcript is found through the stable attributes the chat plugins
		 * render: the scrollport (`data-conversation-scroll`) and its rows
		 * (`data-chat-turn`). Anything outside them — the sidebar, the
		 * settings pages, the composer — keeps its native selection behaviour; the
		 * composer is a rich-text editor and owns its own selection outright.
		 */
		const COPY_SCOPE = "[data-conversation-scroll],[data-chat-turn]";
		/** Selections longer than this are almost certainly an accident (Cmd+A). */
		const COPY_LIMIT = 200000;
		const COPY_TOAST_MIN_MS = 900;
		/** The selection as text, but only when it belongs to the transcript. */
		function transcriptSelection() {
			const selection = window.getSelection?.() ?? null;
			if (selection === null || selection.isCollapsed) return "";
			const text = String(selection.toString() ?? "");
			if (text.trim() === "" || text.length > COPY_LIMIT) return "";
			const anchor = selection.anchorNode;
			const start = anchor === null || anchor === void 0 ? null : anchor.nodeType === 1 ? anchor : anchor.parentElement;
			if (start === null || start === void 0) return "";
			if (start.isContentEditable) return "";
			if (start.closest("[data-dsh-handy-toolkits]") !== null) return "";
			return start.closest(COPY_SCOPE) === null ? "" : text;
		}
		/** `document.execCommand("copy")` on the live selection, or on a scratch node. */
		function copyWithExecCommand(text) {
			try {
				if (typeof document.execCommand !== "function") return false;
				const selection = window.getSelection?.() ?? null;
				if (selection !== null && !selection.isCollapsed && String(selection.toString()) === text) {
					return document.execCommand("copy");
				}
				const scratch = document.createElement("textarea");
				scratch.value = text;
				scratch.setAttribute("readonly", "");
				scratch.setAttribute("aria-hidden", "true");
				scratch.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
				document.body.appendChild(scratch);
				scratch.select();
				const copied = document.execCommand("copy");
				scratch.remove();
				return copied;
			} catch {
				return false;
			}
		}
		/** Clipboard API first (the desktop origin is a secure context), legacy second. */
		async function writeClipboard(text) {
			const clipboard = typeof navigator === "undefined" ? void 0 : navigator.clipboard;
			if (clipboard !== null && clipboard !== void 0 && typeof clipboard.writeText === "function") {
				try {
					await clipboard.writeText(text);
					return true;
				} catch {}
			}
			return copyWithExecCommand(text);
		}
		function copiedToast(text) {
			const length = [...text].length;
			return speaksChinese() ? `已复制 ${length} 个字符` : `Copied ${length} characters`;
		}
		function mountCopyOnSelect(ctx) {
			let disposed = false;
			let pending = 0;
			const copyNow = async () => {
				const text = transcriptSelection();
				if (text === "") return;
				const copied = await writeClipboard(text);
				if (disposed) return;
				if (copied) showToast(copiedToast(text), COPY_TOAST_MIN_MS);
				else showToast(speaksChinese() ? "复制失败，请按 Cmd/Ctrl+C" : "Copy failed — press Cmd/Ctrl+C", 1600);
			};
			const onPointerUp = () => {
				// The selection is final by the time the pointer is released; the
				// deferred pass covers drags that end before the selection settles.
				void copyNow();
				window.clearTimeout(pending);
				pending = window.setTimeout(() => void copyNow(), 40);
			};
			document.addEventListener("pointerup", onPointerUp, true);
			ctx.effect(() => () => {
				disposed = true;
				window.clearTimeout(pending);
				document.removeEventListener("pointerup", onPointerUp, true);
				hideToast();
			}, "dsh-handy-toolkits: copy on select");
		}
		//#endregion

		function apply(ctx) {
			mountZoom(ctx);
			mountCopyOnSelect(ctx);
		}

		exports.apply = apply;
		return module.exports;
	}
});
