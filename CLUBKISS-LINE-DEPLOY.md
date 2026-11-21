# CLUB KISS LINE notification Worker

Cloudflare Worker: `clubkiss-line-notify`

Worker entry point: `clubkiss-line-worker.js`

Deployment configuration: `wrangler.toml`

Required Cloudflare secrets: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `STAFF_PIN`.

Required KV binding: `KISS_DATA`.

LINE webhook URL: `https://clubkiss-line-notify.kurousagiseira.workers.dev/webhook`

This deployment is separate from the inventory GitHub Pages site. Do not modify `index.html` for LINE notifications.
