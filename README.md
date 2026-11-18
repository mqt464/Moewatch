# Moewatch

An anime catalog and player for Windows and the browser, with AniList sync.

## Desktop

Download the Windows x64 installer from [Releases](https://github.com/mqt464/Moewatch/releases).

Sign in with AniList to sync your list. No configuration is required.

Moewatch checks for updates at startup. You can also check in Settings > About. Click Install update to download, install and restart the app.

## Run in a browser

Requires Node.js 22.12 or newer.

```sh
npm install
npm start
```

Open `http://localhost:5173`, or `http://<your-LAN-IP>:5173` from another device. Keep the server on a trusted network.

## Development

```sh
npm test
npm run build
```

To build the Windows desktop app, install Rust, MSVC build tools and Bun, then run `npm run desktop:build`.

[API configuration](server/README.md) · [Sign-in relay](auth-relay/README.md) · [Release audit](AUDIT.md)
