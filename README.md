<p align="">
  <img src="https://games.copinstar.com/img/mularr/mularr-logo.png?1" alt="Logo">
</p>

# Mularr

[![Docker Image](https://ghcr-badge.egpl.dev/joecarl/mularr/latest_tag?trim=major&label=ghcr.io%2Fjoecarl%2Fmularr&color=blue)](https://github.com/joecarl/mularr/pkgs/container/mularr)

**Mularr** is a powerful integration for **aMule** that provides a functional web interface with a nostalgia-infused retro touch. It bridges the gap between classic P2P and modern automation tools by offering **qBittorrent-compatible APIs** and **Torznab indexers**, making it seamless to use aMule with apps like Sonarr and Radarr.

It also includes an extension to use the **Telegram Network** as a download provider. This requires a real account (not a bot) to access groups/channels with media files.

<p align="center">
  <img src="https://games.copinstar.com/img/mularr/mularr-overview.png" alt="Overview">
</p>

---

## Key Features

- **\*Arr Integration**: Native support for Sonarr/Radarr via qBittorrent & Torznab API compatibility.
- **Docker Ready**: Easy deployment using Docker and Docker Compose.
- **Telegram Integration**:
    - **Notifications**: Get notified of your downloads via a Telegram bot.
    - **Provider**: Use the Telegram network for searching and downloading files.
- 🛡️ **VPN Ready**: Built-in support for Gluetun health checks and automatic port updates.
- **Retro-Style Web Interface**: A fully responsive UI with a nostalgic Windows XP feel. Includes multiple themes like Classic and Windows 11 (Experimental). Built with [Chispa](https://github.com/joecarl/chispa).

---

## Quick Start with Docker 🐳

The easiest way to get Mularr running is using Docker Compose:

```yml
services:
    mularr:
        image: ghcr.io/joecarl/mularr
        container_name: mularr
        restart: unless-stopped
        ports:
            - '8940:8940'
        volumes:
            - ./data:/app/data

    # Check docker-compose.example.yml for a full configuration guide
```

Run it with:

```bash
docker-compose up -d
```

Access the web UI at `http://localhost:8940`.

---

## Screenshots

<p align="center">
  <img src="https://games.copinstar.com/img/mularr/mularr01.png" alt="Transfers">
  <img src="https://games.copinstar.com/img/mularr/mularr02.png" alt="Settings">
</p>

---

## Integrate with Sonarr / Radarr

You can configure Mularr as both an indexer and a download client.

> [!TIP]
> In Sonarr/Radarr's configuration forms, click **Show Advanced** to reveal all required fields.

To configure as indexer use the following settings:

- **Type**: Torznab
- **API Path**: `/api/as-torznab-indexer`

To configure as download client use the following settings:

- **Type**: qBittorrent
- **URL Base**: `/api/as-qbittorrent`

---

## Authentication

Mularr separates **interactive login** (the web UI's own login page) from
**API_KEY (machine-to-machine) auth** used by the Torznab indexer and the
qBittorrent-compatible client. The two are controlled independently:

| Variable        | Purpose                                                                                                                                                                  |
| :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_USERNAME` | Username for the web UI login page. Interactive login is enabled **only when both `AUTH_USERNAME` and `AUTH_PASSWORD` are set** (non-empty).                              |
| `AUTH_PASSWORD` | Password for the web UI login page. Also accepted as the qBittorrent API password.                                                                                       |
| `API_KEY`       | Machine-to-machine key for `/api/as-torznab-indexer*` and `/api/as-qbittorrent*`. Enforced whenever it is set, independently of interactive login. Also usable as the qBittorrent API password (with any username). |
| `JWT_SECRET`    | Secret used to sign session JWTs. If unset, a random secret is generated on startup (existing sessions are invalidated on restart).                                      |

### Behavior matrix

| `AUTH_USERNAME` + `AUTH_PASSWORD` | `API_KEY` | Web UI login page | Web UI / admin API           | `/api/as-*` (M2M)        |
| :-------------------------------- | :-------- | :---------------- | :--------------------------- | :----------------------- |
| set                               | set       | shown             | requires login session       | requires `API_KEY`/session |
| set                               | unset     | shown             | requires login session       | requires login session   |
| unset                             | set       | **hidden**        | **open (no app-level gate)** | requires `API_KEY`       |
| unset                             | unset     | hidden            | open                         | open                     |

> **M2M column detail:** the two M2M surfaces differ in what they accept. The
> **Torznab indexer** (`/api/as-torznab-indexer*`) is **API-key only** — it
> rejects login-session cookies/JWTs (per the Newznab/Torznab contract). The
> **qBittorrent client** (`/api/as-qbittorrent*`) accepts either the `API_KEY`
> or a login session. In both cases, when `API_KEY` is set it is enforced.

When `AUTH_USERNAME`/`AUTH_PASSWORD` are unset, Mularr serves the web UI with no
login page or session gate, so it can run behind an external authenticating
reverse proxy / SSO (e.g. Traefik + Authelia) without a double login — while
`API_KEY` keeps the Torznab and qBittorrent endpoints protected for Sonarr/Radarr.

> [!WARNING]
> **Disabling interactive login leaves the web UI and admin API
> unauthenticated at the application level.** Anyone who can reach the port
> directly has full UI/admin access. Only run in this mode when the container
> port is **NOT published to any host** and all access is forced through a
> trusted authenticating reverse proxy. Do not expose the port directly to a
> network when interactive login is disabled.

## Tech Stack

Mularr is built primarily with TypeScript.

| Component    | Technology                                                            |
| :----------- | :-------------------------------------------------------------------- |
| **Frontend** | [Chispa](https://github.com/joecarl/chispa) + Vite                    |
| **Backend**  | Node.js + Express                                                     |
| **Database** | SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) |

---

## 💻 Development Setup

If you want to contribute or run Mularr you need docker & VS Code devcontainers.
Open the project in the devcontainer and it automatically installs the needed dependencies.

Then you can start the application in dev mode:

### 1. Backend Setup

```bash
cd backend
npm run dev
```

### 2. Frontend Setup

```bash
cd frontend
npm run dev
```

> [!WARNING]
> Do **not** run `npm install` in the root folder. Install dependencies separately in `backend/` and `frontend/`.

---

## Production Build

The included `Dockerfile` handles everything for you. It builds the frontend and bundles it with the backend for a single-image deployment.

```bash
docker build -t mularr .
```

---

## Contributing

To contribute, follow the standard process:

1. Fork the Project
2. Create your feature branch & Commit your changes
3. Open a Pull Request

Any contributions you make are **greatly appreciated**.

---

## License

MIT

---

<p align="center">
  Made with ❤️ for the P2P Community
</p>
