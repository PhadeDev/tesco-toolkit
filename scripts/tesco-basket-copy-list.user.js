// ==UserScript==
// @name         Tesco Basket Copy List
// @namespace    phaderon.tesco.basket.copy
// @version      1.1
// @description  Adds a button that copies a clean product/price/qty list of your Tesco basket to the clipboard
// @match        https://www.tesco.com/shop/en-GB/trolley*
// @match        https://www.tesco.com/groceries/en-GB/trolley*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

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

    function copyBasket() {
        const text = buildBasketText();
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
        } else {
            navigator.clipboard.writeText(text);
        }

        const btn = document.getElementById('basket-copy-btn');
        if (btn) {
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = original; }, 1500);
        }
    }

    function addButton() {
        if (document.getElementById('basket-copy-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'basket-copy-btn';
        btn.textContent = 'Copy Basket List';
        btn.style.position = 'fixed';
        btn.style.bottom = '20px';
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

        btn.addEventListener('click', copyBasket);
        document.body.appendChild(btn);
    }

    addButton();
    // Basket loads content async, so keep checking in case the button gets removed by a re-render
    setInterval(addButton, 2000);
})();
