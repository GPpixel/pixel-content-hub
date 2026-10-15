# Installing Pixel Content Hub on a Raspberry Pi

This installs Pixel Content Hub next to an existing ScreenTinker install without touching it. The two run side by side:

| | ScreenTinker | Pixel Content Hub |
| --- | --- | --- |
| Folder | `~/screentinker` | `~/pixel-content-hub` |
| Port | 3001 | **2004** (HTTPS 3444, only if certificates are added) |
| Database, uploads, secrets | `~/screentinker/server/db`, `uploads`, `certs` | `~/pixel-content-hub/server/db`, `uploads`, `certs` |
| Service name (optional) | none | `pixel-content-hub` |

Each has its own database and its own accounts: register again on Pixel Content Hub, and pair screens to it separately.

## Needs

- Node 22.14 or newer. On the Pi it comes from nvm in `~/.config/nvm`; the system Node is too old.
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

In its own terminal (or SSH session), so ScreenTinker keeps running in the other one:

```bash
source ~/.config/nvm/nvm.sh
cd ~/pixel-content-hub/server
npm start
```

Open `http://<pi-ip>:2004` (find the IP with `hostname -I`). The first account you register is the admin. Screens open `http://<pi-ip>:2004/player` to get a pairing code.

If the Pi's firewall is on (`sudo ufw status` says active), open the port: `sudo ufw allow 2004/tcp`.

## Run it as a service (optional)

So it starts on boot and keeps running after you log out. Stop the `npm start` from above first (Ctrl+C).

```bash
sudo cp ~/pixel-content-hub/scripts/pixel-content-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pixel-content-hub
systemctl status pixel-content-hub --no-pager
```

The service file assumes the user `pi` and the paths above; edit it first if yours differ. Logs: `journalctl -u pixel-content-hub -f`.

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

The first two lines are only needed if you installed the service. This deletes Pixel Content Hub's database and uploads with it, and leaves `~/screentinker` alone.
