export function createTextCleanerInput({ readText, onCommit, delay = 350 }) {
    let timer = null;
    let pending = false;
    let composing = false;

    function clearTimer() {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    }

    function flush() {
        clearTimer();
        const text = readText();
        if (pending) {
            pending = false;
            onCommit(text);
        }
        return text;
    }

    function schedule() {
        clearTimer();
        pending = true;
        if (!composing) timer = setTimeout(flush, delay);
    }

    return {
        get pending() { return pending; },
        schedule,
        flush,
        compositionStart() {
            composing = true;
            clearTimer();
        },
        compositionEnd() {
            composing = false;
            if (pending) schedule();
        },
        cancel() {
            clearTimer();
            pending = false;
            composing = false;
        },
    };
}
