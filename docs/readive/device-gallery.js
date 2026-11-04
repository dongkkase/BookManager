const gallery = document.querySelector('.hero-preview');
const tabList = gallery.querySelector('.device-tabs');
const tabs = [...tabList.querySelectorAll('[role="tab"]')];
const panel = gallery.querySelector('[role="tabpanel"]');
const foldOptions = panel.querySelector('.fold-options');
const foldButtons = [...foldOptions.querySelectorAll('[data-fold-view]')];
const sources = panel.querySelectorAll('source[data-view]');

function showDeviceView(view) {
    if (gallery.dataset.deviceView === view) return;
    gallery.dataset.deviceView = view;
    for (const source of sources) {
        source.media = source.dataset.view === view ? 'all' : 'not all';
    }
    gallery.dispatchEvent(new Event('deviceviewchange'));
}

function selectDevice(tab) {
    for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', tab.id);
    const isFold = tab.dataset.device === 'fold';
    foldOptions.hidden = !isFold;
    const selectedFold = foldOptions.querySelector('[aria-pressed="true"]');
    showDeviceView(isFold ? selectedFold.dataset.foldView : tab.dataset.device);
}

tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectDevice(tab));
    tab.addEventListener('keydown', event => {
        const destinations = {
            ArrowRight: (index + 1) % tabs.length,
            ArrowLeft: (index + tabs.length - 1) % tabs.length,
            Home: 0,
            End: tabs.length - 1,
        };
        if (!Object.hasOwn(destinations, event.key)) return;
        event.preventDefault();
        const next = tabs[destinations[event.key]];
        next.focus();
        selectDevice(next);
    });
});

for (const button of foldButtons) {
    button.addEventListener('click', () => {
        for (const item of foldButtons) {
            item.setAttribute('aria-pressed', String(item === button));
        }
        showDeviceView(button.dataset.foldView);
    });
}

tabList.hidden = false;
