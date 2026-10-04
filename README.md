# HPR Motor Search

Look up a high-power motor — `I115`, `J350`, White Lightning, 54 mm — and see which vendors have it, the price, how many are on the shelf, when that page was last checked, and the thrust curve.

## What it uses

- **Stock, price, and quantity** come from this site's own scrape of the dealer sites (AeroTech, Animal Motor Works, Apogee, Balsa Machining, BuyRocketMotors, Chris' Rocket Supplies, Loki, Moto-Joe, New Century, Performance Hobbies, Sirius, Wildman, eRockets). If a shop doesn't load, that shop is left off until the next run. Apogee is included because they told us a free tool can read their motor charts. The published site scrapes on its own every hour. Visitors cannot change that. To change it, edit `SCRAPE_INTERVAL_MINUTES` in [src/lib/scrape/schedule.ts](src/lib/scrape/schedule.ts) and publish again. Set it to `null` to turn the timer off. **Motorman** ([the-motorman.net](https://www.the-motorman.net/)) is merged on top: his pages list everything he can stock, and only a line ending in `(n)` is actually on the shelf. He sells at launches, not by mail.
- **Specs and thrust curves** come live from the [ThrustCurve.org API](https://www.thrustcurve.org/info/api.html). The motor list is AeroTech, Cesaroni, and Loki from that same catalog. Quest Q-Jets are shelf rows only, with no curve.

There is no separate “restocked on” timestamp. HPR Motor Search shows **last checked** — when that vendor listing was scraped — and the quantity the page published.

## Extras past a plain stock list

- Value sort (`$ / N·s`)
- Rocket fit by motor-mount diameter and cert level
- Compare up to three motors with overlaid thrust curves
- Star list and an order pile you can copy
- Shareable lookup (`?q=I115`)

Confirm price and stock on the vendor page before you pay. Scrapes go stale.
