# Web player

The web player is the screen side of ScreenTinker running in a browser: open
`https://<your-server>/player` on the display device and it shows the display's playlist. It runs
in any current browser and in kiosk shells and casting devices built on one (Fully Kiosk Browser,
UniFi Cast / Pro Display, vMix browser inputs, Chrome in kiosk mode, ChromeOS, smart-TV browsers).
Old WebViews get `/player/legacy`, the same player compiled for older engines.

There are two ways to make a browser into a display.

| | Pairing code | Display link (`?k=`) |
|---|---|---|
| Start from | the screen: open `/player`, it shows a 6-digit code | the dashboard: **Add display → "This player can't stay paired"**, which creates the display and gives you its URL |
| You then | type the code into the dashboard | paste the link into the device's browser / kiosk start URL |
| Identity is kept in | the browser's storage | the link itself (and the browser's storage, if it has one) |
| Use it when | the browser keeps its storage | the browser loses its storage (vMix, kiosk shells that wipe on restart), or you want to set the URL up before the device is installed |

## Display links (`/player?k=…`)

A display link names one display. The `k` value is a long random key (a credential: treat the
link like a password). Anyone who opens the link becomes that display, so share it only with the
device it is for.

The display's **Web player** tab in the dashboard shows the link, so you can **Copy** it again later,
or press **New URL** to replace it (the old link stops working; paste the new one into the device).

### Which display does a browser become?

Since 3.0 the link always wins when it is valid:

- **The link's key is valid:** the browser becomes the display the link names, whatever it was
  before. This includes a browser that still has an identity in its storage from an earlier
  pairing or an earlier server, for example a casting device that was paired before you rebuilt the
  server, or a screen you are moving to a different display by giving it a new link.
- **The link's key is unknown to the server** (rolled, revoked, the display was deleted, or the link
  was made on a different server) **and the browser has a working identity of its own:** it keeps
  that identity. A screen that still has an old link in its start URL after you roll the key keeps
  working.
- **The link's key is unknown and the browser has no working identity:** the player shows a pairing
  code, with a note under it explaining that the display link was not recognised. Pair it with the
  code, or copy the display's current link from the dashboard into the device.

> **Before 3.0 (2.6.x and earlier)** a browser with a stored identity ignored the key in its URL.
> If the server had been rebuilt or the display deleted, such a device showed a pairing code and
> appeared as a new, separate display, while the display the link was made for stayed offline. On
> those versions, clear the device browser's site data for your ScreenTinker address (or reinstall
> the casting app) and open the link again. (GitHub #630)

### Troubleshooting a display link

| What the screen shows | What it means | What to do |
|---|---|---|
| The playlist | Working | Nothing |
| A pairing code **with** a note about the display link | The server does not know this key | Copy the display's current link from its dashboard page into the device, or pair with the code |
| A pairing code **without** that note | The device was not opened with a `?k=` link (check the start URL; some devices drop the query string) | Check the start URL carries `?k=…` |
| "Tap anywhere to start" | Normal cold start, see sound below | Nothing, it continues by itself after 5 seconds |

## Starting with sound (`?autoplay_audio=1`)

Browsers do not let a page play sound until someone has interacted with it. So on every cold start
the player shows **Tap anywhere to start / Audio requires user interaction**. Without a tap it
continues after 5 seconds **muted**. That is the right default for ordinary browsers.

Some kiosk browsers can lift that restriction, for example Fully Kiosk Browser with its
**Autoplay Audio** setting (`autoplayAudio`) turned on. For those, add `autoplay_audio=1` to the start
URL:

```
https://signage.example.com/player?k=<key>&autoplay_audio=1
https://signage.example.com/player?autoplay_audio=1          (a display paired with a code)
```

With the parameter, the player asks the browser whether sound is allowed by starting a tenth of a
second of silence unmuted. If the browser allows it, the tap screen is skipped and the display
starts with sound straight away, after every reboot or power cut. If the browser refuses (the kiosk
setting is off, or it is an ordinary browser), nothing changes: the tap screen is shown and the
player continues muted after 5 seconds, as without the parameter. The browser console then logs
`autoplay_audio=1, but this browser refused unmuted playback`.

Notes:

- The parameter is opt-in. A normal browser opening `/player` behaves exactly as before.
- Only `1` or `true` turns it on.
- The ScreenTinker Android app does not need it: it lifts the WebView restriction itself and never
  shows the tap screen.
- Items you have muted in the playlist stay muted, and video-wall followers stay silent, with or
  without the parameter.
- In Chrome you can test it with `--autoplay-policy=no-user-gesture-required`.

## How changes reach the screen

The server pushes every published change to the player over its live connection, and the player
also re-checks every 5 minutes in case a push was missed. On reconnect (after a network drop, server
restart or sleep) it receives the current playlist straight away.

What happens on screen when the playlist changes:

- Items that are still in the playlist keep playing; the new order takes effect at the next item.
  An item is not cut off mid-play.
- A removed item that is on screen finishes and then rotates out (at most 60 seconds later).
- A playlist that had **one item** and gains more: the single item was playing on a loop. It now
  finishes its current pass and the playlist rotates on. A YouTube item rotates at the end of its
  current play-through; a widget after its duration.
- Edits only reach screens once the playlist is **published**. An unpublished playlist shows
  "Unpublished changes" in the dashboard and screens keep showing the last published version.

> **Before 3.0 (2.6.x and earlier)** an item added to a playlist that had a single **video** or
> **YouTube** item never appeared: the one item kept looping until the browser was restarted.
> Workaround on those versions: reload the player page or restart the browser after adding the
> item. (GitHub #632)
