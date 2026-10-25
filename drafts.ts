/**
 * Pi Pocket Drafts: saved message drafts that live only in this tab's browser storage, with a button in the message box
 * that opens a sheet to save one and copy one back into the box. The drafts are stored under `x.drafts.list` in
 * `localStorage`; the server keeps no draft, so no other person can see them. Copying a draft puts its text on the
 * clipboard and takes it out of the list. The browser module is `drafts/index.js`.
 */
import type { Web } from "./_pocket.d.ts";

/** The version of Pi Pocket's extension API this module is written for. */
export const pocketApi = 1;

export default function createDrafts(_host: unknown, web: Web) {
    // No routes and no tools: the drafts live in the tab's localStorage, not on the server. The browser module beside
    // this file adds the button and the sheet.
    web.client("drafts");
}
