// ==UserScript==
// @name         Tesco Toolkit (All-in-One)
// @namespace    phaderon.tesco.toolkit
// @version      1.1
// @description  Combined Tesco helper: copy basket list to clipboard on the trolley page, bulk-save every item to a list on My Favourites / Last Order.
// @match        https://www.tesco.com/shop/en-GB/trolley*
// @match        https://www.tesco.com/groceries/en-GB/trolley*
// @match        https://www.tesco.com/shop/en-GB/favourites*
// @match        https://www.tesco.com/groceries/en-GB/favourites*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

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

    function makeFloatingButton(id, text, bottomPx) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.textContent = text;
        btn.style.position = 'fixed';
        btn.style.bottom = bottomPx + 'px';
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
        return btn;
    }

    // ---------- Basket Copy List (trolley page) ----------

    function buildBasketText() {
        const items = document.querySelectorAll('li[data-testid="product-list-item"]');
        const lines = [];
        let grandTotal = 0;

        items.forEach((item) => {
            const nameEl = item.querySelector('._1bCRSG_titleContainer a');
            const priceEl = item.querySelector('._1bCRSG_priceText');
            const qtyInput = item.querySelector('input[data-auto="ddsweb-quantity-controls-input"]');

            if (!nameEl || !priceEl || !qtyInput) return;

            const name = nameEl.textContent.trim();
            const unitPrice = parseFloat(priceEl.textContent.replace(/[^\d.]/g, ''));
            const qty = parseInt(qtyInput.value, 10) || 1;
            const lineTotal = unitPrice * qty;
            grandTotal += lineTotal;

            lines.push(`${name} - £${unitPrice.toFixed(2)} x ${qty} = £${lineTotal.toFixed(2)}`);
        });

        lines.push('');
        lines.push(`Total: £${grandTotal.toFixed(2)}`);

        return lines.join('\n');
    }

    function copyBasket(btn) {
        const text = buildBasketText();
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
        } else {
            navigator.clipboard.writeText(text);
        }

        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 1500);
    }

    function initBasketCopy() {
        const existing = document.getElementById('basket-copy-btn');
        const onTrolleyPage = /\/(shop|groceries)\/en-GB\/trolley/.test(location.pathname);
        const hasBasketItems = !!document.querySelector('li[data-testid="product-list-item"]');

        if (!onTrolleyPage || !hasBasketItems) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const btn = makeFloatingButton('basket-copy-btn', 'Copy Basket List', 20);
        btn.addEventListener('click', () => copyBasket(btn));
        document.body.appendChild(btn);
    }

    // ---------- Bulk Save to List (favourites / last order page) ----------

    const CLICK_TO_MODAL_TIMEOUT_MS = 4000;
    const CLOSE_TIMEOUT_MS = 3000;
    const AFTER_CLOSE_DELAY_MS = 700;
    const MAX_ITEMS = 200;

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
            btn.click();

            await waitFor(() => getOpenModal(), CLICK_TO_MODAL_TIMEOUT_MS);
            await sleep(300);
            await closeModalIfOpen();
            await waitFor(() => (btn.getAttribute('aria-label') || '').startsWith('Saved'), 2000);

            saved++;
            if (onProgress) onProgress(saved, total);
            await sleep(AFTER_CLOSE_DELAY_MS);
        }

        return saved;
    }

    function initBulkSave() {
        const existing = document.getElementById('bulk-save-to-list-btn');
        const onFavouritesPage = /\/(shop|groceries)\/en-GB\/favourites/.test(location.pathname);
        const hasSaveContainer = !!document.querySelector('.save-to-list-container');

        if (!onFavouritesPage || !hasSaveContainer) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const btn = makeFloatingButton('bulk-save-to-list-btn', 'Save All To List', 70);

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

    // ---------- Boot ----------

    function initAll() {
        initBasketCopy();
        initBulkSave();
    }

    initAll();
    // Tesco's pages re-render content asynchronously, so keep checking
    // in case our buttons get removed or the relevant content loads late.
    setInterval(initAll, 2000);
})();
