# Tesco Toolkit

A growing collection of Violentmonkey/Tampermonkey userscripts for Tesco's grocery site.

## Scripts

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
