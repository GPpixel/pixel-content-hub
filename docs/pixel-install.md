# Installing Pixel Content Hub

These steps install Pixel Content Hub on a Linux machine (Debian, Ubuntu or similar) in `~/pixel-content-hub`, running on port **2004**.

| | |
| --- | --- |
| Folder | `~/pixel-content-hub` |
| Port | **2004** (HTTPS 3444, only if certificates are added) |
| Database, uploads, secrets | `~/pixel-content-hub/server/db`, `uploads`, `certs` |
| Service name (optional) | `pixel-content-hub` |

It keeps everything in its own folder and port, so it can run on a machine that already runs ScreenTinker (folder `~/screentinker`, port 3001) without touching it. The two have separate databases and accounts.

## Needs

- Node 22.14 or newer. If the system Node is older, install a newer one with [nvm](https://github.com/nvm-sh/nvm). The commands below load nvm from `~/.config/nvm`; leave out the `source` line if Node comes from elsewhere.
- Emoji and symbol fonts on any Linux machine that opens the dashboard in a browser. Some buttons (the designer tools, Talk, close ✕) use emoji as their icon, and many Linux installs have no emoji font, so they show as empty boxes: `sudo apt install -y fonts-noto-color-emoji fonts-dejavu-core`, then close and reopen the browser.
- Access to the private GitHub repository. When `git clone` asks for a password, use a GitHub personal access token (GitHub → Settings → Developer settings → Personal access tokens), not your GitHub password.

## Install

```bash
source ~/.config/nvm/nvm.sh
node -v
cd ~
git clone https://github.com/GPpixel/pixel-content-hub.git
cd ~/pixel-content-hub/server
npm install
printf 'SELF_HOSTED=true\nDISABLE_HOMEPAGE=true\nST_HIDE_SPONSOR=true\nPORT=2004\nHTTPS_PORT=3444\n' > .env
cat .env
```

`node -v` must print v22.14 or newer. `cat .env` should show the five lines, including `PORT=2004`.

## Run it

```bash
source ~/.config/nvm/nvm.sh
cd ~/pixel-content-hub/server
npm start
```

Open `http://<server-ip>:2004` (find the IP with `hostname -I`). The first account you register is the admin. Screens open `http://<server-ip>:2004/player` to get a pairing code.

If the firewall is on (`sudo ufw status` says active), open the port: `sudo ufw allow 2004/tcp`.

## Run it as a service (optional)

So it starts on boot and keeps running after you log out. Stop the `npm start` from above first (Ctrl+C).

```bash
sudo cp ~/pixel-content-hub/scripts/pixel-content-hub.service /etc/systemd/system/
sudo nano /etc/systemd/system/pixel-content-hub.service
```

In the file, replace each `youruser` with your Linux user name (`whoami` prints it), save, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pixel-content-hub
systemctl status pixel-content-hub --no-pager
```

Logs: `journalctl -u pixel-content-hub -f`.

## Update

```bash
source ~/.config/nvm/nvm.sh
cd ~/pixel-content-hub
git pull
cd server
npm install
```

Then restart it: Ctrl+C and `npm start` again, or `sudo systemctl restart pixel-content-hub`.

Don't use **Platform → System → Update Now** in the dashboard: it installs upstream ScreenTinker releases, not Pixel Content Hub.

## Remove

```bash
sudo systemctl disable --now pixel-content-hub
sudo rm /etc/systemd/system/pixel-content-hub.service
rm -rf ~/pixel-content-hub
```

The first two lines are only needed if you installed the service. This deletes Pixel Content Hub's database and uploads with it.
