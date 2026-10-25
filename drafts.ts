/**
 * Pi Pocket Drafts: saved message drafts for a session, with a button in the message box and a row in the session's
 * menu that open a sheet to save one and copy one back into the box. The drafts live in a Pi Durable document per
 * conversation (`x.drafts.list`), so they follow the session across tabs and devices. Copying a draft puts its text on
 * the clipboard and takes it out of the list. The browser module is `drafts/index.js`.
 */
import { randomUUID } from "node:crypto";
import { defineDoc } from "@earendil-works/pi-durable";
import type { ConversationId } from "@earendil-works/pi-durable";
import type { Web } from "./_pocket.d.ts";

/** The version of Pi Pocket's extension API this module is written for. */
export const pocketApi = 1;

/** One saved draft. `id` never changes; `savedAt` is the time it was saved. */
type Draft = {
    id: string;
    text: string;
    savedAt: number;
};

/** A session's list with no room makes its oldest draft go, so a document stays small however often one saves. */
const MAX_DRAFTS = 100;

/** The drafts of one session, newest first. `fork: "current"` keeps them in a fork. */
const SessionDrafts = defineDoc<{ drafts: Draft[] }>({
    kind: "x.drafts.list",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ drafts: [] }),
    checkpointWhen: () => false,
});

/** A session id from a path, or a 404. The caller checks that the person sees it. */
function sessionOf(value: string, web: Web): number {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id < 1) {
        throw web.error(404, "No such session");
    }

    return id;
}

/** Pi Durable brands its ids; a session number from a route is one after the visibility check. */
function conversationOf(id: number): ConversationId {
    return id as unknown as ConversationId;
}

/** Draft text from the browser: text, not empty, bounded. Ends of whitespace go; the rest stays as typed. */
function textOf(value: unknown, web: Web): string {
    if (typeof value !== "string") {
        throw web.error(400, "The draft must be text.");
    }

    const text = value.trim();

    if (text === "") {
        throw web.error(400, "The draft must not be empty.");
    }

    if (text.length > 20_000) {
        throw web.error(400, "The draft is too long (20,000 characters at most).");
    }

    return text;
}

export default function createDrafts(_host: unknown, web: Web) {
    // The drafts of one session; a session must be one that this person sees.
    web.route("GET", "list/:session", async ({ params, snapshot, context, sessions }) => {
        const session = sessionOf(params.session, web);

        if (!sessions().some((each) => each.id === session)) {
            throw web.error(404, "No such session");
        }

        const doc = await snapshot(SessionDrafts, conversationOf(session), context);

        return { drafts: [...(doc?.drafts ?? [])] };
    });

    web.route("POST", "drafts/:session", async ({ params, body, commit, sessions }) => {
        const session = sessionOf(params.session, web);

        if (!sessions().some((each) => each.id === session)) {
            throw web.error(404, "No such session");
        }

        const text = textOf(body.text, web);

        const draft = await commit(async (tx) => {
            const doc = await tx.doc(SessionDrafts, conversationOf(session));
            const next: Draft = { id: randomUUID(), text, savedAt: Date.now() };

            doc.drafts.unshift(next);

            if (doc.drafts.length > MAX_DRAFTS) {
                doc.drafts.length = MAX_DRAFTS;
            }

            return next;
        });

        web.send("drafts", { session });

        return { draft };
    });

    // Copying a draft takes it out of the list. Throwing rolls the commit back, so a bad id changes nothing.
    web.route("DELETE", "drafts/:session/:id", async ({ params, commit, sessions }) => {
        const session = sessionOf(params.session, web);

        if (!sessions().some((each) => each.id === session)) {
            throw web.error(404, "No such session");
        }

        await commit(async (tx) => {
            const doc = await tx.doc(SessionDrafts, conversationOf(session));
            const index = doc.drafts.findIndex((each) => each.id === params.id);

            if (index === -1) {
                throw web.error(404, "No such draft");
            }

            doc.drafts.splice(index, 1);
        });

        web.send("drafts", { session });

        return { ok: true };
    });

    // The button, the menu row, and the sheet live in the folder beside this file.
    web.client("drafts");
}
