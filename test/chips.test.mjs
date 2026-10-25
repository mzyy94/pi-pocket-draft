/**
 * The session list's chips: a pencil and count under each session that has drafts, answered at once from the map the
 * events keep current. A tap opens the session through normal navigation, then its drafts sheet.
 */
import { check, done, makePocket, makeServer, tick } from "./harness.mjs";

const server = await makeServer([{ id: 7 }, { id: 9 }, { id: 11 }]);

// Before the module loads: 2 drafts on session 7, 1 on session 9, none on 11.
await server.api("drafts/7", { text: "a" }, { method: "POST" });
await server.api("drafts/7", { text: "b" }, { method: "POST" });
await server.api("drafts/9", { text: "c" }, { method: "POST" });

check("counts route: only non-empty sessions", JSON.stringify((await server.api("counts")).counts) === '{"7":2,"9":1}');

const app = makePocket(server, { session: null }); // the tab shows the session list (home)
const mod = await import("../drafts/index.js");
mod.default(app.pocket);

check("chips registered", app.chipSpec() !== null && app.chipSpec().id === "drafts");
await tick();

const chips = (id) => app.chipUpdates[app.chipUpdates.length - 1].chips({ id, title: `S${id}` });

// Sync answers: a pencil and the count for sessions with drafts, nothing for empty ones.
check("session 7 chip", chips(7).length === 1 && chips(7)[0].label === "✎ 2");
check("chip title", chips(7)[0].title === "2 saved drafts — tap to open");
check("session 9 chip, singular", chips(9).length === 1 && chips(9)[0].label === "✎ 1" && chips(9)[0].title.includes("1 saved draft —"));
check("empty session: no chips", chips(11).length === 0);

// Tap while the tab shows no session: navigate first, the sheet waits for the switch to land.
check("nothing open before the tap", app.openedSheets.length === 0 && app.openedConvos.length === 0);
chips(7)[0].run();
check("openConversation called with 7", app.openedConvos.length === 1 && app.openedConvos[0] === 7);
check("sheet not open before the switch lands", app.openedSheets.length === 0);
app.fireConv(7);
check("sheet opens once the tab shows session 7", app.openedSheets.length === 1 && app.openedSheets[0] === "drafts");

// The one-shot intent is consumed: a later switch to 7 opens no further sheet.
app.fireConv(null);
app.fireConv(7);
check("intent consumed, no second sheet", app.openedSheets.length === 1);

// Tapping the chip of the session already shown opens the sheet at once, without navigating.
app.fireConv(9);
chips(9)[0].run();
check("already there: sheet opens at once", app.openedSheets.length === 2 && app.openedSheets[1] === "drafts");
check("no extra navigation", app.openedConvos.length === 1);

// A drafts event refreshes the chips through the counts route, with a new function.
const before = app.chipUpdates.length;
const c9 = (await server.api("list/9")).drafts[0];
await server.api(`drafts/9/${c9.id}`, undefined, { method: "DELETE" });
for (const fn of app.eventListeners["drafts"] ?? []) {
    fn({ session: 9 });
}
await tick();
const latest = app.chipUpdates[app.chipUpdates.length - 1];
check("event refreshes with a new chips function", app.chipUpdates.length > before && typeof latest.chips === "function");
check("session 9 now chipless", latest.chips({ id: 9 }).length === 0);
check("session 7 unchanged", latest.chips({ id: 7 }).length === 1);

// An intent whose navigation never lands gives up after the timeout, so a later unrelated switch opens nothing.
app.fireConv(null);
const realSetTimeout = globalThis.setTimeout;
let giveUp = null;
globalThis.setTimeout = (fn, ms) => {
    if (ms === 5000) {
        giveUp = fn;
        return 12345;
    }

    return realSetTimeout(fn, ms);
};
chips(7)[0].run();
check("abandoned navigation: no sheet yet", app.openedSheets.length === 2);
giveUp();
app.fireConv(7); // a much later, unrelated switch to 7
check("the give-up cancelled the intent", app.openedSheets.length === 2);
globalThis.setTimeout = realSetTimeout;

done();
