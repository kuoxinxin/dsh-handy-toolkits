window.__ModuleLoader__.load({
	id: "dsh-handy-toolkits",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region lib/client/index.js
		/**
		 * Whole-page zoom for the Web GUI. The desktop window has no page zoom of
		 * its own (its Cmd/Ctrl +/- chords step font sizes), so this plugin scales
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
		/** Apply one level to the document root; 100% removes the property entirely. */
		function paint(level) {
			const root = document.documentElement;
			if (root === null || root === void 0) return;
			if (level === 1) root.style.removeProperty("zoom");
			else root.style.setProperty("zoom", String(level));
		}
		/** One transient readout, so a chord press is never silent. */
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
		function showToast(level) {
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
			toast.textContent = `Page zoom ${Math.round(level * 100)}%`;
			toast.style.opacity = "1";
			window.clearTimeout(toastTimer);
			toastTimer = window.setTimeout(() => {
				if (toast !== void 0) toast.style.opacity = "0";
			}, 900);
		}
		/** Read the chord out of a keydown, or `undefined` when it is not ours. */
		function chordOf(event) {
			if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return void 0;
			return CHORDS[event.code];
		}
		/** Mount the shortcuts and restore the remembered level. */
		function apply(ctx) {
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
				showToast(level);
			};
			window.addEventListener("keydown", onKeyDown, true);
			ctx.effect(() => () => {
				window.removeEventListener("keydown", onKeyDown, true);
				window.clearTimeout(toastTimer);
				if (toast !== void 0) toast.remove();
				toast = void 0;
				paint(1);
			}, "dsh-handy-toolkits: shortcuts");
		}
		//#endregion
		exports.apply = apply;
		return module.exports;
	}
});
