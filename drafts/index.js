/**
 * The drafts browser module: a button in the message box's row that opens a sheet of saved drafts. A person types text
 * and saves it; the draft lands below, newest first, in this tab's localStorage under `x.drafts.list`. Copying one puts
 * its text on the clipboard and takes it out of the list. Nothing leaves the tab: the server stores no draft.
 */

/** The version of `pocket` this module was written for. */
export const pocketApi = 1;

/** A pencil, for a message not sent yet. */
const PEN = "M17 3a2.83 2.83 0 014 4L7.5 20.5 2 22l1.5-5.5L17 3Z";

/** The tab's drafts, newest first. One key, as the app names browser data. */
const STORE_KEY = "x.drafts.list";

/** A first line for a row, short enough to keep it on one line. */
function preview(text) {
    const line = text.trim().split("\n", 1)[0] ?? "";

    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}

/** The drafts in this tab's localStorage, or none: a bad value must not stop the sheet. */
function readDrafts() {
    try {
        const raw = window.localStorage.getItem(STORE_KEY);

        if (raw === null) {
            return [];
        }

        const value = JSON.parse(raw);

        if (!Array.isArray(value)) {
            return [];
        }

        return value.filter(
            (each) =>
                each !== null &&
                typeof each === "object" &&
                typeof each.id === "string" &&
                each.id !== "" &&
                typeof each.text === "string" &&
                typeof each.savedAt === "number",
        );
    } catch {
        return [];
    }
}

function writeDrafts(drafts) {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(drafts));
}

export default function setup(pocket) {
    const { html, useEffect, useRef, useState } = pocket;

    /* ── The sheet: save a draft, copy one back ─────────────────────────────────────────────── */

    function Drafts() {
        const [text, setText] = useState("");
        const [drafts, setDrafts] = useState(() => readDrafts());
        const [error, setError] = useState(null);
        const box = useRef(null);

        // The sheet opens with the field ready to type into.
        useEffect(() => {
            requestAnimationFrame(() => box.current?.focus());
        }, []);

        // Another tab of this person saved or copied a draft: show the same list here.
        useEffect(() => {
            const onStorage = (event) => {
                if (event.key === STORE_KEY) {
                    setDrafts(readDrafts());
                }
            };

            window.addEventListener("storage", onStorage);

            return () => window.removeEventListener("storage", onStorage);
        }, []);

        function refresh(next) {
            writeDrafts(next);
            setDrafts(next);
        }

        async function save() {
            const value = text.trim();

            if (value === "") {
                setError("Type something to save first.");
                return;
            }

            setError(null);
            refresh([{ id: crypto.randomUUID(), text: value, savedAt: Date.now() }, ...drafts]);
            setText("");
            requestAnimationFrame(() => box.current?.focus());
        }

        async function copy(draft) {
            try {
                // A secure context, so the clipboard answers; the draft leaves the list only once it is copied.
                await navigator.clipboard.writeText(draft.text);
                refresh(drafts.filter((each) => each.id !== draft.id));
            } catch (failure) {
                setError(`Could not copy: ${errorText(failure)}`);
            }
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
                    disabled=${text.trim() === ""}
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
