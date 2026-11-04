(() => {
    if (!window.Motion?.animate || !Element.prototype.animate) return;

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const active = new Map();
    const ease = [0.2, 0.75, 0.25, 1];

    function enter(element, keyframes, options) {
        if (preference.matches || element.matches(':focus-within')) return;
        active.get(element)?.complete();
        const animation = Motion.animate(element, keyframes, { ease, ...options });
        active.set(element, animation);
        animation.finished.then(() => {
            if (active.get(element) === animation) active.delete(element);
        });
    }

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(entries => {
            const siblings = new Map();
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const element = entry.target;
                observer.unobserve(element);
                const group = element.parentElement;
                const index = siblings.get(group) || 0;
                siblings.set(group, index + 1);
                enter(element, { opacity: [0.25, 1], transform: ['translateY(16px)', 'none'] }, {
                    duration: 0.45, delay: Math.min(index, 2) * 0.055
                });
            }
        }, { rootMargin: '0px 0px 12px 0px' });
        document.querySelectorAll('main h2, .feature-grid > .feature, .split > .list-panel').forEach(element => {
            observer.observe(element);
        });
    }

    const gallery = document.querySelector('.hero-preview');
    gallery?.addEventListener('deviceviewchange', () => {
        enter(gallery.querySelector('.hero-frames'), { opacity: [0.65, 1], transform: ['scale(0.985)', 'none'] }, {
            duration: 0.22
        });
    });

    preference.addEventListener('change', () => {
        if (preference.matches) {
            for (const animation of active.values()) animation.complete();
        }
    });
    document.addEventListener('focusin', event => {
        for (const [element, animation] of active) {
            if (element.contains(event.target)) animation.complete();
        }
    });
})();
