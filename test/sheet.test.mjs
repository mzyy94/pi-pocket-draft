/**
 * The sheet component, end to end against the real routes: save, Use (into the message box), Edit (save and cancel),
 * and the twice-pressed Delete.
 */
import { check, done, find, makePocket, makeServer, rowWith, tick, wordBtn } from "./harness.mjs";

const server = await makeServer([{ id: 7 }]);

// Three drafts, newest first: B, A, C.
await server.api("drafts/7", { text: "line one\nline two" }, { method: "POST" }); // A
await server.api("drafts/7", { text: "second draft" }, { method: "POST" }); // B
await server.api("drafts/7", { text: "third draft" }, { method: "POST" }); // C

const app = makePocket(server, { session: 7 });
const { pocket, render, inserted, openedSheets } = app;

// The Use button's first child is its icon; word buttons match their first word.
const useBtn = (scope) =>
    find(scope, (x) => x.props?.class?.startsWith("button x-drafts-act") && Array.isArray(x.props?.children) && x.props.children[1] === "Use");

const mod = await import("../drafts/index.js");
mod.default(pocket);

let v = render();
await tick();
v = render();

check("rows=3", find(v, (x) => x.props?.class === "x-drafts-row").length === 3);
check(
    "use buttons=3",
    useBtn(v).length === 3,
);
check("send icons=3", find(v, (x) => x.props?.name === "send" && x.props?.size === 14).length === 3);
check("edit buttons=3", find(v, wordBtn(null, "Edit")).length === 3);
check("delete buttons=3", find(v, wordBtn(null, "Delete")).length === 3);
check("no copy button left", find(v, (x) => Array.isArray(x.props?.children) && x.props.children.includes("Copy")).length === 0);

/* ── Use: the text goes to the message box and the draft leaves the list ─────────────────── */

useBtn(rowWith(v, "second draft"))[0].props.onClick();
await tick();
v = render();
check("insertText got the full text", inserted.length === 1 && inserted[0] === "second draft");
check("used row gone", rowWith(v, "second draft") === undefined);
check("server list has 2", (await server.api("list/7")).drafts.length === 2);

/* ── Edit: expand, save over with Ctrl+Enter, then cancel a second edit ──────────────────── */

find(rowWith(v, "line one"), wordBtn(null, "Edit"))[0].props.onClick();
await tick();
v = render();
let editor = find(v, (x) => x.props?.class === "x-drafts-row x-drafts-editing");
check("editor row", editor.length === 1);
let ta = find(editor[0], (x) => x.props?.class === "x-drafts-text")[0];
check("prefilled", ta.props.value === "line one\nline two");
ta.props.onInput({ currentTarget: { value: "draft A v2" } });
await tick();
v = render();
editor = find(v, (x) => x.props?.class === "x-drafts-row x-drafts-editing");
find(editor[0], (x) => x.props?.class === "x-drafts-text")[0].props.onKeyDown({
    key: "Enter",
    ctrlKey: true,
    metaKey: false,
    preventDefault() {},
});
await tick();
v = render();
check("editor closed after save", find(v, (x) => x.props?.class === "x-drafts-row x-drafts-editing").length === 0);
check("server has the edited text", (await server.api("list/7")).drafts.some((d) => d.text === "draft A v2"));

find(rowWith(v, "draft A v2"), wordBtn(null, "Edit"))[0].props.onClick();
await tick();
v = render();
ta = find(
    v,
    (x) => x.props?.class === "x-drafts-text" && typeof x.props.value === "string" && x.props.value.startsWith("draft A"),
)[0];
ta.props.onInput({ currentTarget: { value: "changed" } });
await tick();
v = render();
find(v, wordBtn(null, "Cancel"))[0].props.onClick();
await tick();
v = render();
check(
    "cancel keeps the server text",
    (await server.api("list/7")).drafts.some((d) => d.text === "draft A v2") && !JSON.stringify(v).includes(">changed"),
);

/* ── Delete: first press arms, the armed second deletes, blur disarms ─────────────────────── */

let rowA = rowWith(v, "draft A v2");
find(rowA, wordBtn(null, "Delete"))[0].props.onClick();
await tick();
v = render();
rowA = rowWith(v, "draft A v2");
const armed = find(rowA, wordBtn(null, "Delete it"))[0];
check("armed: label + danger", armed !== undefined && armed.props.class.includes("x-drafts-danger"));
armed.props.onClick();
await tick();
v = render();
check("row gone after the second press", rowWith(v, "draft A v2") === undefined);
check("server list has 1", (await server.api("list/7")).drafts.length === 1);

rowA = rowWith(v, "third draft");
find(rowA, wordBtn(null, "Delete"))[0].props.onClick();
await tick();
v = render();
const armedC = find(rowWith(v, "third draft"), wordBtn(null, "Delete it"))[0];
armedC.props.onBlur();
await tick();
v = render();
check(
    "blur disarms",
    find(rowWith(v, "third draft"), wordBtn(null, "Delete it")).length === 0 &&
        (await server.api("list/7")).drafts.length === 1,
);

/* ── Saving from the top field adds a newest-first draft ─────────────────────────────────── */

const box = find(v, (x) => x.props?.class === "x-drafts-text" && x.props.placeholder)[0];
box.props.onInput({ currentTarget: { value: "fresh from the box" } });
await tick();
v = render();
find(v, (x) => x.props?.class === "button primary")[0].props.onClick();
await tick();
v = render();
check(
    "top save lands newest first",
    JSON.stringify((await server.api("list/7")).drafts.map((d) => d.text)) === '["fresh from the box","third draft"]',
);
check("box cleared", find(v, (x) => x.props?.class === "x-drafts-text" && x.props.placeholder)[0].props.value === "");

check("no sheet was opened by any of this", openedSheets.length === 0);

done();
