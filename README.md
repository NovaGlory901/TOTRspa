# TOTR listener app (TOTRspa)

The app people listen with: a React web app (`TOTRspa_web`) that the TOTR server also serves at `/app/`, wrapped as a Windows and Linux desktop app with Electron
(`TOTRspa_win`, `TOTRspa_linux`) and as an Android app with Capacitor (`TOTRspa_apk`). `shared/` holds the code the shells have in common. It needs a TOTR server
(the TOTRsrv project) to talk to; the app never has a built-in server address.

## Develop

```sh
npm install
TOTR_SERVER=https://your-server.example:8443 npm run dev        # the web app in a browser; /api is forwarded to that server
TOTR_SERVER=... npm run electron:dev:linux                       # a desktop window (electron:dev:win on Windows)
```
`TOTR_SERVER` defaults to `http://localhost:8080`. Put it in a `.env` file in `TOTRspa_web/` to keep it, and keep that file out of git.

## Test

```sh
npm install && npm test        # runs every workspace's tests
```
The desktop shell's tests run the real shell code against a stand-in for Electron (no window opens): who may press which button, server trust, signed updates, damaged
settings files, first run. They need only Node; a few cross-checks against the real server (certificates, fingerprints, signatures, joining) run only when the TOTRsrv project is in a folder next to this one, and print `skip` otherwise.

## Build installers

```sh
npm run dist:linux        # AppImage
npm run dist:win          # Windows installer (run it on Windows)
npm run android:build:linux   # APK (needs the Android SDK)
```
**Your server's certificate authority.** A server that makes its own HTTPS certificates (the TOTR server does) is trusted by an app that has that server's authority built in: before a build, `npm run sync-ca` (run for you by the build scripts) copies the *public* `certs/totr-ca.pem` of your server into the app (`TOTR_CERTS_DIR` says where to find it). This repository ships without one, so the app then trusts only the usual authorities and asks the person to compare a fingerprint for a server with its own (see below).

Installers are not kept in git; they are uploaded to the server's downloads folder (`node shared/tools/deploy.cjs`, configured in `shared/deploy.config.json`).

## First run and servers

A new desktop install asks which server to use. Servers with an ordinary certificate just work. A server with its own certificate authority (a friend's TOTR) is
trusted only after the person compares a short fingerprint shown in a native dialog with the one on that server's admin page. The choice is kept for that server only;
if its certificate later changes the app refuses it and says so. The server list is kept outside the web page, so **Reset app** (You > About) leaves it alone.

## Security

- Electron pages run with context isolation, the sandbox and no Node; the shell's buttons answer only to the app's own pages; developer tools are off in installed apps.
- App updates install only if the update file is signed with the developer's Ed25519 key, whose public half is in `shared/electron/update_pubkey.txt` (empty until the developer adds it; with no key the app installs no updates), and the download must match the checksum in that signed file.
- Whichever server the app is connected to, only the developer's signature counts for the app's own updates.
- To report a security problem privately, see [SECURITY.md](SECURITY.md): use this repository's Security tab, then Report a vulnerability.

## Licence

This is **source-available for non-commercial use**, under the PolyForm Noncommercial License 1.0.0 (the `LICENSE` file; https://polyformproject.org/licenses/noncommercial/1.0.0). You may use, change and share it for free for any non-commercial purpose; you may not sell it or use it commercially. It is not an OSI "open source" licence, because it forbids commercial use. Code from other projects that ships inside (for example in `third_party/` or `static/fonts/licenses`) keeps its own licence.
