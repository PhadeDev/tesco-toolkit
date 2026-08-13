// ==UserScript==
// @name         Tesco Toolkit (All-in-One)
// @namespace    phaderon.tesco.toolkit
// @version      3.3
// @description  Combined Tesco helper: copy/backup basket contents, save a basket to a list with quantities, bulk-save every item to a list on My Favourites / Last Order, and add every product on ANY page to a shopping list via Tesco's own API.
// @match        https://www.tesco.com/shop/en-GB/*
// @match        https://www.tesco.com/groceries/en-GB/*
// @downloadURL  https://raw.githubusercontent.com/PhadeDev/tesco-toolkit/master/scripts/tesco-toolkit.user.js
// @updateURL    https://raw.githubusercontent.com/PhadeDev/tesco-toolkit/master/scripts/tesco-toolkit.user.js
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
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

    // ---------- Auth (needed for the API-based add-to-list feature) ----------
    // Tesco keeps the bearer token in its app runtime rather than normal
    // browser storage. Watch Tesco's own xapi requests from page context, then
    // store the short-lived bearer token locally for toolkit API calls.

    const STATIC_API_KEY = 'TvOSZJHlEk0pjniDGQFAc9Q59WGAR4dA'; // shared app key, same for every visitor, not a secret
    const AUTH_CAPTURE_EVENT = 'phaderon-tesco-auth-capture';

    function decodeJwtExpiryMs(bearerValue) {
        try {
            const raw = bearerValue.replace(/^Bearer\s+/i, '').trim();
            const payload = raw.split('.')[1];
            const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
            const json = JSON.parse(atob(base64));
            return typeof json.exp === 'number' ? json.exp * 1000 : null;
        } catch (e) {
            return null;
        }
    }

    function getStoredToken() {
        const bearer = GM_getValue('tescoBearer', null);
        const expiresAt = GM_getValue('tescoBearerExpiresAt', 0);
        if (!bearer) return null;
        if (Date.now() >= expiresAt) return null;
        return bearer;
    }

    function getStoredTokenStatus() {
        const bearer = GM_getValue('tescoBearer', null);
        const expiresAt = GM_getValue('tescoBearerExpiresAt', 0);
        if (!bearer || !expiresAt) {
            return { state: 'missing', label: 'Auth: waiting' };
        }
        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
            return { state: 'expired', label: 'Auth: expired' };
        }
        const mins = Math.max(1, Math.floor(remainingMs / 60000));
        return { state: 'ready', label: `Auth: ${mins}m` };
    }

    function storeBearerToken(bearerValue, source) {
        const expMs = decodeJwtExpiryMs(bearerValue);
        if (!expMs) return false;
        GM_setValue('tescoBearer', bearerValue);
        GM_setValue('tescoBearerExpiresAt', expMs);
        GM_setValue('tescoBearerCapturedAt', Date.now());
        GM_setValue('tescoBearerSource', source || 'tesco xapi request');
        updateAuthStatusLight();
        return true;
    }

    function getCustomerUuid() {
        try {
            const stored = localStorage.getItem('_ait');
            if (stored) return stored;
        } catch (e) { /* ignore */ }
        return GM_getValue('tescoCustomerUuid', null);
    }

    function captureHeaderValue(headers, name) {
        if (!headers) return null;
        const wanted = name.toLowerCase();
        try {
            if (typeof headers.get === 'function') return headers.get(name) || headers.get(wanted);
            if (Array.isArray(headers)) {
                const found = headers.find((pair) => Array.isArray(pair) && String(pair[0]).toLowerCase() === wanted);
                return found ? found[1] : null;
            }
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === wanted) return headers[key];
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function captureFromRequest(url, headers, source) {
        if (!url || !String(url).includes('xapi.tesco.com')) return;
        const bearer = captureHeaderValue(headers, 'authorization');
        if (bearer && /^Bearer\s+/i.test(String(bearer))) {
            storeBearerToken(String(bearer), source);
        }
        const customerUuid = captureHeaderValue(headers, 'customer-uuid');
        if (customerUuid) GM_setValue('tescoCustomerUuid', String(customerUuid));
    }

    function installAuthCapture() {
        if (window.__phaderonTescoToolkitAuthCapture) return;
        window.__phaderonTescoToolkitAuthCapture = true;

        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const data = event.data;
            if (!data || data.type !== AUTH_CAPTURE_EVENT) return;
            if (data.bearer) storeBearerToken(data.bearer, data.source);
            if (data.customerUuid) GM_setValue('tescoCustomerUuid', data.customerUuid);
        });

        const targetWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
        try {
            const originalFetch = targetWindow.fetch;
            if (typeof originalFetch === 'function' && !originalFetch.__phaderonTescoWrapped) {
                const wrappedFetch = function patchedTescoFetch(input, init) {
                    try {
                        const url = typeof input === 'string' ? input : input && input.url;
                        captureFromRequest(url, init && init.headers, 'fetch init headers');
                        if (input && input.headers) captureFromRequest(url, input.headers, 'fetch request headers');
                    } catch (e) { /* ignore */ }
                    return originalFetch.apply(this, arguments);
                };
                wrappedFetch.__phaderonTescoWrapped = true;
                targetWindow.fetch = wrappedFetch;
            }
        } catch (e) { /* ignore */ }

        try {
            const XHR = targetWindow.XMLHttpRequest;
            if (XHR && XHR.prototype && !XHR.prototype.__phaderonTescoWrapped) {
                const originalOpen = XHR.prototype.open;
                const originalSetRequestHeader = XHR.prototype.setRequestHeader;
                const originalSend = XHR.prototype.send;
                XHR.prototype.open = function patchedTescoOpen(method, url) {
                    this.__phaderonTescoUrl = url;
                    this.__phaderonTescoHeaders = {};
                    return originalOpen.apply(this, arguments);
                };
                XHR.prototype.setRequestHeader = function patchedTescoSetRequestHeader(name, value) {
                    try {
                        this.__phaderonTescoHeaders = this.__phaderonTescoHeaders || {};
                        this.__phaderonTescoHeaders[name] = value;
                    } catch (e) { /* ignore */ }
                    return originalSetRequestHeader.apply(this, arguments);
                };
                XHR.prototype.send = function patchedTescoSend() {
                    try {
                        captureFromRequest(this.__phaderonTescoUrl, this.__phaderonTescoHeaders, 'xhr request headers');
                    } catch (e) { /* ignore */ }
                    return originalSend.apply(this, arguments);
                };
                XHR.prototype.__phaderonTescoWrapped = true;
            }
        } catch (e) { /* ignore */ }

        try {
            const pageScript = document.createElement('script');
            pageScript.textContent = `(() => {
                const EVENT = ${JSON.stringify(AUTH_CAPTURE_EVENT)};
                if (window.__phaderonTescoToolkitPageCapture) return;
                window.__phaderonTescoToolkitPageCapture = true;

                function headerValue(headers, name) {
                    if (!headers) return null;
                    const wanted = name.toLowerCase();
                    try {
                        if (typeof headers.get === 'function') return headers.get(name) || headers.get(wanted);
                        if (Array.isArray(headers)) {
                            const found = headers.find((pair) => Array.isArray(pair) && String(pair[0]).toLowerCase() === wanted);
                            return found ? found[1] : null;
                        }
                        for (const key of Object.keys(headers)) {
                            if (key.toLowerCase() === wanted) return headers[key];
                        }
                    } catch (e) {}
                    return null;
                }

                function emitAuth(url, headers, source) {
                    if (!url || !String(url).includes('xapi.tesco.com')) return;
                    const bearer = headerValue(headers, 'authorization');
                    if (!bearer || !/^Bearer\\s+/i.test(String(bearer))) return;
                    window.postMessage({
                        type: EVENT,
                        bearer: String(bearer),
                        customerUuid: headerValue(headers, 'customer-uuid'),
                        source,
                    }, '*');
                }

                const originalFetch = window.fetch;
                if (typeof originalFetch === 'function' && !originalFetch.__phaderonTescoWrappedPage) {
                    const wrappedFetch = function patchedTescoPageFetch(input, init) {
                        try {
                            const url = typeof input === 'string' ? input : input && input.url;
                            emitAuth(url, init && init.headers, 'page fetch init headers');
                            if (input && input.headers) emitAuth(url, input.headers, 'page fetch request headers');
                        } catch (e) {}
                        return originalFetch.apply(this, arguments);
                    };
                    wrappedFetch.__phaderonTescoWrappedPage = true;
                    window.fetch = wrappedFetch;
                }

                const XHR = window.XMLHttpRequest;
                if (XHR && XHR.prototype && !XHR.prototype.__phaderonTescoWrappedPage) {
                    const originalOpen = XHR.prototype.open;
                    const originalSetRequestHeader = XHR.prototype.setRequestHeader;
                    const originalSend = XHR.prototype.send;
                    XHR.prototype.open = function patchedTescoPageOpen(method, url) {
                        this.__phaderonTescoUrl = url;
                        this.__phaderonTescoHeaders = {};
                        return originalOpen.apply(this, arguments);
                    };
                    XHR.prototype.setRequestHeader = function patchedTescoPageSetHeader(name, value) {
                        try {
                            this.__phaderonTescoHeaders = this.__phaderonTescoHeaders || {};
                            this.__phaderonTescoHeaders[name] = value;
                        } catch (e) {}
                        return originalSetRequestHeader.apply(this, arguments);
                    };
                    XHR.prototype.send = function patchedTescoPageSend() {
                        try {
                            emitAuth(this.__phaderonTescoUrl, this.__phaderonTescoHeaders, 'page xhr request headers');
                        } catch (e) {}
                        return originalSend.apply(this, arguments);
                    };
                    XHR.prototype.__phaderonTescoWrappedPage = true;
                }
            })();`;
            const parent = document.documentElement || document.head || document.body;
            if (parent) {
                parent.appendChild(pageScript);
                pageScript.remove();
            }
        } catch (e) { /* ignore */ }
    }

    function updateAuthStatusLight() {
        if (!document.body) return;

        let box = document.getElementById('tesco-auth-status');
        if (!box) {
            box = document.createElement('div');
            box.id = 'tesco-auth-status';
            box.style.position = 'fixed';
            box.style.right = '20px';
            box.style.bottom = '170px';
            box.style.zIndex = '99999';
            box.style.display = 'flex';
            box.style.alignItems = 'center';
            box.style.gap = '8px';
            box.style.padding = '8px 10px';
            box.style.background = '#ffffff';
            box.style.color = '#1f2933';
            box.style.border = '1px solid #d5dce5';
            box.style.borderRadius = '6px';
            box.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
            box.style.fontSize = '12px';
            box.style.fontWeight = '700';

            const dot = document.createElement('span');
            dot.id = 'tesco-auth-status-dot';
            dot.style.width = '11px';
            dot.style.height = '11px';
            dot.style.borderRadius = '50%';
            dot.style.display = 'inline-block';
            dot.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.08)';

            const label = document.createElement('span');
            label.id = 'tesco-auth-status-label';

            box.appendChild(dot);
            box.appendChild(label);
            document.body.appendChild(box);
        }

        const status = getStoredTokenStatus();
        const dot = document.getElementById('tesco-auth-status-dot');
        const label = document.getElementById('tesco-auth-status-label');
        if (!dot || !label) return;

        label.textContent = status.label;
        if (status.state === 'ready') {
            dot.style.background = '#128a2e';
            box.title = 'Tesco Toolkit has captured a usable auth token for this session.';
        } else if (status.state === 'expired') {
            dot.style.background = '#d97706';
            box.title = 'Tesco auth expired. Browse Tesco normally or use a Tesco list/basket action so the toolkit can capture a fresh token.';
        } else {
            dot.style.background = '#b91c1c';
            box.title = 'Waiting for Tesco auth. Browse Tesco normally or use a Tesco list/basket action so the toolkit can capture the token automatically.';
        }
    }

    function showNeedAuth(btn, originalText) {
        updateAuthStatusLight();
        btn.textContent = 'Need auth';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.dataset.running = '0';
        }, 3500);
    }

    async function tescoApiCall(operations) {
        let bearer = getStoredToken();
        if (!bearer) {
            updateAuthStatusLight();
        }
        if (!bearer) {
            throw new Error('NO_AUTH');
        }

        const customerUuid = getCustomerUuid();
        const res = await fetch('https://xapi.tesco.com/', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'accept': 'application/json',
                'region': 'UK',
                'language': 'en-GB',
                'x-apikey': STATIC_API_KEY,
                'authorization': bearer,
                'customer-uuid': customerUuid || '',
            },
            body: JSON.stringify(operations),
        });

        if (res.status === 401 || res.status === 403) {
            // Stored token was rejected. Clear it and let the capture layer
            // learn the next token from normal Tesco page activity.
            GM_setValue('tescoBearer', null);
            GM_setValue('tescoBearerExpiresAt', 0);
            updateAuthStatusLight();
            throw new Error('NO_AUTH');
        }

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

    function addItemsToList(listItems, listId) {
        const variables = { listType: 'CUSTOM', listItems: listItems };
        if (listId) variables.listId = listId;
        return tescoApiCall([{
            operationName: 'UpdateShoppingListItem',
            variables: variables,
            extensions: { mfeName: 'mfe-global-scripts' },
            query: 'mutation UpdateShoppingListItem($listType: ShoppingListTypeEnums!, $listId: ID, $listItems: [ShoppingListItems]!, $limit: Int, $offset: Int) {\n  updateShoppingListItem(\n    listType: $listType\n    listId: $listId\n    listItems: $listItems\n    limit: $limit\n    offset: $offset\n  ) {\n    id\n    name\n    __typename\n  }\n}\n',
        }]);
    }

    function addProductsToList(tpnbs, listId) {
        return addItemsToList(tpnbs.map((tpnb) => ({ tpnb: tpnb, quantity: 1 })), listId);
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
                out.push({
                    tpnb: node.tpnb,
                    tpnc: node.tpnc == null ? null : String(node.tpnc),
                    title: node.title,
                });
            }
        }
        for (const key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                deepFindProducts(node[key], out, seen);
            }
        }
    }

    function extractPageProducts() {
        // Tesco's SPA appends a fresh discover+json blob on every in-app
        // navigation but never removes the previous one(s). Reading only the
        // most recently added tag avoids merging stale products left over
        // from an order/page the user isn't looking at anymore.
        const scripts = document.querySelectorAll('script[type="application/discover+json"]');
        if (scripts.length === 0) return [];
        const latest = scripts[scripts.length - 1];

        const out = [];
        const seen = new Set();
        try {
            const data = JSON.parse(latest.textContent);
            deepFindProducts(data, out, seen);
        } catch (e) { /* ignore malformed blob */ }
        return out;
    }

    // ---------- Basket Copy List (trolley page) ----------

    function normalizeProductTitle(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function isTrolleyPage() {
        return /\/(shop|groceries)\/en-GB\/trolley/.test(location.pathname);
    }

    function getBasketDomItems() {
        return Array.from(document.querySelectorAll('li[data-testid="product-list-item"]'));
    }

    function extractBasketItems() {
        const pageProducts = extractPageProducts();
        const byTitle = new Map();
        const byTpnc = new Map();

        pageProducts.forEach((product) => {
            byTitle.set(normalizeProductTitle(product.title), product);
            if (product.tpnc) byTpnc.set(String(product.tpnc), product);
        });

        return getBasketDomItems().map((item) => {
            const nameEl = item.querySelector('._1bCRSG_titleContainer a');
            const priceEl = item.querySelector('._1bCRSG_priceText');
            const qtyInput = item.querySelector('input[data-auto="ddsweb-quantity-controls-input"]');
            if (!nameEl || !qtyInput) return null;

            const title = nameEl.textContent.trim();
            const href = nameEl.href || nameEl.getAttribute('href') || '';
            const productUrlId = (href.match(/\/products\/(\d+)/) || [])[1] || null;
            const discovered = (productUrlId && byTpnc.get(productUrlId)) || byTitle.get(normalizeProductTitle(title));
            const unitPrice = priceEl ? parseFloat(priceEl.textContent.replace(/[^\d.]/g, '')) : null;
            const quantity = parseInt(qtyInput.value, 10) || 1;

            return {
                title,
                tpnb: discovered ? discovered.tpnb : null,
                tpnc: discovered ? discovered.tpnc : productUrlId,
                quantity,
                unitPrice: isNaN(unitPrice) ? null : unitPrice,
                lineTotal: isNaN(unitPrice) ? null : unitPrice * quantity,
                href,
            };
        }).filter(Boolean);
    }

    function buildBasketSnapshot() {
        const items = extractBasketItems();
        return {
            schema: 'phaderon.tesco.basket-snapshot.v1',
            savedAt: new Date().toISOString(),
            sourceUrl: location.href,
            itemCount: items.length,
            totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
            items,
        };
    }

    function buildBasketText() {
        const items = extractBasketItems();
        const lines = [];
        let grandTotal = 0;

        items.forEach((item) => {
            if (item.lineTotal != null) grandTotal += item.lineTotal;
            const unit = item.unitPrice == null ? '£?.??' : `£${item.unitPrice.toFixed(2)}`;
            const total = item.lineTotal == null ? '£?.??' : `£${item.lineTotal.toFixed(2)}`;
            lines.push(`${item.title} - ${unit} x ${item.quantity} = ${total}`);
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

    function copyBasketSnapshot(btn) {
        const snapshot = buildBasketSnapshot();
        const text = JSON.stringify(snapshot, null, 2);
        GM_setValue('lastBasketSnapshot', text);
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
        } else {
            navigator.clipboard.writeText(text);
        }

        const missingTpnb = snapshot.items.filter((item) => !item.tpnb).length;
        const original = btn.textContent;
        btn.textContent = missingTpnb ? `Backed up (${missingTpnb} unmatched)` : 'Basket backed up';
        setTimeout(() => { btn.textContent = original; }, 2500);
    }

    async function saveBasketToList(btn) {
        const snapshot = buildBasketSnapshot();
        const listItems = snapshot.items
            .filter((item) => item.tpnb)
            .map((item) => ({ tpnb: item.tpnb, quantity: item.quantity }));
        const missing = snapshot.items.filter((item) => !item.tpnb);

        if (listItems.length === 0) {
            window.alert('I could not match any basket items to Tesco product numbers. Use "Backup Basket JSON" as a fallback.');
            return;
        }
        if (missing.length > 0) {
            const ok = window.confirm(
                `Matched ${listItems.length}/${snapshot.items.length} basket items.\n\n` +
                `${missing.length} item(s) could not be matched to Tesco product numbers and will only be in the JSON backup.\n\n` +
                'Continue saving the matched items to a list?'
            );
            if (!ok) return;
        }

        GM_setValue('lastBasketSnapshot', JSON.stringify(snapshot, null, 2));
        btn.dataset.running = '1';
        const original = btn.textContent;
        btn.textContent = 'Choose a list...';

        const choice = await pickListId();
        if (choice.cancelled) {
            btn.textContent = original;
            btn.dataset.running = '0';
            return;
        }
        if (choice.error) {
            if (choice.error.message === 'NO_AUTH') {
                showNeedAuth(btn, original);
                return;
            }
            btn.textContent = 'Failed to load lists';
            setTimeout(() => {
                btn.textContent = original;
                btn.dataset.running = '0';
            }, 3000);
            return;
        }

        btn.textContent = `Saving ${listItems.length}...`;
        try {
            await addItemsToList(listItems, choice.listId);
            btn.textContent = `Saved ${listItems.length} to list`;
        } catch (e) {
            btn.textContent = 'Failed, see console';
            console.error('Tesco Toolkit: save basket to list failed', e);
        }

        setTimeout(() => {
            btn.textContent = original;
            btn.dataset.running = '0';
        }, 3500);
    }

    function initBasketCopy() {
        const existing = document.getElementById('basket-copy-btn');
        const backupExisting = document.getElementById('basket-backup-btn');
        const saveExisting = document.getElementById('basket-save-list-btn');
        const onTrolleyPage = isTrolleyPage();
        const hasBasketItems = getBasketDomItems().length > 0;

        if (!onTrolleyPage || !hasBasketItems) {
            if (existing) existing.remove();
            if (backupExisting) backupExisting.remove();
            if (saveExisting) saveExisting.remove();
            return;
        }

        if (!existing) {
            const btn = makeFloatingButton('basket-copy-btn', 'Copy Basket List', 20);
            btn.addEventListener('click', () => copyBasket(btn));
            document.body.appendChild(btn);
        }

        if (!backupExisting) {
            const btn = makeFloatingButton('basket-backup-btn', 'Backup Basket JSON', 70);
            btn.addEventListener('click', () => copyBasketSnapshot(btn));
            document.body.appendChild(btn);
        }

        if (!saveExisting) {
            const btn = makeFloatingButton('basket-save-list-btn', 'Save Basket To List', 120);
            btn.addEventListener('click', () => {
                if (btn.dataset.running === '1') return;
                saveBasketToList(btn);
            });
            document.body.appendChild(btn);
        }
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
        const onProductPage = /\/(shop|groceries)\/en-GB\/products\//.test(location.pathname);
        const onTrolleyPage = isTrolleyPage();
        const products = extractPageProducts();

        // Individual product pages already have their own native "Save to list"
        // link (Tesco appears to be rolling this out inconsistently across
        // products), so this button would just be redundant clutter there.
        if (onProductPage || onTrolleyPage || products.length === 0) {
            if (existing) existing.remove();
            return;
        }

        if (existing) {
            // Keep the label honest as the user navigates between pages
            // in-app (SPA route changes don't reload the script).
            if (existing.dataset.running !== '1') {
                existing.textContent = `Add ${products.length} Item(s) To List (API)`;
            }
            return;
        }

        const btn = makeFloatingButton('api-add-to-list-btn', `Add ${products.length} Item(s) To List (API)`, 120);

        btn.addEventListener('click', async () => {
            if (btn.dataset.running === '1') return;
            btn.dataset.running = '1';
            const originalText = btn.textContent;

            const currentProducts = extractPageProducts();
            btn.textContent = 'Choose a list...';

            const choice = await pickListId();
            if (choice.cancelled) {
                btn.textContent = originalText;
                btn.dataset.running = '0';
                return;
            }
            if (choice.error) {
                const message = choice.error && choice.error.message === 'NO_AUTH'
                    ? 'Need auth'
                    : 'Failed to load lists';
                btn.textContent = message;
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
        installAuthCapture();
        updateAuthStatusLight();
        initBasketCopy();
        initBulkSaveByClicking();
        initApiAddToList();
    }

    installAuthCapture();
    initAll();
    // Tesco's pages re-render content asynchronously, so keep checking
    // in case our buttons get removed or the relevant content loads late.
    setInterval(initAll, 2000);
})();
