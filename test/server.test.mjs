/**
 * The routes of drafts.ts: validation, order, the per-session cap, session isolation, and the counts route.
 */
import { check, done, makeServer } from "./harness.mjs";

const server = await makeServer([{ id: 1 }, { id: 2 }]);
const { api } = server;

async function statusOf(fn) {
    try {
        await fn();
        return null;
    } catch (e) {
        return e.status;
    }
}

check("GET unknown session -> 404", (await statusOf(() => api("list/99"))) === 404);
check("GET empty list", JSON.stringify(await api("list/1")) === '{"drafts":[]}');

check("POST blank -> 400", (await statusOf(() => api("drafts/1", { text: "   " }, { method: "POST" }))) === 400);
check("POST non-text -> 400", (await statusOf(() => api("drafts/1", { text: 42 }, { method: "POST" }))) === 400);
check(
    "POST too long -> 400",
    (await statusOf(() => api("drafts/1", { text: "x".repeat(20_001) }, { method: "POST" }))) === 400,
);

const first = await api("drafts/1", { text: "  first draft \n" }, { method: "POST" });
check("POST saves trimmed text", first.draft.text === "first draft" && typeof first.draft.id === "string");
const second = await api("drafts/1", { text: "second draft" }, { method: "POST" });

let list = (await api("list/1")).drafts;
check("GET newest first", JSON.stringify(list.map((d) => d.text)) === '["second draft","first draft"]');

// The 101st draft pushes out the oldest.
for (let i = 3; i <= 101; i++) {
    await api("drafts/1", { text: `d${i}` }, { method: "POST" });
}
list = (await api("list/1")).drafts;
check("capped at 100", list.length === 100);
check("oldest gone", !list.some((d) => d.text === "first draft"));

check("PUT blank -> 400", (await statusOf(() => api(`drafts/1/${second.draft.id}`, { text: "  " }, { method: "PUT" }))) === 400);
check("PUT unknown id -> 404", (await statusOf(() => api("drafts/1/nope", { text: "x" }, { method: "PUT" }))) === 404);

const target = list[0].id;
await api(`drafts/1/${target}`, { text: "rewritten" }, { method: "PUT" });
list = (await api("list/1")).drafts;
check("PUT overwrites in place", list[0].text === "rewritten");

check("DELETE unknown id -> 404", (await statusOf(() => api("drafts/1/nope", undefined, { method: "DELETE" }))) === 404);
await api(`drafts/1/${target}`, undefined, { method: "DELETE" });
list = (await api("list/1")).drafts;
check("DELETE removes", list.length === 99 && !list.some((d) => d.text === "rewritten"));

// Session 2 never saw any of it.
check("per-session isolation", (await api("list/2")).drafts.length === 0);

// The counts route names only the sessions with drafts.
check("counts: only non-empty sessions", JSON.stringify((await api("counts")).counts) === '{"1":99}');

done();
