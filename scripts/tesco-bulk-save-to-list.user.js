// ==UserScript==
// @name         Tesco Bulk Save to List
// @namespace    phaderon.tesco.bulk.save.to.list
// @version      1.0
// @description  Adds a button that saves every item on My Favourites / Last Order to your default Tesco list, one after another, automatically dismissing the confirmation popup each time.
// @match        https://www.tesco.com/shop/en-GB/favourites*
// @match        https://www.tesco.com/groceries/en-GB/favourites*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const CLICK_TO_MODAL_TIMEOUT_MS = 4000;
    const CLOSE_TIMEOUT_MS = 3000;
    const AFTER_CLOSE_DELAY_MS = 700;
    const MAX_ITEMS = 200;

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitFor(conditionFn, timeoutMs, intervalMs = 100) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const result = conditionFn();
            if (result) return result;
            await sleep(intervalMs);
        }
        return null;
    }

    function getUnsavedButtons() {
        return Array.from(
            document.querySelectorAll('.save-to-list-container button[aria-label^="Save to list "]')
        );
    }

    function getOpenModal() {
        const dialog = document.getElementById('global-scripts-modal');
        return dialog && dialog.hasAttribute('open') ? dialog : null;
    }

    async function closeModalIfOpen() {
        const dialog = getOpenModal();
        if (!dialog) return;
        const closeBtn = dialog.querySelector('button[aria-label="Close Modal"]');
        if (closeBtn) {
            closeBtn.click();
            await waitFor(() => !getOpenModal(), CLOSE_TIMEOUT_MS);
        }
    }

    async function saveAll(onProgress) {
        let saved = 0;
        const total = getUnsavedButtons().length;

        for (let i = 0; i < MAX_ITEMS; i++) {
            const buttons = getUnsavedButtons();
            if (buttons.length === 0) break;

            const btn = buttons[0];
            const label = btn.getAttribute('aria-label') || '';
            btn.click();

            await waitFor(() => getOpenModal(), CLICK_TO_MODAL_TIMEOUT_MS);
            await sleep(300);
            await closeModalIfOpen();
            await waitFor(() => (btn.getAttribute('aria-label') || '').startsWith('Saved'), 2000);

            saved++;
            if (onProgress) onProgress(saved, total, label);
            await sleep(AFTER_CLOSE_DELAY_MS);
        }

        return saved;
    }

    function addButton() {
        if (document.getElementById('bulk-save-to-list-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'bulk-save-to-list-btn';
        btn.textContent = 'Save All To List';
        btn.style.position = 'fixed';
        btn.style.bottom = '70px';
        btn.style.right = '20px';
        btn.style.zIndex = '99999';
        btn.style.padding = '12px 18px';
        btn.style.background = '#00539f';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = 'bold';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';

        btn.addEventListener('click', async () => {
            if (btn.dataset.running === '1') return;
            btn.dataset.running = '1';
            const originalText = btn.textContent;

            const total = getUnsavedButtons().length;
            if (total === 0) {
                btn.textContent = 'Nothing to save';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.dataset.running = '0';
                }, 2000);
                return;
            }

            btn.textContent = `Saving 0/${total}...`;

            const saved = await saveAll((count, totalCount) => {
                btn.textContent = `Saving ${count}/${totalCount}...`;
            });

            btn.textContent = `Saved ${saved} items`;
            setTimeout(() => {
                btn.textContent = originalText;
                btn.dataset.running = '0';
            }, 2500);
        });

        document.body.appendChild(btn);
    }

    addButton();
    // Content re-renders async, so keep checking in case the button gets removed
    setInterval(addButton, 2000);
})();
