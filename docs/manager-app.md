# ScreenTinker Manager (Android)

`android-admin/` is **ScreenTinker Manager**, a phone app for keeping screens up to date. Package:
`com.screentinker.manager`. It is a separate project from the player app (`android/`,
`com.remotedisplay.player`).

The app is a small native shell around the dashboard's **Simple view**. It needs a **3.0+** server.
Everything the user sees inside it is the server's own Simple view, so web changes reach the app
without an app update.

## What it does

- **Your servers.** screentinker.com and/or any self-hosted servers. Each new server is checked
  (`/api/status`, version 3.0 or newer) before it is saved. Tap a server to switch, or Remove it.
  Each server keeps its own sign-in, because WebView storage is per origin.
- **The Simple view, full screen.** Add a screen, change what a screen shows, upload photos, your
  team (invites), help. The dashboard recognises the app by its user agent
  (`ScreenTinkerManager/<version>`) and the `window.STManager` bridge, and stays in Simple view.
- **Phone extras:**
  - Uploads use Android's photo picker (no storage permission).
  - **Share → ScreenTinker Manager** ("Show on a screen") from Photos or Gallery uploads the files
    and opens "Which screens should show it?".
  - Invite links go through Android's share sheet.
- **Opens in the browser instead:** Advanced, Admin and Account settings open in a Custom Tab (the
  phone's browser), as do links to other sites. Advanced turns on the Advanced view for that account
  in the browser (`#/switch-advanced`).
- **Not in the app:** plans, upgrade prompts and the self-hosted sponsor ask. Google Play's payments
  policy restricts selling subscriptions or soliciting donations outside Play billing. The same
  account sees them in a browser.
- **Review:** when a workspace requires review, the Simple flows submit changes for review and say
  "Sent for review". They never claim content is showing before a reviewer approves it.

## Building

The build needs JDK 17 and the Android SDK with `platforms;android-36`.

```
cd android-admin
./gradlew assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
VERSION_CODE=1 VERSION_NAME=1.0.0 \
MANAGER_KEYSTORE=/path/upload.jks MANAGER_KEYSTORE_PASSWORD=… \
MANAGER_KEY_ALIAS=upload MANAGER_KEY_PASSWORD=… \
./gradlew bundleRelease                      # app/build/outputs/bundle/release/app-release.aab
```

- `targetSdk 36`: Google Play requires new apps to target the latest Android release.
- `minSdk 26`: Android 8.0 or later.
- Release builds are minified. The keystore is never committed (`*.jks` / `*.keystore` are ignored).
- Debug builds enable WebView inspection (Chrome DevTools via `adb forward`), which the emulator
  tests use. Release builds do not.

## Play Store submission checklist

- **App name:** ScreenTinker Manager.
- **Icons:** `android-admin/store/icon-512.png` is the store icon. The launcher icons are generated
  in `res/mipmap-*`. They use the player's TV plus a green edit badge, so the two apps are told apart.
- **Data safety:** the app sends the user's sign-in and the photos and videos they choose to the
  server they chose. Nothing goes to a third party. No ads, no analytics SDK.
- **Permissions:** `INTERNET` only.
- **Cleartext traffic:** allowed for user-entered servers (self-hosted on a LAN is often
  `http://192.168…`), and forbidden for screentinker.com (`res/xml/network_security_config.xml`).
- **Sign-in:** Google and other single sign-on providers refuse to run inside an app's web view
  (Google returns `disallowed_useragent`). Email and password sign-in works. SSO-only accounts
  should sign in on the web for now. Moving SSO to a Custom Tab is the follow-up.
- **screentinker.com must run 3.0** before the app is useful there: on 2.6 the server check says it
  is too old.

## Testing

`android-admin` has no unit tests yet. It was exercised end to end on an Android 16 (API 36)
emulator (Pixel 7 image):

- first-run server choice;
- sign-up and the setup guide inside the app;
- the native photo picker;
- sharing from Google Photos;
- Advanced opening Chrome;
- two servers with switch-back, still signed in;
- an invite shared through the share sheet.
