# Tesco Toolkit

A growing collection of Violentmonkey/Tampermonkey userscripts for Tesco's grocery site.

## Scripts

### Tesco Basket Copy List (`scripts/tesco-basket-copy-list.user.js`)

Adds a "Copy Basket List" button to the Tesco trolley page. Copies a clean
`Name - £price x qty = £total` breakdown of your basket (plus a grand total)
to the clipboard.

- Matches `tesco.com/shop/en-GB/trolley*` and `tesco.com/groceries/en-GB/trolley*`
- Re-adds the button every 2s to survive the trolley page's async re-renders

## Install

Install [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey, then
open the raw script file from this repo and it'll prompt to install.
