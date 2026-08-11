// ==UserScript==
// @name         Tesco Toolkit (All-in-One)
// @namespace    phaderon.tesco.toolkit
// @version      2.0
// @description  Combined Tesco helper: copy basket list to clipboard on the trolley page, bulk-save every item to a list on My Favourites / Last Order, and add every product on ANY page (order receipts, product pages, anywhere) to a shopping list via Tesco's own API.
// @match        https://www.tesco.com/shop/en-GB/*
// @match        https://www.tesco.com/groceries/en-GB/*
// @run-at       document-start
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

    // ---------- Auth capture (needed for the API-based add-to-list feature) ----------
    // Tesco keeps its access token in memory only (not in any storage we can read),
    // refreshed via a flow we can't replicate. Instead we quietly watch the page's
    // own outgoing requests to xapi.tesco.com and copy the headers it sends itself.

    const auth = {
        bearer: null,
        customerUuid: null,
        apiKey: 'TvOSZJHlEk0pjniDGQFAc9Q59WGAR4dA', // static app key, same for every user
    };

    function captureHeadersFrom(headerGetter) {
        try {
            const url = headerGetter.url;
            if (!url || url.indexOf('xapi.tesco.com') === -1) return;
            const bearer = headerGetter.get('authorization');
            const cust = headerGetter.get('customer-uuid');
            const key = headerGetter.get('x-apikey');
            if (bearer) auth.bearer = bearer;
            if (cust) auth.customerUuid = cust;
            if (key) auth.apiKey = key;
        } catch (e) { /* ignore */ }
    }

    (function installInterceptors() {
        const originalFetch = window.fetch;
        if (originalFetch && !originalFetch.__tescoToolkitPatched) {
            const patchedFetch = function (input, init) {
                try {
                    const url = typeof input === 'string' ? input : (input && input.url) || '';
                    const headersSource = (init && init.headers) || (input && input.headers);
                    if (url.indexOf('xapi.tesco.com') !== -1 && headersSource) {
                        const h = headersSource instanceof Headers ? headersSource : new Headers(headersSource);
                        captureHeadersFrom({ url: url, get: (name) => h.get(name) });
                    }
                } catch (e) { /* ignore */ }
                return originalFetch.apply(this, arguments);
            };
            patchedFetch.__tescoToolkitPatched = true;
            window.fetch = patchedFetch;
        }

        const OriginalXHR = window.XMLHttpRequest;
        if (OriginalXHR && !OriginalXHR.prototype.__tescoToolkitPatched) {
            const originalOpen = OriginalXHR.prototype.open;
            const originalSetHeader = OriginalXHR.prototype.setRequestHeader;

            OriginalXHR.prototype.open = function (method, url) {
                this.__tescoToolkitUrl = url;
                this.__tescoToolkitHeaders = {};
                return originalOpen.apply(this, arguments);
            };

            OriginalXHR.prototype.setRequestHeader = function (name, value) {
                if (this.__tescoToolkitHeaders) {
                    this.__tescoToolkitHeaders[name.toLowerCase()] = value;
                    if (this.__tescoToolkitUrl && this.__tescoToolkitUrl.indexOf('xapi.tesco.com') !== -1) {
                        captureHeadersFrom({
                            url: this.__tescoToolkitUrl,
                            get: (n) => this.__tescoToolkitHeaders[n.toLowerCase()],
                        });
                    }
                }
                return originalSetHeader.apply(this, arguments);
            };

            OriginalXHR.prototype.__tescoToolkitPatched = true;
        }
    })();

    function getCustomerUuid() {
        if (auth.customerUuid) return auth.customerUuid;
        try {
            const stored = localStorage.getItem('_ait');
            if (stored) return stored;
        } catch (e) { /* ignore */ }
        return null;
    }

    async function tescoApiCall(operations) {
        if (!auth.bearer) {
            throw new Error('NO_AUTH_YET');
        }
        const customerUuid = getCustomerUuid();
        const res = await fetch('https://xapi.tesco.com/', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'accept': 'application/json',
                'region': 'UK',
                'language': 'en-GB',
                'x-apikey': auth.apiKey,
                'authorization': auth.bearer,
                'customer-uuid': customerUuid || '',
            },
            body: JSON.stringify(operations),
        });
        const json = await res.json();
        return json;
    }

    function getShoppingLists() {
        return tescoApiCall([{
            operationName: 'GetCustomShoppingLists',
            variables: { listType: 'CUSTOM', isOwner: true, limit: 20, productsPerList: 5 },
            extensions: { mfeName: 'mfe-global-scripts' },
            query: 'query GetCustomShoppingLists($listType: ShoppingListTypeEnums, $isOwner: Boolean, $offset: Int, $limit: Int, $page: Int, $productsPerList: Int) {\n  getShoppingLists(\n    listType: $listType\n    isOwner: $isOwner\n    offset: $offset\n    limit: $limit\n    page: $page\n    productLimit: $productsPerList\n  ) {\n    shoppingLists {\n      id\n      name\n      totalProducts\n      tags\n      __typename\n    }\n    __typename\n  }\n}\n',
        }]);
    }

    function addProductsToList(tpnbs, listId) {
        const listItems = tpnbs.map((tpnb) => ({ tpnb: tpnb, quantity: 1 }));
        const variables = { listType: 'CUSTOM', listItems: listItems };
        if (listId) variables.listId = listId;
        return tescoApiCall([{
            operationName: 'UpdateShoppingListItem',
            variables: variables,
            extensions: { mfeName: 'mfe-global-scripts' },
            query: 'mutation UpdateShoppingListItem($listType: ShoppingListTypeEnums!, $listId: ID, $listItems: [ShoppingListItems]!, $limit: Int, $offset: Int) {\n  updateShoppingListItem(\n    listType: $listType\n    listId: $listId\n    listItems: $listItems\n    limit: $limit\n    offset: $offset\n  ) {\n    id\n    name\n    __typename\n  }\n}\n',
        }]);
    }

    // ---------- Extract products embedded in the page's own prefetched data ----------
    // Every Tesco page embeds a <script type="application/discover+json"> blob with
    // prefetched data for its micro-frontends. Buried in there (regardless of which
    // page or which mfe) are product records shaped like {tpnb, title, ...}. We just
    // deep-walk the whole thing and grab every one we find.

    function deepFindProducts(node, out, seen) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const item of node) deepFindProducts(item, out, seen);
            return;
        }
        if (typeof node.tpnb === 'string' && typeof node.title === 'string') {
            if (!seen.has(node.tpnb)) {
                seen.add(node.tpnb);
                out.push({ tpnb: node.tpnb, title: node.title });
            }
        }
        for (const key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                deepFindProducts(node[key], out, seen);
            }
        }
    }

    function extractPageProducts() {
        const out = [];
        const seen = new Set();
        const scripts = document.querySelectorAll('script[type="application/discover+json"]');
        scripts.forEach((script) => {
            try {
                const data = JSON.parse(script.textContent);
                deepFindProducts(data, out, seen);
            } catch (e) { /* ignore malformed blobs */ }
        });
        return out;
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

    // ---------- Bulk Save to List by clicking (favourites / last order page) ----------

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

    async function saveAllByClicking(onProgress) {
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

    function initBulkSaveByClicking() {
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

            const saved = await saveAllByClicking((count, totalCount) => {
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

    // ---------- Add page products to a list via the API (works everywhere: ----------
    // ---------- order receipts, product pages, order history, anywhere)   ----------

    async function pickListId() {
        let listsResponse;
        try {
            listsResponse = await getShoppingLists();
        } catch (e) {
            return { cancelled: false, listId: null, error: e };
        }
        const lists = (((listsResponse[0] || {}).data || {}).getShoppingLists || {}).shoppingLists || [];
        if (lists.length === 0) {
            return { cancelled: false, listId: null };
        }

        const menu = lists.map((l, i) => `${i + 1}. ${l.name} (${l.totalProducts} items)`).join('\n');
        const answer = window.prompt(
            `Which list should these be added to?\n${menu}\n\nEnter a number, or leave blank for your most recently used list, Cancel to abort.`
        );
        if (answer === null) return { cancelled: true, listId: null };
        const idx = parseInt(answer, 10) - 1;
        if (!isNaN(idx) && lists[idx]) return { cancelled: false, listId: lists[idx].id };
        return { cancelled: false, listId: null };
    }

    function initApiAddToList() {
        const existing = document.getElementById('api-add-to-list-btn');
        const products = extractPageProducts();

        if (products.length === 0) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const btn = makeFloatingButton('api-add-to-list-btn', `Add ${products.length} Item(s) To List (API)`, 120);

        btn.addEventListener('click', async () => {
            if (btn.dataset.running === '1') return;
            btn.dataset.running = '1';
            const originalText = btn.textContent;

            if (!auth.bearer) {
                btn.textContent = 'Waiting for Tesco API call... browse a bit';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.dataset.running = '0';
                }, 3000);
                return;
            }

            const currentProducts = extractPageProducts();
            btn.textContent = 'Choose a list...';

            const choice = await pickListId();
            if (choice.cancelled) {
                btn.textContent = originalText;
                btn.dataset.running = '0';
                return;
            }
            if (choice.error) {
                btn.textContent = 'Failed to load lists';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.dataset.running = '0';
                }, 3000);
                return;
            }

            btn.textContent = `Adding ${currentProducts.length}...`;

            try {
                await addProductsToList(currentProducts.map((p) => p.tpnb), choice.listId);
                btn.textContent = `Added ${currentProducts.length} items`;
            } catch (e) {
                btn.textContent = 'Failed, see console';
                console.error('Tesco Toolkit: add to list failed', e);
            }

            setTimeout(() => {
                btn.textContent = originalText;
                btn.dataset.running = '0';
            }, 3000);
        });

        document.body.appendChild(btn);
    }

    // ---------- Boot ----------

    function initAll() {
        if (!document.body) return;
        initBasketCopy();
        initBulkSaveByClicking();
        initApiAddToList();
    }

    initAll();
    // Tesco's pages re-render content asynchronously, so keep checking
    // in case our buttons get removed or the relevant content loads late.
    setInterval(initAll, 2000);
})();
