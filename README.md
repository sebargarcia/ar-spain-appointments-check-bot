# Passport Check

A [Cloudflare Worker](https://developers.cloudflare.com/workers/) that checks Spanish passport and consular appointment availability (Buenos Aires / CGE and [citaconsular.es](https://www.citaconsular.es)) and notifies you via Telegram.

## Features

- **Cron job** (hourly): Checks [citaconsular.es](https://www.citaconsular.es) for available appointments and sends a Telegram message when slots are open.
- **Telegram bot**: Responds to commands via a webhook:
  - `/consultarcita` — Check citaconsular.es availability on demand.
  - `/consultar` — Get CGE Buenos Aires passport renewal dates from [cgeonline.com.ar](https://www.cgeonline.com.ar/informacion/apertura-de-citas.html).

## Setup

### Prerequisites

- Node.js
- A [Cloudflare](https://dash.cloudflare.com/) account
- A [Telegram](https://telegram.org/) bot (create via [@BotFather](https://t.me/BotFather)) and its chat ID for notifications

### Install

```bash
npm install
```

### Secrets (required for deploy)

Set your Telegram credentials as [Wrangler secrets](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets) so they are never stored in code or config:

```bash
npx wrangler secret put TELEGRAM_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

`TELEGRAM_CHAT_ID` can be a single chat ID or a comma-separated list (e.g. `123456789,987654321`) to notify multiple chats when the cron finds available appointments.

For local development, you can use a `.env` file (ensure it’s in `.gitignore`) or pass env via `wrangler dev`; see [Wrangler docs](https://developers.cloudflare.com/workers/wrangler/configuration/#local-development) for local vars.

### Telegram webhook

After deploying, register your worker URL as the bot’s webhook so it receives updates:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_WORKER_SUBDOMAIN>.workers.dev/webhooks/telegram"
```

## Scripts

| Command     | Description                    |
|------------|--------------------------------|
| `npm run dev`   | Start local dev server (Wrangler) |
| `npm run deploy`| Deploy worker to Cloudflare       |

## Configuration

- **Cron**: Defined in `wrangler.toml`; default is every hour (`0 * * * *`). Adjust the [cron expression](https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/) as needed.

## Tech stack

- TypeScript
- [Cloudflare Workers](https://workers.cloudflare.com/) + [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- [cheerio](https://github.com/cheeriojs/cheerio) for HTML parsing
- Telegram Bot API
