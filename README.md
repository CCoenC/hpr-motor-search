# HPR Motor Search

Look up a high-power motor — `I115`, `J350`, White Lightning, 54 mm — and see which vendors have it, the price, how many are on the shelf, when that page was last checked, and the thrust curve.

## What it uses

- **Stock, price, and quantity** come from the public hourly vendor snapshot at [motor.fusionspace.co](https://motor.fusionspace.co/api/v1/motors.json). That scrape covers AeroTech, Cesaroni, and Loki across the usual U.S. shops (BuyRocketMotors, Wildman, Animal Motor Works, Performance Hobbies, Balsa Machining, and others). **Motorman** ([the-motorman.net](https://www.the-motorman.net/)) is merged on top of that: his pages list everything he can stock, and only a line ending in `(n)` is actually on the shelf. He sells at launches, not by mail.
- **Specs and thrust curves** come live from the [ThrustCurve.org API](https://www.thrustcurve.org/info/api.html).

The snapshot does not include a separate “restocked on” timestamp. HPR Motor Search shows **last checked** — when that vendor listing was scraped — and the quantity the page published.

## Extras past a plain stock list

- Value sort (`$ / N·s`)
- Rocket fit by motor-mount diameter and cert level
- Compare up to three motors with overlaid thrust curves
- Star list and an order pile you can copy
- Shareable lookup (`?q=I115`)

Confirm price and stock on the vendor page before you pay. Scrapes go stale.
