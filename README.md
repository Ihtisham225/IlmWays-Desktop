# IlmWays Desktop

The IlmWays school app for Windows and macOS. It shows the full IlmWays web
app in its own window, and keeps the work that can't wait working when the
internet drops, syncing when it comes back. Attendance works offline from
v0.2.0; fee collection, registering students and marks entry follow.

**Download:** the latest installers are on the
[Releases page](https://github.com/Ihtisham225/IlmWays-Desktop/releases/latest).
Installed apps update themselves.

The plan behind it is `docs/DESKTOP-PLAN.md` in the
[ilmways](https://github.com/Ihtisham225/ilmways) repo.

## How it works

- **Sign-in needs the internet.** The password is checked by the server and
  never stored on the PC. The PC receives a device token, kept encrypted by
  the operating system's keychain (`safeStorage`).
- **Signed in, the PC stays signed in** across restarts and offline, until
  it has gone 30 days without reaching the server, it is signed out from the
  website, or someone signs out.
- **The web app runs under the app's own bar** in a sandboxed view with no
  access to the app or to Node. The app trades its device token for a
  one-minute code and the view signs in with it, so the window has an
  ordinary web session.
- **Every 30 seconds**, on focus and after sleep, the app checks the server.
  Offline, the web view is hidden and an offline page shows; it comes back by
  itself when the internet does.
- **Signing out inside the web app signs the PC out.**
- The platform (super) admin can sign in, online only.

### Offline work

- **An encrypted copy of the school on the PC.** One SQLite file per school
  and user (SQLCipher-style encryption, `better-sqlite3-multiple-ciphers`),
  with a random key kept by the keychain (`safeStorage`). It holds only the
  tables the server lets that user keep: a teacher gets the register's view
  of students (name, admission number, status), never addresses or phones.
  The platform admin gets no file at all.
- **One write path.** A save goes to the PC first, as a change in the outbox,
  and is sent at once when online. Screens show the server's copy with the
  waiting changes laid over it, so a download never overwrites them.
- **Sync** sends waiting changes, then downloads what changed (deletions
  first, then each table in pages, resumable). It runs after every save,
  with each 30-second check, on focus and on reconnect.
- **Changes the server refuses** stay on the PC under *Needs attention*,
  with *Try again* and *Discard*.
- **Signing out** deletes the copy and its key, unless changes haven't been
  sent yet: those are kept until the same person signs in again.
- **The register** is the web's daily register. Today's can be marked by
  anyone who marks attendance; an earlier day needs the edit permission. A
  register marked offline counts as marked on its own day when it arrives;
  one sent on a later day messages no parents.

```
electron/main.ts     window, web view, sign-in, connection checks, updates
electron/server.ts   the server's /api/desktop/v1 calls
electron/store.ts    the encrypted device token on disk
electron/offline.ts  where the encrypted offline copy lives, and its key
electron/localdb.ts  the offline copy: mirror, outbox, register queries (tested)
electron/sync.ts     the sync engine: send, then download (tested)
electron/preload.ts  the window's only bridge to the main process
shared/              types and rules shared by both sides (with tests)
src/                 the window's own screens: title bar, sign-in, offline work, attendance
```

## Develop

```bash
npm install
npm run dev          # against https://www.ilmways.com
npm run dev:local    # against an IlmWays server on http://localhost:3000
                     # (a development run keeps its own data, in "ilmways-desktop-dev",
                     # so it never touches the sign-in of an installed IlmWays)
npm test             # runs under Electron's own Node, which the SQLite module needs
npm run typecheck
```

## Release

Push a version tag; GitHub Actions builds, signs and publishes the installers
and the update manifests to a GitHub Release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Signing uses repository secrets (the same names as UC-Ultra-Desktop):
`CSC_LINK`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
`APPLE_TEAM_ID` for macOS, and `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` for
Windows. Without the Windows certificate the installer is built unsigned and
Windows SmartScreen warns on first run.
