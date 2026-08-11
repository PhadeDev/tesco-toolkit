# Tesco Toolkit

A growing collection of Violentmonkey/Tampermonkey userscripts for Tesco's grocery site.

## Scripts

### Tesco Toolkit — All-in-One (`scripts/tesco-toolkit.user.js`)

**Recommended install.** One userscript, three features, each only active on
the page it's relevant to:

- **Copy Basket List** — trolley page, copies the basket contents to clipboard
- **Save All To List (click automation)** — My Favourites / Last Order,
  clicks every "Save to list" link in sequence and dismisses the popup
- **Add Item(s) To List (API)** — works on *any* page, including order
  receipts and individual product pages, where Tesco provides no
  "save to list" control at all

The API-based feature works by reading `tpnb` (Tesco's internal product
number) out of a hidden `<script type="application/discover+json">` data
blob that every Tesco page embeds, then calling Tesco's own GraphQL API
(`xapi.tesco.com`, `UpdateShoppingListItem`) directly — no clicking, no
modals, and it can batch dozens of items into a single request.

**Auth token (manual, once an hour or so):** this call needs a short-lived
Tesco access token. It can't be read from browser storage (Tesco keeps it
in memory only), and it can't be sniffed from page traffic either — Tesco's
site appears to actively defend against exactly this kind of interception
(Akamai bot-protection, Queue-it headers present on every API response).
So instead, the first time you use the button — and again whenever the
token expires, roughly hourly — it'll prompt you to paste one:

1. Open DevTools (F12) → Network tab
2. Do anything list-related on the site (e.g. click a real "Save to list" link)
3. Click the request to `xapi.tesco.com` in the list
4. Paste **anything** containing that request into the prompt — the raw
   `authorization` header line, a full "Copy as cURL/fetch," the whole
   Headers panel, or an entire pasted HAR export all work. The script finds
   the `Bearer ...` token itself via pattern match, so there's no need to
   isolate the exact line by hand.

Note this only matters for pages with no native "Save to list" control at
all (order receipts, the basket). My Favourites / Last Order / Previously
Bought have a real clickable "Save to list" link Tesco built themselves —
use the "Save All To List" click-automation button there instead, which
needs no token at all.

It's stored locally via Violentmonkey's own storage (`GM_setValue`) and
reused until it expires. Nothing is hardcoded in the script except a
static, non-secret `x-apikey` value shared by every visitor to the site —
your personal token never leaves your machine or gets committed anywhere.

This script runs on nearly all of `tesco.com/shop/en-GB/*` and
`tesco.com/groceries/en-GB/*`, not just the specific pages above — each
button still only appears where its feature actually applies. If you
previously installed the two standalone scripts below, remove them from
Violentmonkey after installing this one to avoid duplicate buttons.

### Tesco Basket Copy List (`scripts/tesco-basket-copy-list.user.js`)

Adds a "Copy Basket List" button to the Tesco trolley page. Copies a clean
`Name - £price x qty = £total` breakdown of your basket (plus a grand total)
to the clipboard.

- Matches `tesco.com/shop/en-GB/trolley*` and `tesco.com/groceries/en-GB/trolley*`
- Re-adds the button every 2s to survive the trolley page's async re-renders

### Tesco Bulk Save to List (`scripts/tesco-bulk-save-to-list.user.js`)

Adds a "Save All To List" button to My Favourites / Last Order. Clicking a
single "Save to list" link on that page instantly saves the item to your
default/last-used list and pops up a confirmation dialog — this script
automates that: it clicks each unsaved item's "Save to list" button in
sequence, waits for the confirmation dialog, closes it, and moves to the
next item, until every item on the page is saved.

- Matches `tesco.com/shop/en-GB/favourites*` and `tesco.com/groceries/en-GB/favourites*`
- Saves to whichever list Tesco last used for a save — to target a specific
  list, click "Change list" once on the first item manually before running
  the bulk button, since Tesco appears to remember that choice for
  subsequent saves
- No known way to save an item to a list from its individual product page —
  Tesco doesn't render that control there at all (confirmed via DOM
  inspection, not just CSS-hidden)

## Install

Install [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey, then
open the raw script file from this repo and it'll prompt to install.
