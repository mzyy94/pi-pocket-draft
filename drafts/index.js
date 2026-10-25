/**
 * The drafts browser module: a button in the message box's row and a row in the session's menu, both opening a sheet
 * of the session's saved drafts. A person types text and saves it; the draft lands below, newest first. Using one puts
 * its text into the message box, closes the sheet, and takes it out of the list. Editing one expands it into a field to
 * save over or cancel. Deleting one asks twice: the first press arms the button, the second takes the draft out. The
 * drafts live in `drafts.ts`' per-session document, so they follow the session across tabs and devices.
 */

/** The version of `pocket` this module was written for. */
export const pocketApi = 1;

/** A pencil, for a message not sent yet. */
const PEN = "M17 3a2.83 2.83 0 014 4L7.5 20.5 2 22l1.5-5.5L17 3Z";

/** A first line for a row, short enough to keep it on one line. */
function preview(text) {
    const line = text.trim().split("\n", 1)[0] ?? "";

    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}

export default function setup(pocket) {
    const { html, useEffect, useRef, useState } = pocket;

    /* ── The sheet: save a draft for the session, copy one back ─────────────────────────────── */

    function Drafts() {
        const session = pocket.conversationId();
        const [text, setText] = useState("");
        const [drafts, setDrafts] = useState(null);
        const [error, setError] = useState(null);
        const [busy, setBusy] = useState(false);
        // The draft being edited, `{ id, text }`, or none.
        const [editing, setEditing] = useState(null);
        // The id whose Delete button is armed: the first press arms it, the second deletes.
        const [armed, setArmed] = useState(null);
        const box = useRef(null);
        const editBox = useRef(null);

        // The sheet opens with the field ready to type into.
        useEffect(() => {
            requestAnimationFrame(() => box.current?.focus());
        }, []);

        // An editor opens with its field ready to type into.
        useEffect(() => {
            if (editing !== null) {
                requestAnimationFrame(() => editBox.current?.focus());
            }
        }, [editing === null]);

        const load = async (signal) => {
            try {
                const data = await pocket.api(`list/${session}`, undefined, { signal });

                setDrafts(data.drafts);
                setError(null);
            } catch (failure) {
                if (!signal?.aborted) {
                    setError(errorText(failure));
                }
            }
        };

        useEffect(() => {
            const controller = new AbortController();
            void load(controller.signal);
            // Another tab saved, edited, or copied a draft of this session: show the same list here.
            const off = pocket.on("drafts", (data) => {
                if (data !== null && typeof data === "object" && data.session === session) {
                    void load();
                }
            });

            return () => {
                controller.abort();
                off();
            };
        }, []);

        async function save() {
            const value = text.trim();

            if (value === "" || busy) {
                return;
            }

            setBusy(true);
            setError(null);

            try {
                const data = await pocket.api(`drafts/${session}`, { text: value }, { method: "POST" });

                setDrafts([data.draft, ...drafts]);
                setText("");
                requestAnimationFrame(() => box.current?.focus());
            } catch (failure) {
                setError(errorText(failure));
            } finally {
                setBusy(false);
            }
        }

        async function use(draft) {
            if (busy) {
                return;
            }

            if (typeof pocket.insertText !== "function") {
                setError("This app is too old to put a draft in the message box.");
                return;
            }

            setBusy(true);
            setError(null);

            try {
                // It closes the sheet, so the box shows; the draft leaves the list only once it is in the box.
                pocket.insertText(draft.text);
                await pocket.api(`drafts/${session}/${encodeURIComponent(draft.id)}`, undefined, {
                    method: "DELETE",
                });
                setDrafts(drafts.filter((each) => each.id !== draft.id));
            } catch (failure) {
                setError(errorText(failure));
            } finally {
                setBusy(false);
            }
        }

        function startEdit(draft) {
            if (busy) {
                return;
            }

            setArmed(null);
            setError(null);
            setEditing({ id: draft.id, text: draft.text });
        }

        function cancelEdit() {
            if (busy) {
                return;
            }

            setEditing(null);
        }

        async function saveEdit() {
            const value = editing?.text.trim();

            if (editing === null || value === "" || busy) {
                return;
            }

            setBusy(true);
            setError(null);

            try {
                await pocket.api(`drafts/${session}/${encodeURIComponent(editing.id)}`, { text: value }, {
                    method: "PUT",
                });

                setDrafts(
                    drafts.map((each) =>
                        each.id === editing.id ? { ...each, text: value, savedAt: Date.now() } : each,
                    ),
                );
                setEditing(null);
            } catch (failure) {
                setError(errorText(failure));
            } finally {
                setBusy(false);
            }
        }

        // The first press arms the button; only the armed second one deletes.
        async function remove(draft) {
            if (busy || armed !== draft.id) {
                return;
            }

            setBusy(true);
            setError(null);

            try {
                await pocket.api(`drafts/${session}/${encodeURIComponent(draft.id)}`, undefined, {
                    method: "DELETE",
                });

                setArmed(null);
                if (editing?.id === draft.id) {
                    setEditing(null);
                }

                setDrafts(drafts.filter((each) => each.id !== draft.id));
            } catch (failure) {
                setError(errorText(failure));
            } finally {
                setBusy(false);
            }
        }

        if (session === null) {
            return html`<p class="muted">Open a session first: drafts are saved per session.</p>`;
        }

        if (drafts === null) {
            return html`<${pocket.Loader} label="Reading drafts" />`;
        }

        return html`<div class="x-drafts">
            <label class="x-drafts-label">
                <span class="muted small">Draft</span>
                <textarea
                    ref=${box}
                    class="x-drafts-text"
                    rows=${4}
                    value=${text}
                    placeholder="What you want to say, for later…"
                    disabled=${busy}
                    onInput=${(event) => setText(event.currentTarget.value)}
                    onKeyDown=${(event) => {
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                            event.preventDefault();
                            void save();
                        }
                    }}
                ></textarea>
            </label>
            <div class="x-drafts-actions">
                <button
                    type="button"
                    class="button primary"
                    disabled=${text.trim() === "" || busy}
                    onClick=${() => void save()}
                >
                    Save draft
                </button>
                <span class="muted small">Ctrl+Enter saves.</span>
            </div>
            ${error !== null ? html`<div class="error-box">${error}</div>` : null}
            <div class="x-drafts-list">
                <p class="muted small x-drafts-count">
                    ${drafts.length === 0
                        ? "No drafts yet. Using one puts it in the message box and takes it out of the list."
                        : `${drafts.length} saved. Using one puts it in the message box and takes it out of the list.`}
                </p>
                ${drafts.map((draft) => {
                    if (editing?.id === draft.id) {
                        return html`<div class="x-drafts-row x-drafts-editing" key=${draft.id}>
                            <textarea
                                ref=${editBox}
                                class="x-drafts-text"
                                rows=${4}
                                value=${editing.text}
                                disabled=${busy}
                                onInput=${(event) => setEditing({ id: draft.id, text: event.currentTarget.value })}
                                onKeyDown=${(event) => {
                                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                                        event.preventDefault();
                                        void saveEdit();
                                    }
                                }}
                            ></textarea>
                            <div class="x-drafts-actions">
                                <button
                                    type="button"
                                    class="button primary x-drafts-act"
                                    disabled=${editing.text.trim() === "" || busy}
                                    onClick=${() => void saveEdit()}
                                >
                                    Save
                                </button>
                                <button
                                    type="button"
                                    class="button x-drafts-act"
                                    disabled=${busy}
                                    onClick=${cancelEdit}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>`;
                    }

                    return html`<div class="x-drafts-row" key=${draft.id}>
                        <span class="x-drafts-row-text" title=${draft.text}>${preview(draft.text)}</span>
                        <span class="x-drafts-acts">
                            <button
                                type="button"
                                class="button x-drafts-act"
                                title="Put this draft in the message box and remove it"
                                disabled=${busy}
                                onClick=${() => void use(draft)}
                            >
                                <${pocket.Icon} name="send" size=${14} />
                                Use
                            </button>
                            <button
                                type="button"
                                class="button x-drafts-act"
                                title="Edit this draft"
                                disabled=${busy}
                                onClick=${() => startEdit(draft)}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                class=${`button x-drafts-act${armed === draft.id ? " x-drafts-danger" : ""}`}
                                title=${armed === draft.id ? "Press again to delete this draft" : "Delete this draft"}
                                disabled=${busy}
                                onClick=${() => (armed === draft.id ? void remove(draft) : setArmed(draft.id))}
                                onBlur=${() => armed === draft.id && setArmed(null)}
                            >
                                ${armed === draft.id ? "Delete it" : "Delete"}
                            </button>
                        </span>
                    </div>`;
                })}
            </div>
        </div>`;
    }

    /* ── What the module adds to the app ─────────────────────────────────────────────────────── */

    pocket.sheet({ id: "drafts", title: "Drafts", component: Drafts });

    // A row in the session's menu, as the persona picker has one. Its hint says how many drafts the tab's session
    // has, kept current by conversation changes and the module's own events.
    const menuRow =
        typeof pocket.menu === "function"
            ? pocket.menu({ id: "drafts", label: "Drafts", hint: "", group: "session", sheet: "drafts" })
            : null;

    let countSession = typeof pocket.conversationId === "function" ? pocket.conversationId() : null;
    let countSeq = 0;

    async function refreshCount(session) {
        if (menuRow === null || session === null) {
            return;
        }

        const mine = ++countSeq;

        try {
            const data = await pocket.api(`list/${session}`);

            if (mine === countSeq) {
                menuRow.update({ hint: `${data.drafts.length} saved` });
            }
        } catch {
            // The row's hint stays as it was; the sheet says what went wrong when it opens.
        }
    }

    const stops = [];

    if (typeof pocket.onConversation === "function") {
        stops.push(
            pocket.onConversation((id) => {
                countSession = id;
                void refreshCount(id);
            }),
        );
    }

    // The tab's own save, edit, use, and delete change the count too; other tabs of the session come as events.
    stops.push(
        pocket.on("drafts", (data) => {
            if (data !== null && typeof data === "object" && data.session === countSession) {
                void refreshCount(countSession);
            }
        }),
    );

    void refreshCount(countSession);

    /* ── Chips under the titles of sessions that have drafts ─────────────────────────────── */

    // The list's chips answer at once, so the counts live in a map the events keep current.
    const counts = new Map();
    let chipItem = null;

    // A chip tap opens its session, then the sheet: sheets close when the conversation changes, so the sheet waits
    // for the tab to show that session. An intent that does not land in a few seconds gives up.
    let openIntent = null;

    function cancelOpenIntent() {
        if (openIntent === null) {
            return;
        }

        clearTimeout(openIntent.timer);
        openIntent.stop();
        openIntent = null;
    }

    function openDraftsFor(session) {
        const target = session.id;

        if (pocket.conversationId() === target) {
            pocket.openSheet("drafts");
            return;
        }

        if (typeof pocket.openConversation !== "function" || typeof pocket.onConversation !== "function") {
            return;
        }

        cancelOpenIntent();

        const stop = pocket.onConversation((id) => {
            if (id === target) {
                cancelOpenIntent();
                pocket.openSheet("drafts");
            }
        });

        openIntent = { stop, timer: setTimeout(cancelOpenIntent, 5000) };

        pocket.openConversation(target);
    }

    function chipFor(session) {
        const n = counts.get(session.id);

        if (!n) {
            return [];
        }

        return [
            {
                label: `✎ ${String(n)}`,
                title: `${String(n)} saved draft${n === 1 ? "" : "s"} — tap to open`,
                run: () => openDraftsFor(session),
            },
        ];
    }

    async function refreshCounts() {
        try {
            const data = await pocket.api("counts");

            counts.clear();

            for (const [id, n] of Object.entries(data.counts ?? {})) {
                counts.set(Number(id), n);
            }

            // A new function each time: the list's unchanged rows skip a draw for one they have seen.
            if (chipItem !== null) {
                chipItem.update({ chips: (session) => chipFor(session) });
            }
        } catch {
            // The chips keep what they show; the sheet says what went wrong when it opens.
        }
    }

    if (typeof pocket.sessionChips === "function") {
        chipItem = pocket.sessionChips({ id: "drafts", chips: chipFor });
        void refreshCounts();
        stops.push(pocket.on("drafts", () => void refreshCounts()));
    }

    if (typeof pocket.composerButton === "function") {
        pocket.composerButton({ id: "drafts", title: "Drafts", iconPath: PEN, sheet: "drafts" });
    }

    if (typeof pocket.style === "function") {
        pocket.style("style.css");
    }

    return () => {
        cancelOpenIntent();

        for (const stop of stops) {
            stop();
        }
    };
}
