/**
 * Shared mocks for the drafts extension's tests: a `web` with an in-memory doc store that backs `drafts.ts`' real
 * route handlers, and a `pocket` good enough to run its browser module. Each test file is one process; Node 24 runs
 * the `.ts` module with type stripping. Run them with `npm test` (a `node_modules` link next to the repo, as the
 * extensions folder has, resolves `htm`, `preact`, and `@earendil-works/pi-durable`).
 */
import { fileURLToPath } from "node:url";
import htm from "htm";
import { h } from "preact";

export const html = htm.bind(h);

globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

/** The app's `web.error`, as the routes throw it. */
export class HttpErr extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** One pass/fail ledger per file. */
let passed = 0;
let failed = 0;

export function check(name, cond) {
    if (cond) {
        passed++;
    } else {
        failed++;
        console.log("  FAIL:", name);
    }
}

export function done() {
    console.log(`\n${failed === 0 ? "ALL PASS" : `${String(failed)} FAILURE(S)`}: ${String(passed)} passed, ${String(failed)} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

export const tick = () => new Promise((r) => setTimeout(r, 10));

/**
 * The server side: `drafts.ts` installed against an in-memory doc store, and `api(path, body, opts)` answering as the
 * app's `pocket.api` would. `visible` is what `request.sessions()` answers for.
 */
export async function makeServer(visible = [{ id: 7 }, { id: 9 }]) {
    const routes = [];

    const web = {
        route(method, path, handler) {
            routes.push({ method, path, handler });
        },
        error: (status, message) => new HttpErr(status, message),
        send: () => {},
        client: () => {},
    };

    const mod = await import(fileURLToPath(new URL("../drafts.ts", import.meta.url)));
    mod.default({}, web);

    // (document kind, conversation id) -> the doc object, as Pi Durable would keep it.
    const store = new Map();

    async function snapshot(Doc, id) {
        return store.get(`${Doc.kind}:${id}`);
    }

    async function commit(fn) {
        return fn({
            doc: async (Doc, id) => {
                const k = `${Doc.kind}:${id}`;

                if (!store.has(k)) {
                    store.set(k, { drafts: [] });
                }

                return store.get(k);
            },
        });
    }

    function api(path, body, opts) {
        const method = opts?.method ?? "GET";
        const parts = path.split("/");
        let spec;

        if (parts[0] === "list") {
            spec = { method: "GET", path: "list/:session", params: { session: parts[1] } };
        } else if (parts.length === 2 && parts[0] === "drafts") {
            spec = { method: "POST", path: "drafts/:session", params: { session: parts[1] } };
        } else if (parts[0] === "counts") {
            spec = { method: "GET", path: "counts", params: {} };
        } else {
            spec = {
                method,
                path: "drafts/:session/:id",
                params: { session: parts[1], id: decodeURIComponent(parts[2]) },
            };
        }

        const r = routes.find((x) => x.method === spec.method && x.path === spec.path);

        return Promise.resolve(r.handler({ ...spec, body, snapshot, commit, context: {}, sessions: () => visible }));
    }

    return { web, routes, store, api, visible };
}

/**
 * The browser side: a `pocket` that captures what the module adds (sheet, menu, chips), records its calls
 * (`insertText`, `openSheet`, `openConversation`), and runs the sheet component against real hook state.
 * `openConversation` only records; tests call `fireConv(id)` when navigation lands.
 */
export function makePocket(server, { session = null } = {}) {
    let currentSession = session;
    const states = [];
    let hookN = 0;
    const inserted = [];
    const openedSheets = [];
    const openedConvos = [];
    const eventListeners = {};
    const convListeners = new Set();
    const menus = [];
    const chipUpdates = [];
    let sheetSpec = null;
    let chipSpec = null;

    const pocket = {
        html,
        conversationId: () => currentSession,
        api: server.api,
        insertText: (t) => inserted.push(t),
        openSheet: (id) => openedSheets.push(id),
        openConversation: (id) => openedConvos.push(id),
        on(event, fn) {
            (eventListeners[event] ??= []).push(fn);

            return () => {
                const list = eventListeners[event];
                const at = list.indexOf(fn);

                if (at !== -1) {
                    list.splice(at, 1);
                }
            };
        },
        onConversation(fn) {
            convListeners.add(fn);
            fn(currentSession);

            return () => convListeners.delete(fn);
        },
        useState(init) {
            const i = hookN++;

            if (states[i] === undefined) {
                states[i] = typeof init === "function" ? init() : init;
            }

            return [states[i], (v) => (states[i] = v)];
        },
        useRef: () => ({ current: { focus() {} } }),
        // Run effects at once, as a mounted component's first draw does.
        useEffect(fn) {
            fn();
        },
        Icon: (p) => h("i", { "data-icon": p.name, size: p.size }),
        Loader: () => h("div"),
        sheet(s) {
            sheetSpec = s;
        },
        menu(spec) {
            const rec = { spec, updates: [] };
            menus.push(rec);

            return {
                update(patch) {
                    rec.updates.push(patch);
                },
                remove() {},
            };
        },
        sessionChips(spec) {
            chipSpec = spec;
            chipUpdates.push({ chips: spec.chips });

            return {
                update(patch) {
                    chipUpdates.push(patch);
                },
                remove() {},
            };
        },
        composerButton: () => ({ update() {}, remove() {} }),
        style: () => {},
    };

    const fireConv = (id) => {
        currentSession = id;

        for (const fn of [...convListeners]) {
            fn(id);
        }
    };

    return {
        pocket,
        fireConv,
        session: () => currentSession,
        inserted,
        openedSheets,
        openedConvos,
        eventListeners,
        convListeners,
        menus,
        chipUpdates,
        chipSpec: () => chipSpec,
        sheetComponent: () => sheetSpec?.component,
        setApi: (fn) => {
            pocket.api = fn;
        },
        render: () => {
            hookN = 0;

            return sheetSpec.component({ close() {} });
        },
    };
}

/** The menu row's current hint: the last update's, or the spec's. */
export function menuHint(rec) {
    const last = rec.updates.at(-1);

    return last?.hint ?? rec.spec.hint;
}

/** Walk a VNode tree (htm keeps `.map()` results as array children). */
export function find(vnode, match, out = []) {
    if (Array.isArray(vnode)) {
        for (const c of vnode) {
            find(c, match, out);
        }

        return out;
    }

    if (!vnode || typeof vnode !== "object" || vnode.type === undefined) {
        return out;
    }

    if (match(vnode)) {
        out.push(vnode);
    }

    for (const c of Array.isArray(vnode.props?.children) ? vnode.props.children : []) {
        find(c, match, out);
    }

    return out;
}

/** A `button x-drafts-act` whose label is a plain word. */
export const wordBtn =
    (scope, label) =>
    (x) =>
        x.props?.class?.startsWith("button x-drafts-act") &&
        (x.props?.children === label || (Array.isArray(x.props?.children) && x.props.children[0] === label));

/** A draft row whose text mentions `text`. */
export const rowWith =
    (v, text) =>
    find(v, (x) => x.props?.class === "x-drafts-row").find((r) => JSON.stringify(r.props.children).includes(text));
