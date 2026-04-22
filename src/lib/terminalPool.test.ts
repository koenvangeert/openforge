import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import { openUrl } from "./ipc";
import { TERMINAL_FONT_FAMILY } from "./terminalOptions";
import {
	_getPool,
	acquire,
	attach,
	clearPtySpawnPending,
	clearTaskTerminalTabsSession,
	detach,
	focusTerminal,
	getShellLifecycleState,
	getTaskTerminalTabsSession,
	isPtyActive,
	isShellExited,
	markPtySpawnPending,
	recoverActiveTerminal,
	release,
	releaseAll,
	releaseAllForTask,
	setCurrentPtyInstance,
	shouldSpawnPty,
	updateShellLifecycleState,
	updateTaskTerminalTabsSession,
} from "./terminalPool";

type ListenCallback = (event: unknown) => void;
type UnlistenMock = Mock<() => void>;
type TerminalPoolEntry = Awaited<ReturnType<typeof acquire>>;

// Track listen callbacks so tests can simulate events
const listenCallbacks = new Map<string, ListenCallback>();
const unlistenFns: UnlistenMock[] = [];
let webLinksHandler: ((event: MouseEvent, uri: string) => void) | null = null;
let webglContextLossHandler: (() => void) | null = null;
let fontLoadMock: Mock;
const originalDocumentFonts = document.fonts;

interface TerminalMockOptions {
	fontFamily?: string;
}

function getTerminalFontFamily(terminal: unknown): string | undefined {
	if (
		typeof terminal !== "object" ||
		terminal === null ||
		!("options" in terminal)
	) {
		return undefined;
	}

	const options = terminal.options;
	if (
		typeof options !== "object" ||
		options === null ||
		!("fontFamily" in options)
	) {
		return undefined;
	}

	return typeof options.fontFamily === "string"
		? options.fontFamily
		: undefined;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
	if (value == null) {
		throw new Error(message);
	}

	return value;
}

function getListenCallback(eventName: string): ListenCallback {
	return requireValue(
		listenCallbacks.get(eventName),
		`Missing listen callback for ${eventName}`,
	);
}

function getWebLinksHandler(): (event: MouseEvent, uri: string) => void {
	return requireValue(
		webLinksHandler,
		"Expected WebLinks handler to be registered",
	);
}

function getWebglContextLossHandler(): () => void {
	return requireValue(
		webglContextLossHandler,
		"Expected WebGL context loss handler to be registered",
	);
}

function getTerminalMocks(entry: TerminalPoolEntry) {
	return {
		open: vi.mocked(entry.terminal.open),
		write: vi.mocked(entry.terminal.write),
		dispose: vi.mocked(entry.terminal.dispose),
		loadAddon: vi.mocked(entry.terminal.loadAddon),
		refresh: vi.mocked(entry.terminal.refresh),
		focus: vi.mocked(entry.terminal.focus),
		reset: vi.mocked(entry.terminal.reset),
	};
}

function getFitAddonMocks(entry: TerminalPoolEntry) {
	return {
		fit: vi.mocked(entry.fitAddon.fit),
	};
}

function isDisposableAddon(value: unknown): value is { dispose: () => void } {
	return (
		typeof value === "object" &&
		value !== null &&
		"dispose" in value &&
		typeof value.dispose === "function"
	);
}

function getDisposableAddon(value: unknown): { dispose: () => void } {
	if (!isDisposableAddon(value)) {
		throw new Error("Expected addon with dispose() mock");
	}

	return value;
}

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async (eventName: string, cb: (event: unknown) => void) => {
		listenCallbacks.set(eventName, cb);
		const unlisten = vi.fn();
		unlistenFns.push(unlisten);
		return unlisten;
	}),
}));

vi.mock("@xterm/xterm", () => {
	class Terminal {
		options: TerminalMockOptions;
		constructor(options: TerminalMockOptions = {}) {
			this.options = options;
		}
		open = vi.fn();
		write = vi.fn();
		dispose = vi.fn();
		onData = vi.fn().mockReturnValue({ dispose: vi.fn() });
		loadAddon = vi.fn();
		refresh = vi.fn();
		focus = vi.fn();
		reset = vi.fn();
		cols = 80;
		rows = 24;
	}
	return { Terminal };
});

vi.mock("@xterm/addon-fit", () => {
	class FitAddon {
		fit = vi.fn();
		proposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 });
	}
	return { FitAddon };
});

vi.mock("@xterm/addon-web-links", () => {
	class WebLinksAddon {
		constructor(handler?: (event: MouseEvent, uri: string) => void) {
			webLinksHandler = handler ?? null;
		}

		activate = vi.fn();
		dispose = vi.fn();
	}

	return { WebLinksAddon };
});

vi.mock("@xterm/addon-webgl", () => {
	class WebglAddon {
		onContextLoss = vi.fn((handler: () => void) => {
			webglContextLossHandler = handler;
			return { dispose: vi.fn() };
		});
		activate = vi.fn();
		dispose = vi.fn();
	}

	return { WebglAddon };
});

vi.mock("./ipc", () => ({
	writePty: vi.fn().mockResolvedValue(undefined),
	resizePty: vi.fn().mockResolvedValue(undefined),
	getPtyBuffer: vi.fn().mockResolvedValue(null),
	openUrl: vi.fn().mockResolvedValue(undefined),
}));

const MockResizeObserver: typeof ResizeObserver = class MockResizeObserver
	implements ResizeObserver
{
	observe = vi.fn<(target: Element, options?: ResizeObserverOptions) => void>();
	unobserve = vi.fn<(target: Element) => void>();
	disconnect = vi.fn<() => void>();
};

const MockIntersectionObserver: typeof IntersectionObserver = class MockIntersectionObserver
	implements IntersectionObserver
{
	readonly root: Element | Document | null = null;
	readonly rootMargin = "";
	readonly thresholds: number[] = [];

	disconnect = vi.fn<() => void>();
	observe = vi.fn<(target: Element) => void>();
	takeRecords = vi.fn<() => IntersectionObserverEntry[]>().mockReturnValue([]);
	unobserve = vi.fn<(target: Element) => void>();
};

// Stub browser APIs not available in jsdom
globalThis.ResizeObserver = MockResizeObserver;
globalThis.IntersectionObserver = MockIntersectionObserver;

Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
	configurable: true,
	get() {
		return 800;
	},
});

Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
	configurable: true,
	get() {
		return 600;
	},
});

describe("terminalPool", () => {
	beforeEach(() => {
		releaseAll();
		listenCallbacks.clear();
		unlistenFns.length = 0;
		webLinksHandler = null;
		webglContextLossHandler = null;
		fontLoadMock = vi.fn().mockResolvedValue([]);
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: {
				ready: Promise.resolve(),
				load: fontLoadMock,
			},
		});
		vi.clearAllMocks();
	});

	afterEach(() => {
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: originalDocumentFonts,
		});
		releaseAll();
	});

	it("acquire creates a new pool entry", async () => {
		const entry = await acquire("task-1");
		expect(entry).toBeDefined();
		expect(entry.taskId).toBe("task-1");
		expect(entry.terminal).toBeDefined();
		expect(entry.fitAddon).toBeDefined();
		expect(entry.hostDiv).toBeInstanceOf(HTMLDivElement);
		expect(entry.attached).toBe(false);
		expect(_getPool().has("task-1")).toBe(true);
	});

	it("initializes terminal with the correct font family stack including JetBrains Mono and Nerd Font fallback", async () => {
		const entry = await acquire("task-font-check");
		expect(getTerminalFontFamily(entry.terminal)).toBe(TERMINAL_FONT_FAMILY);
	});

	it("acquire preloads the bundled terminal web fonts before open", async () => {
		await acquire("task-font-preload");

		expect(fontLoadMock).toHaveBeenCalledWith('13px "JetBrains Mono"');
		expect(fontLoadMock).toHaveBeenCalledWith(
			'13px "NerdFontsSymbols Nerd Font"',
		);
	});

	it("acquire returns existing entry on second call", async () => {
		const entry1 = await acquire("task-2");
		const entry2 = await acquire("task-2");
		expect(entry1).toBe(entry2);
	});

	it("acquire sets up pty-output and pty-exit listeners", async () => {
		await acquire("task-3");
		expect(listenCallbacks.has("pty-output-task-3")).toBe(true);
		expect(listenCallbacks.has("pty-exit-task-3")).toBe(true);
	});

	it("acquire loads WebLinksAddon and routes links through openUrl", async () => {
		const entry = await acquire("task-links");
		const { loadAddon: loadAddonSpy } = getTerminalMocks(entry);
		const openUrlMock = vi.mocked(openUrl);

		expect(loadAddonSpy).toHaveBeenCalledTimes(2);
		expect(webLinksHandler).not.toBeNull();

		getWebLinksHandler()(new MouseEvent("click"), "https://example.com/pool");

		expect(openUrlMock).toHaveBeenCalledWith("https://example.com/pool");
	});

	it("attach appends hostDiv to wrapper and marks attached", async () => {
		const entry = await acquire("task-4");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);

		expect(wrapper.contains(entry.hostDiv)).toBe(true);
		expect(entry.attached).toBe(true);
	});

	it("attach attempts WebGL after terminal.open and tolerates WebGL setup failure", async () => {
		const entry = await acquire("task-webgl");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);

		const { open: openSpy, loadAddon: loadAddonSpy } = getTerminalMocks(entry);

		expect(openSpy).toHaveBeenCalledWith(entry.hostDiv);
		expect(loadAddonSpy).toHaveBeenCalledTimes(3);
		expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(
			loadAddonSpy.mock.invocationCallOrder[2],
		);
	});

	it("attach loads the WebGL renderer for both agent and shell terminal keys", async () => {
		const agentEntry = await acquire("T-50");
		const shellEntry = await acquire("T-50-shell-0");
		const agentWrapper = document.createElement("div");
		const shellWrapper = document.createElement("div");

		await attach(agentEntry, agentWrapper);
		await attach(shellEntry, shellWrapper);

		const { open: agentOpenSpy, loadAddon: agentLoadAddonSpy } =
			getTerminalMocks(agentEntry);
		const { open: shellOpenSpy, loadAddon: shellLoadAddonSpy } =
			getTerminalMocks(shellEntry);

		expect(agentOpenSpy).toHaveBeenCalledWith(agentEntry.hostDiv);
		expect(shellOpenSpy).toHaveBeenCalledWith(shellEntry.hostDiv);
		expect(agentLoadAddonSpy).toHaveBeenCalledTimes(3);
		expect(shellLoadAddonSpy).toHaveBeenCalledTimes(3);
		expect(agentOpenSpy.mock.invocationCallOrder[0]).toBeLessThan(
			agentLoadAddonSpy.mock.invocationCallOrder[2],
		);
		expect(shellOpenSpy.mock.invocationCallOrder[0]).toBeLessThan(
			shellLoadAddonSpy.mock.invocationCallOrder[2],
		);
	});

	it("attach disposes the WebGL addon on context loss", async () => {
		const entry = await acquire("task-webgl-context-loss");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);

		const { loadAddon: loadAddonSpy } = getTerminalMocks(entry);
		const webglAddon = getDisposableAddon(loadAddonSpy.mock.calls.at(2)?.[0]);
		const disposeSpy = vi.mocked(webglAddon.dispose);

		expect(webglContextLossHandler).not.toBeNull();

		getWebglContextLossHandler()();

		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	it("attach is idempotent", async () => {
		const entry = await acquire("task-5");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);
		await attach(entry, wrapper);

		expect(wrapper.childElementCount).toBe(1);
	});

	it("retries the initial fit until the host div has real dimensions", async () => {
		const entry = await acquire("task-delayed-fit");
		const wrapper = document.createElement("div");
		const { fit: fitSpy } = getFitAddonMocks(entry);
		const { refresh: refreshSpy, focus: focusSpy } = getTerminalMocks(entry);
		const originalRaf = globalThis.requestAnimationFrame;

		let frame = 0;
		const rafCallbacks: FrameRequestCallback[] = [];

		globalThis.requestAnimationFrame = vi.fn(
			(callback: FrameRequestCallback) => {
				rafCallbacks.push(callback);
				return rafCallbacks.length;
			},
		);

		Object.defineProperty(entry.hostDiv, "clientWidth", {
			configurable: true,
			get: () => (frame >= 6 ? 800 : 0),
		});
		Object.defineProperty(entry.hostDiv, "clientHeight", {
			configurable: true,
			get: () => (frame >= 6 ? 600 : 0),
		});

		const flushFrame = () => {
			frame += 1;
			const callbacks = rafCallbacks.splice(0);
			callbacks.forEach((callback) => {
				callback(frame * 16);
			});
		};

		try {
			const attachPromise = attach(entry, wrapper);

			for (let index = 0; index < 5; index += 1) {
				flushFrame();
				await Promise.resolve();
			}

			expect(fitSpy).not.toHaveBeenCalled();
			expect(refreshSpy).not.toHaveBeenCalled();

			flushFrame();
			await attachPromise;

			expect(fitSpy).toHaveBeenCalledTimes(1);
			expect(refreshSpy).toHaveBeenCalled();
			expect(focusSpy).toHaveBeenCalled();
		} finally {
			globalThis.requestAnimationFrame = originalRaf;
		}
	});

	it("detach removes hostDiv from DOM", async () => {
		const entry = await acquire("task-6");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);
		expect(wrapper.contains(entry.hostDiv)).toBe(true);

		detach(entry);
		expect(wrapper.contains(entry.hostDiv)).toBe(false);
		expect(entry.attached).toBe(false);
	});

	it("detach is safe to call when not attached", async () => {
		const entry = await acquire("task-7");
		expect(() => detach(entry)).not.toThrow();
	});

	it("release disposes terminal and removes from pool", async () => {
		const entry = await acquire("task-8");
		const { dispose: disposeSpy } = getTerminalMocks(entry);

		release("task-8");

		expect(disposeSpy).toHaveBeenCalled();
		expect(_getPool().has("task-8")).toBe(false);
	});

	it("release calls unlisten functions", async () => {
		await acquire("task-9");
		const savedUnlistens = [...unlistenFns];

		release("task-9");

		for (const fn of savedUnlistens) {
			expect(fn).toHaveBeenCalled();
		}
	});

	it("release is safe for unknown taskId", () => {
		expect(() => release("nonexistent")).not.toThrow();
	});

	it("releaseAll clears all entries", async () => {
		await acquire("task-a");
		await acquire("task-b");
		expect(_getPool().size).toBe(2);

		releaseAll();
		expect(_getPool().size).toBe(0);
	});

	it("pty-output listener writes to terminal", async () => {
		const entry = await acquire("task-10");
		const { write: writeSpy } = getTerminalMocks(entry);

		const outputCb = getListenCallback("pty-output-task-10");
		outputCb({ payload: { data: "hello world" } });

		expect(writeSpy).toHaveBeenCalledWith("hello world");
		expect(entry.ptyActive).toBe(true);
	});

	it("pty-output listener ignores stale instance ids", async () => {
		const entry = await acquire("task-10-stale-output");
		const { write: writeSpy } = getTerminalMocks(entry);
		setCurrentPtyInstance(entry, 2);

		const outputCb = getListenCallback("pty-output-task-10-stale-output");
		outputCb({ payload: { data: "old output", instance_id: 1 } });

		expect(writeSpy).not.toHaveBeenCalled();
		expect(entry.ptyActive).toBe(false);
	});

	it("pty-exit listener marks ptyActive false and needsClear true", async () => {
		const entry = await acquire("task-11");
		entry.ptyActive = true;

		const exitCb = getListenCallback("pty-exit-task-11");
		exitCb({ payload: {} });

		expect(entry.ptyActive).toBe(false);
		expect(entry.needsClear).toBe(true);
	});

	it("pty-exit listener ignores stale instance ids", async () => {
		const entry = await acquire("task-11-stale-exit");
		entry.ptyActive = true;
		setCurrentPtyInstance(entry, 2);

		const exitCb = getListenCallback("pty-exit-task-11-stale-exit");
		exitCb({ payload: { instance_id: 1 } });

		expect(entry.ptyActive).toBe(true);
		expect(entry.needsClear).toBe(false);
	});

	it("needsClear causes terminal.reset on next pty-output", async () => {
		const entry = await acquire("task-12");
		entry.needsClear = true;
		const { reset: resetSpy, write: writeSpy } = getTerminalMocks(entry);

		const outputCb = getListenCallback("pty-output-task-12");
		outputCb({ payload: { data: "new session output" } });

		expect(resetSpy).toHaveBeenCalled();
		expect(writeSpy).toHaveBeenCalledWith("new session output");
		expect(entry.needsClear).toBe(false);
	});

	it("terminal survives detach/re-attach cycle", async () => {
		const entry = await acquire("task-13");
		const wrapper1 = document.createElement("div");
		const wrapper2 = document.createElement("div");
		const { write: writeSpy } = getTerminalMocks(entry);

		await attach(entry, wrapper1);
		expect(entry.attached).toBe(true);

		// Simulate pty output while attached
		const outputCb = getListenCallback("pty-output-task-13");
		outputCb({ payload: { data: "first output" } });

		detach(entry);
		expect(entry.attached).toBe(false);

		// Output while detached still writes to terminal
		outputCb({ payload: { data: "background output" } });
		expect(writeSpy).toHaveBeenCalledWith("background output");

		// Re-acquire returns same entry
		const reacquired = await acquire("task-13");
		expect(reacquired).toBe(entry);

		// Re-attach to different wrapper
		await attach(reacquired, wrapper2);
		expect(wrapper2.contains(entry.hostDiv)).toBe(true);
		expect(entry.attached).toBe(true);
	});

	it("recoverActiveTerminal refits, refreshes, and focuses an attached entry", async () => {
		const entry = await acquire("task-reactivate");
		const wrapper = document.createElement("div");
		await attach(entry, wrapper);

		const { fit: fitSpy } = getFitAddonMocks(entry);
		const { refresh: refreshSpy, focus: focusSpy } = getTerminalMocks(entry);
		fitSpy.mockClear();
		refreshSpy.mockClear();
		focusSpy.mockClear();

		await recoverActiveTerminal(entry);

		expect(fitSpy).toHaveBeenCalledTimes(1);
		expect(refreshSpy).toHaveBeenCalled();
		expect(focusSpy).toHaveBeenCalled();
	});

	describe("isPtyActive", () => {
		it("returns true when pool entry has ptyActive true", async () => {
			const entry = await acquire("task-pty-check");
			entry.ptyActive = true;
			expect(isPtyActive("task-pty-check")).toBe(true);
		});

		it("returns false when pool entry has ptyActive false", async () => {
			const entry = await acquire("task-pty-off");
			entry.ptyActive = false;
			expect(isPtyActive("task-pty-off")).toBe(false);
		});

		it("returns false for unknown task", () => {
			expect(isPtyActive("nonexistent")).toBe(false);
		});
	});

	describe("shell exited state", () => {
		it("reports shell exited when entry is inactive and needs clear", async () => {
			const entry = await acquire("task-shell-exited");
			entry.ptyActive = false;
			entry.needsClear = true;

			expect(isShellExited("task-shell-exited")).toBe(true);
		});

		it("reports false when shell entry is active", async () => {
			const entry = await acquire("task-shell-active");
			entry.ptyActive = true;
			entry.needsClear = false;

			expect(isShellExited("task-shell-active")).toBe(false);
		});

		it("exposes pool-owned shell lifecycle state object", async () => {
			const entry = await acquire("task-shell-state");
			entry.ptyActive = false;
			entry.needsClear = true;

			const state = getShellLifecycleState("task-shell-state");

			expect(state.ptyActive).toBe(false);
			expect(state.shellExited).toBe(true);
			expect(state.currentPtyInstance).toBeNull();
		});

		it("updates pool-owned shell lifecycle state through helper", async () => {
			await acquire("task-shell-update");

			updateShellLifecycleState("task-shell-update", {
				ptyActive: true,
				shellExited: false,
				currentPtyInstance: 42,
			});

			const state = getShellLifecycleState("task-shell-update");
			expect(state.ptyActive).toBe(true);
			expect(state.shellExited).toBe(false);
			expect(state.currentPtyInstance).toBe(42);
		});
	});

	describe("task terminal tab sessions", () => {
		it("creates a default task tab session in the pool", () => {
			const session = getTaskTerminalTabsSession("T-100");

			expect(session.activeTabIndex).toBe(0);
			expect(session.nextIndex).toBe(1);
			expect(session.tabs).toEqual([
				{ index: 0, key: "T-100-shell-0", label: "Shell 1" },
			]);
		});

		it("persists task tab session updates in the pool", () => {
			updateTaskTerminalTabsSession("T-101", {
				tabs: [
					{ index: 0, key: "T-101-shell-0", label: "Shell 1" },
					{ index: 1, key: "T-101-shell-1", label: "Shell 2" },
				],
				activeTabIndex: 1,
				nextIndex: 2,
			});

			const session = getTaskTerminalTabsSession("T-101");
			expect(session.tabs).toHaveLength(2);
			expect(session.activeTabIndex).toBe(1);
			expect(session.nextIndex).toBe(2);
		});

		it("clears only the requested task tab session", () => {
			getTaskTerminalTabsSession("T-102");
			getTaskTerminalTabsSession("T-103");

			clearTaskTerminalTabsSession("T-102");

			expect(getTaskTerminalTabsSession("T-102")).toEqual({
				tabs: [{ index: 0, key: "T-102-shell-0", label: "Shell 1" }],
				activeTabIndex: 0,
				nextIndex: 1,
			});
			expect(getTaskTerminalTabsSession("T-103").tabs).toHaveLength(1);
		});
	});

	describe("spawn state tracking", () => {
		it("shouldSpawnPty returns false while a spawn is pending for the entry", async () => {
			const entry = await acquire("task-spawn-pending");
			expect(shouldSpawnPty(entry)).toBe(true);

			markPtySpawnPending(entry);

			expect(shouldSpawnPty(entry)).toBe(false);
		});

		it("clearPtySpawnPending allows spawning again when PTY is still inactive", async () => {
			const entry = await acquire("task-spawn-clear");
			markPtySpawnPending(entry);

			clearPtySpawnPending(entry);

			expect(shouldSpawnPty(entry)).toBe(true);
		});

		it("shouldSpawnPty stays false when PTY is already active", async () => {
			const entry = await acquire("task-spawn-active");
			entry.ptyActive = true;

			expect(shouldSpawnPty(entry)).toBe(false);
		});
	});

	describe("focusTerminal", () => {
		it("calls terminal.focus() for an attached entry", async () => {
			const entry = await acquire("task-focus");
			const wrapper = document.createElement("div");
			await attach(entry, wrapper);
			const { focus: focusSpy } = getTerminalMocks(entry);
			focusSpy.mockClear();

			focusTerminal("task-focus");

			expect(focusSpy).toHaveBeenCalled();
		});

		it("does nothing for unknown taskId", () => {
			expect(() => focusTerminal("nonexistent")).not.toThrow();
		});

		it("does nothing for a detached entry", async () => {
			const entry = await acquire("task-focus-detached");
			const { focus: focusSpy } = getTerminalMocks(entry);
			focusSpy.mockClear();

			focusTerminal("task-focus-detached");

			expect(focusSpy).not.toHaveBeenCalled();
		});
	});

	describe("modal focus suppression", () => {
		it("attach does not focus terminal when a modal dialog is open", async () => {
			// Simulate an open modal dialog in the DOM
			const dialog = document.createElement("div");
			dialog.setAttribute("role", "dialog");
			dialog.setAttribute("aria-modal", "true");
			document.body.appendChild(dialog);

			const entry = await acquire("task-modal");
			const wrapper = document.createElement("div");
			document.body.appendChild(wrapper);

			// Give hostDiv real dimensions so safeFit doesn't bail
			Object.defineProperty(entry.hostDiv, "clientWidth", { value: 800 });
			Object.defineProperty(entry.hostDiv, "clientHeight", { value: 600 });

			const { focus: focusSpy } = getTerminalMocks(entry);
			focusSpy.mockClear();

			await attach(entry, wrapper);

			// Flush the requestAnimationFrame callback
			await new Promise((resolve) => requestAnimationFrame(resolve));

			expect(focusSpy).not.toHaveBeenCalled();

			// Cleanup
			document.body.removeChild(dialog);
			document.body.removeChild(wrapper);
		});

		it("attach focuses terminal when no modal dialog is open", async () => {
			const entry = await acquire("task-no-modal");
			const wrapper = document.createElement("div");
			document.body.appendChild(wrapper);

			Object.defineProperty(entry.hostDiv, "clientWidth", { value: 800 });
			Object.defineProperty(entry.hostDiv, "clientHeight", { value: 600 });

			const { focus: focusSpy } = getTerminalMocks(entry);
			focusSpy.mockClear();

			await attach(entry, wrapper);

			// Flush the requestAnimationFrame callback
			await new Promise((resolve) => requestAnimationFrame(resolve));

			expect(focusSpy).toHaveBeenCalled();

			// Cleanup
			document.body.removeChild(wrapper);
		});
	});

	describe("shell-key independence", () => {
		it("agent key and shell key create separate pool entries", async () => {
			const agentEntry = await acquire("T-42");
			const shellEntry = await acquire("T-42-shell");

			expect(agentEntry).toBeDefined();
			expect(shellEntry).toBeDefined();
			expect(agentEntry).not.toBe(shellEntry);
			expect(agentEntry.taskId).toBe("T-42");
			expect(shellEntry.taskId).toBe("T-42-shell");
			expect(_getPool().has("T-42")).toBe(true);
			expect(_getPool().has("T-42-shell")).toBe(true);
			expect(_getPool().size).toBe(2);
		});

		it("releasing agent key does not affect shell key entry", async () => {
			await acquire("T-43");
			const shellEntry = await acquire("T-43-shell");

			release("T-43");

			expect(_getPool().has("T-43")).toBe(false);
			expect(_getPool().has("T-43-shell")).toBe(true);
			expect(_getPool().get("T-43-shell")).toBe(shellEntry);
		});

		it("both entries have independent ptyActive state", async () => {
			const agentEntry = await acquire("T-44");
			const shellEntry = await acquire("T-44-shell");

			const agentOutputCb = getListenCallback("pty-output-T-44");
			agentOutputCb({ payload: { data: "agent output" } });

			expect(agentEntry.ptyActive).toBe(true);
			expect(shellEntry.ptyActive).toBe(false);

			const shellOutputCb = getListenCallback("pty-output-T-44-shell");
			shellOutputCb({ payload: { data: "shell output" } });

			expect(agentEntry.ptyActive).toBe(true);
			expect(shellEntry.ptyActive).toBe(true);

			const agentExitCb = getListenCallback("pty-exit-T-44");
			agentExitCb({ payload: {} });

			expect(agentEntry.ptyActive).toBe(false);
			expect(shellEntry.ptyActive).toBe(true);
		});
	});

	describe("releaseAllForTask", () => {
		it("releases all shell entries matching {taskId}-shell-* pattern", async () => {
			// Create agent terminal and multiple shell terminals
			await acquire("task-1");
			await acquire("task-1-shell-0");
			await acquire("task-1-shell-1");
			await acquire("task-1-shell-2");

			expect(_getPool().size).toBe(4);

			// Release all shells for task-1
			const count = releaseAllForTask("task-1");

			// Should have released 3 shell entries
			expect(count).toBe(3);
			// Agent terminal should still exist
			expect(_getPool().has("task-1")).toBe(true);
			// All shell entries should be gone
			expect(_getPool().has("task-1-shell-0")).toBe(false);
			expect(_getPool().has("task-1-shell-1")).toBe(false);
			expect(_getPool().has("task-1-shell-2")).toBe(false);
			expect(_getPool().size).toBe(1);
		});

		it("does not release agent terminal or other tasks shells", async () => {
			// Create entries for task-1 and task-2
			await acquire("task-1");
			await acquire("task-1-shell-0");
			await acquire("task-1-shell-1");
			await acquire("task-2");
			await acquire("task-2-shell-0");

			expect(_getPool().size).toBe(5);

			// Release all shells for task-1
			const count = releaseAllForTask("task-1");

			// Should have released only 2 task-1 shells
			expect(count).toBe(2);
			// task-1 agent should still exist
			expect(_getPool().has("task-1")).toBe(true);
			// task-2 and its shell should still exist
			expect(_getPool().has("task-2")).toBe(true);
			expect(_getPool().has("task-2-shell-0")).toBe(true);
			expect(_getPool().size).toBe(3);
		});

		it("returns 0 when task has no shell entries", async () => {
			// Create only agent terminal
			await acquire("task-3");

			expect(_getPool().size).toBe(1);

			// Release all shells for task-3 (none exist)
			const count = releaseAllForTask("task-3");

			// Should return 0
			expect(count).toBe(0);
			// Agent terminal should still exist
			expect(_getPool().has("task-3")).toBe(true);
			expect(_getPool().size).toBe(1);
		});

		it("returns 0 when task does not exist", () => {
			expect(_getPool().size).toBe(0);

			// Release all shells for non-existent task
			const count = releaseAllForTask("nonexistent-task");

			// Should return 0
			expect(count).toBe(0);
			expect(_getPool().size).toBe(0);
		});

		it("calls unlisten functions for released entries", async () => {
			await acquire("task-4");
			await acquire("task-4-shell-0");
			const savedUnlistens = [...unlistenFns];

			releaseAllForTask("task-4");

			// At least one unlisten should have been called (for the shell entry)
			expect(savedUnlistens.some((fn) => fn.mock.calls.length > 0)).toBe(true);
		});

		it("disposes terminals for released entries", async () => {
			const shell0Entry = await acquire("task-5-shell-0");
			const shell1Entry = await acquire("task-5-shell-1");
			const { dispose: shell0Spy } = getTerminalMocks(shell0Entry);
			const { dispose: shell1Spy } = getTerminalMocks(shell1Entry);

			releaseAllForTask("task-5");

			expect(shell0Spy).toHaveBeenCalled();
			expect(shell1Spy).toHaveBeenCalled();
		});
	});
});
