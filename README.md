# LocalMail

[![Docker Hub](https://img.shields.io/docker/pulls/jahuuk/localmail-app?logo=docker&label=Docker%20Hub)](https://hub.docker.com/r/jahuuk/localmail-app)

A self-hosted, Gmail-inspired email client. Connect your existing email accounts via POP3, IMAP, and SMTP — read, send, and organise your mail through a familiar web interface, without relying on any third-party cloud service. Your data never leaves your machine.

---

## Features

- **Multi-account** — Connect unlimited POP3/IMAP/SMTP accounts (Gmail, Outlook, ProtonMail Bridge, self-hosted, etc.)
- **Gmail-style UI** — Folders, labels, starring, multi-select, bulk actions, drag-and-drop, dark mode
- **Rich HTML emails** — Safely rendered HTML with inline images, plus plain text toggle
- **Compose** — Rich text editor with CC/BCC, attachments, image paste, contact autocomplete, and auto-save drafts
- **Multi-user** — Each user gets their own isolated mailbox, accounts, labels, and settings
- **Admin panel** — Manage users, reset passwords, oversee the instance
- **Email rules** — Automatically move, label, star, or mark emails on arrival
- **Custom folders** — Create folders with colour coding alongside the standard set
- **Auto-fetch** — Scheduled polling per account (5–60 min intervals)
- **Backup** — Local file download/restore and scheduled cloud backup (Amazon S3, Azure Blob, Google Cloud Storage)
- **Activity logs** — Built-in log viewer for fetch, send, backup, and error events
- **Export and print** — Download any email as a .eml file or print with a clean layout
- **Attachment previews** — Images with lightbox, inline PDF viewer, standard download for other types

### Security

- User passwords hashed with **bcrypt**
- All emails **encrypted at rest** with AES-256-CBC
- Mail account credentials (POP3/IMAP/SMTP passwords) **encrypted at rest**
- Cloud backup credentials **encrypted at rest**
- Deleted message IDs tracked to prevent re-import after permanent deletion
- Session-based authentication; sessions invalidated on logout

---

## Quick Start

### Docker (Recommended)

The easiest way to get started — no build step required. The image is published on Docker Hub at [`jahuuk/localmail-app`](https://hub.docker.com/r/jahuuk/localmail-app).

**1. Create a `docker-compose.yml`**

```yaml
services:
  localmail:
    image: jahuuk/localmail-app:latest
    container_name: localmail
    ports:
      - "5000:5000"
    volumes:
      - localmail_data:/app/data
    environment:
      - ENCRYPTION_KEY=REPLACE_WITH_OUTPUT_OF__openssl_rand_-hex_32
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=REPLACE_WITH_A_STRONG_PASSWORD
    restart: unless-stopped

volumes:
  localmail_data:
```

Replace the `ENCRYPTION_KEY` and `ADMIN_PASSWORD` values before starting. Generate a key with:

```bash
openssl rand -hex 32
```

**2. Start**

```bash
docker compose up -d
```

Open `http://localhost:5000`. Log in with the admin credentials you set above.

**3. Update to a new version**

```bash
docker compose pull
docker compose up -d
```

Data is stored in a Docker named volume (`localmail_data`) — fully self-contained inside Docker. All emails, settings, and account passwords survive updates and container restarts automatically.

---

### Docker (Build from Source)

If you want to build the image yourself from this repository:

```bash
git clone <your-repo-url> localmail
cd localmail
docker compose up -d --build
```

Open `docker-compose.yml` and replace the `ENCRYPTION_KEY` and `ADMIN_PASSWORD` placeholders before starting.

---

## HTTPS & Reverse Proxy

LocalMail runs on plain HTTP. For secure access put it behind a reverse proxy - and do not make this a public facing app as the admin portal is now fantastically mature as of yet. This is meant for personal/homelab use. I would recommend Caddy for ease of use.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | HTTP port the server listens on |
| `ENCRYPTION_KEY` | Auto-generated | **64-character hex string** used for AES-256 encryption of emails and credentials. Generate with `openssl rand -hex 32`. Stored in `data/.encryption-key` if not provided via environment. |
| `ADMIN_USERNAME` | — | Username for the admin account created on first boot. Ignored if users already exist. |
| `ADMIN_PASSWORD` | — | Password for the admin account created on first boot. Ignored if users already exist. |

---

## Data Storage

Everything lives in the `data/` directory — no external database required:

```
data/
  users.json                       # User accounts (bcrypt-hashed passwords)
  .encryption-key                  # Auto-generated key (if ENCRYPTION_KEY env not set)
  users/<user-id>/
    storage.json                   # Accounts, labels, settings, email rules, backup config
    emails/<email-id>.json         # Encrypted email files (AES-256-CBC)
    attachments/<email-id>/        # Attachment files per email
```

---

## Backup & Recovery

### Local backup (built-in)

Settings → Backup → **Download Backup** produces a `.zip` of your entire `data/` directory for your user. Restore by uploading that same file from the same panel.

### Cloud backup (built-in)

Settings → Backup → Cloud Backup supports Amazon S3, Azure Blob Storage, and Google Cloud Storage. Set a schedule (daily/weekly/monthly) or trigger manually. Backup history and one-click restore are available from the same panel. All cloud credentials are encrypted at rest.

### Manual backup

For a full-instance backup (all users):

```bash
# Docker — export the named volume while running
docker run --rm \
  -v localmail_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/localmail-backup-$(date +%F).tar.gz -C /data .

# Restore from that archive
docker run --rm \
  -v localmail_data:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/localmail-backup-<date>.tar.gz"

# Linux bare-metal — while stopped (safest)
cp -r /opt/localmail/data /backup/localmail-$(date +%F)
```

**Critical:** Always back up your `ENCRYPTION_KEY` (or `data/.encryption-key`) separately from your data. Without it, encrypted emails and account passwords cannot be decrypted.

---

## Docker Hub

The official image is published at [`jahuuk/localmail-app`](https://hub.docker.com/r/jahuuk/localmail-app).

---

## License

MIT
