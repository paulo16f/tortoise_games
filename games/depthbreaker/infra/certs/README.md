# TLS certificates (local dev)

No certificates are committed. nginx expects `cert.pem` and `key.pem` in this
directory.

## Recommended: mkcert (trusted by your browser)

```powershell
# https://github.com/FiloSottile/mkcert
mkcert -install
mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1
```

## Alternative: openssl self-signed (browser will warn)

```powershell
openssl req -x509 -newkey rsa:2048 -nodes -days 365 `
  -keyout key.pem -out cert.pem -subj "/CN=localhost"
```

## Production

Terminate with real certificates (Let's Encrypt / your provider) on the
reverse proxy or an upstream load balancer. Never bake certificates into the
Unity build — Bayou stays on plain `ws://` behind the proxy (design decision
D3 in `docs/DEPTHBREAKER_TECHNICAL_DESIGN.md`).

Reminder: pages served over https can only open `wss://` — a missing/invalid
cert here is the most common "works in editor, fails in browser" failure.
