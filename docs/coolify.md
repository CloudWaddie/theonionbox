# Deploying The Onion Box on Coolify (and connecting your relays & bridges)

*The Onion Box* runs as one small container. It monitors any number of Tor relays, bridges and clients; each node is
reached through its Tor **ControlPort**. The list of nodes - and the credentials to reach them - lives in a volume.

```
 browser ──HTTPS──► Coolify proxy ──► The Onion Box ──ControlPort──► relay 1 / relay 2 / bridge ...
                                       │ (password protected)        (private network!)
                                       └── /data  (cc.cfg = your nodes)
```

## 1. Deploy

1. In Coolify: **New resource → Public/Private Repository** → this repository, branch `master`.
2. Build pack: **Docker Compose**, compose file `/docker-compose.yml`.
   (Alternative: build pack *Dockerfile*, port `8080`, and add a persistent storage mounted at `/data`.)
3. Environment variables:

   | Variable | |
   |---|---|
   | `TOB_ACCESS_PASSWORD` | **Required.** One long random password that protects the whole Box. |
   | `TOB_CONTROLCENTER` | Optional. `0` = single node dashboard instead of the ControlCenter. |

4. Assign a domain to the `theonionbox` service (the compose file asks Coolify for one on port `8080`) and **Deploy**.
5. Open the domain, sign in with `TOB_ACCESS_PASSWORD`, click **Add node**.

> **Why the password matters.** Whoever reaches the Box can see your nodes - and make the Box connect to any
> `host:port` they type. Without `TOB_ACCESS_PASSWORD` the Box warns at start-up and the compose file refuses to
> start. The login is a cookie login (rate limited), not HTTP Basic auth, so it does not clash with the Tor logins.

`/data` holds `cc.cfg` (nodes **and their passwords / cookies**, in clear text) and the recorded bandwidth history.
Keep it on the volume, include it in your backups, treat it as a secret.

## 2. Prepare each relay / bridge

Relays and bridges are ordinary Tor processes - add to the `torrc`:

```
# Reachable on the PRIVATE address only - never 0.0.0.0, never a public IP.
ControlPort 10.8.0.11:9051

# Pick ONE way to authenticate:
HashedControlPassword 16:....            # create with:  tor --hash-password 'a long password'
# CookieAuthentication 1                 # see "Cookie authentication" below
```

then restart Tor (`systemctl restart tor`). Firewall port `9051` so that only the Coolify server / your VPN can connect.

**The ControlPort speaks plain text.** A password (or the commands that follow a cookie login) is readable by anyone on
the path. Do not send it over the internet. Use one of

* **a VPN / mesh** such as WireGuard or [Tailscale](https://tailscale.com): bind the `ControlPort` to the VPN address
  and use that address in the Box (the container reaches it through the Coolify server's routing);
* **the same server / Docker network** as the Box: relay containers can expose the ControlPort to that network only
  (no published port) - use the container's name as host;
* an SSH tunnel.

### Add the node in the Box

**Add node →** name (optional), *ControlPort (TCP)*, host, port, then the control password. **Test connection**
checks that a Tor ControlPort answers (it deliberately does not try the password); **Add node** stores it. The card
shows *Connecting → Online*, or tells you what is wrong. **Details** opens the full dashboard of that node.

### Cookie authentication

With `CookieAuthentication 1` Tor writes a random cookie file and accepts whoever can present it. Where the file is
depends on how Tor was installed: `/run/tor/control.authcookie` with the Debian / Ubuntu packages (it lives in `/run`,
so it is new after every start), `<DataDirectory>/control_auth_cookie` for a plain Tor. Two situations:

* **The Box can read that file** (same machine, or a volume shared with the Tor container - add
  `CookieAuthFileGroupReadable 1` if the users differ): add the node without a password; nothing else to do.
* **The node is on another machine** (the normal case): paste the cookie into **Control cookie**. On the node:

  ```bash
  od -An -v -tx1 /run/tor/control.authcookie | tr -d ' \n'     # Debian / Ubuntu package
  ```

  (64 hex characters). The Box authenticates with `SAFECOOKIE`, so the cookie itself never crosses the network.

Rotating the cookie (Tor regenerates it on restart) means pasting the new one: **edit the node → Control cookie**.

## 3. Operating it

| Card says | Meaning / what to do |
|---|---|
| **Connecting** | The Box is dialling the node (a dead host takes up to ~30 s to give up). Other nodes are not affected. |
| **Login needed** | Password or cookie missing / wrong. Edit the node. The error line says which. |
| **Offline** | Nothing answers: wrong host/port, firewall, Tor down, or `ControlPort` not bound to that address. |

* Nodes reconnect on their own after restarts of Tor or of the Box.
* Re-order cards with the arrows on each card. Everything is stored in `cc.cfg`.
* Update: redeploy in Coolify. Nodes and history stay in the `tob-data` volume.
* Behind a path prefix (`https://host/tob/`) set `base_path = /tob` in a config file mounted over
  `/etc/theonionbox/theonionbox.cfg`; the proxy must strip the prefix.

## Not on Coolify?

```bash
TOB_ACCESS_PASSWORD='long random password' docker compose up -d      # add  ports: ["8080:8080"]  to expose it
```
