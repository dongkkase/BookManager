import React, { forwardRef, useLayoutEffect, useRef } from 'react';
import { createTextCleanerEditor } from '../textCleanerEditor';

const TextCleanerEditor = forwardRef(function TextCleanerEditor(props, forwardedRef) {
    const containerRef = useRef(null);
    const editorRef = useRef(null);
    const optionsRef = useRef(props);
    optionsRef.current = props;

    useLayoutEffect(() => {
        const editor = createTextCleanerEditor(containerRef.current, () => optionsRef.current);
        editorRef.current = editor;
        forwardedRef.current = editor.element;
        return () => {
            forwardedRef.current = null;
            editorRef.current = null;
            editor.destroy();
        };
    }, [forwardedRef]);

    useLayoutEffect(() => {
        editorRef.current?.configure();
    }, [props.readOnly, props.label]);

    return <div ref={containerRef} className="text-cleaner-virtual-editor" />;
});

export default TextCleanerEditor;
