const SCROLL_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'beforeinput'];

export function createTextCleanerScroll(editor, onScroll) {
    let programmatic = false;
    const handleInput = () => { programmatic = false; };
    const handleScroll = () => {
        if (!programmatic) onScroll();
    };
    editor.addEventListener('scroll', handleScroll);
    for (const type of SCROLL_INPUT_EVENTS) {
        editor.addEventListener(type, handleInput, { capture: true, passive: true });
    }
    return {
        move(callback) {
            // Virtualized layout can emit more scroll events several frames after a jump.
            programmatic = true;
            callback();
        },
        destroy() {
            editor.removeEventListener('scroll', handleScroll);
            for (const type of SCROLL_INPUT_EVENTS) {
                editor.removeEventListener(type, handleInput, true);
            }
        },
    };
}
