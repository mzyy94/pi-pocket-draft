/**
 * The session menu row's hint: it says how many drafts the tab's session has, follows conversation changes and the
 * module's own events, and a failed read leaves the last count in place.
 */
import { check, done, makePocket, makeServer, menuHint, tick } from "./harness.mjs";

const server = await makeServer([{ id: 7 }, { id: 9 }]);

// Before the module loads: 2 drafts on session 7, 1 on session 9.
await server.api("drafts/7", { text: "a" }, { method: "POST" });
await server.api("drafts/7", { text: "b" }, { method: "POST" });
await server.api("drafts/9", { text: "c" }, { method: "POST" });

const app = makePocket(server, { session: 7 });
const mod = await import("../drafts/index.js");
mod.default(app.pocket);

check("menu row registered", app.menus.length === 1 && app.menus[0].spec.label === "Drafts");
await tick();
check("initial hint = 2 saved", menuHint(app.menus[0]) === "2 saved");

// A drafts event for the tab's session refreshes the count.
for (const fn of app.eventListeners["drafts"] ?? []) {
    fn({ session: 7 });
}
await tick();
check("event -> still 2 saved", menuHint(app.menus[0]) === "2 saved");

const one = (await server.api("list/7")).drafts[0];
await server.api(`drafts/7/${one.id}`, undefined, { method: "DELETE" });
for (const fn of app.eventListeners["drafts"] ?? []) {
    fn({ session: 7 });
}
await tick();
check("event after delete -> 1 saved", menuHint(app.menus[0]) === "1 saved");

// An event for another session does not change it.
for (const fn of app.eventListeners["drafts"] ?? []) {
    fn({ session: 9 });
}
await tick();
check("foreign session event ignored", menuHint(app.menus[0]) === "1 saved");

// Switching conversation switches the count.
app.fireConv(9);
await tick();
check("switch to session 9 -> 1 saved", menuHint(app.menus[0]) === "1 saved");
await server.api("drafts/9", { text: "d" }, { method: "POST" });
for (const fn of app.eventListeners["drafts"] ?? []) {
    fn({ session: 9 });
}
await tick();
check("session 9 grows -> 2 saved", menuHint(app.menus[0]) === "2 saved");

// A failed read leaves the last hint as it was.
app.setApi(() => Promise.reject(new Error("down")));
app.fireConv(7);
await tick();
check("failed read keeps the last hint", menuHint(app.menus[0]) === "2 saved");

done();
