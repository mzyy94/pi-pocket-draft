/**
 * The drafts browser module: a button in the message box's row and a row in the session's menu, both opening a sheet
 * of the session's saved drafts. A person types text and saves it; the draft lands below, newest first. Copying one
 * puts its text on the clipboard and takes it out of the list. The drafts live in `drafts.ts`' per-session document,
 * so they follow the session across tabs and devices.
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
        const box = useRef(null);

        // The sheet opens with the field ready to type into.
        useEffect(() => {
            requestAnimationFrame(() => box.current?.focus());
        }, []);

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
            // Another tab saved or copied a draft of this session: show the same list here.
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

        async function copy(draft) {
            if (busy) {
                return;
            }

            setBusy(true);
            setError(null);

            try {
                // A secure context, so the clipboard answers; the draft leaves the list only once it is copied.
                await navigator.clipboard.writeText(draft.text);
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
                        ? "No drafts yet. Copying one puts it on the clipboard and takes it out of the list."
                        : `${drafts.length} saved. Copying one puts it on the clipboard and takes it out of the list.`}
                </p>
                ${drafts.map(
                    (draft) =>
                        html`<div class="x-drafts-row" key=${draft.id}>
                            <span class="x-drafts-row-text" title=${draft.text}>${preview(draft.text)}</span>
                            <button
                                type="button"
                                class="button x-drafts-copy"
                                title="Copy to the clipboard and remove this draft"
                                disabled=${busy}
                                onClick=${() => void copy(draft)}
                            >
                                <${pocket.Icon} name="copy" size=${14} />
                                Copy
                            </button>
                        </div>`,
                )}
            </div>
        </div>`;
    }

    /* ── What the module adds to the app ─────────────────────────────────────────────────────── */

    pocket.sheet({ id: "drafts", title: "Drafts", component: Drafts });

    // A row in the session's menu, as the persona picker has one.
    pocket.menu({
        id: "drafts",
        label: "Drafts",
        hint: "saved text",
        group: "session",
        sheet: "drafts",
    });

    if (typeof pocket.composerButton === "function") {
        pocket.composerButton({ id: "drafts", title: "Drafts", iconPath: PEN, sheet: "drafts" });
    }

    if (typeof pocket.style === "function") {
        pocket.style("style.css");
    }
}
