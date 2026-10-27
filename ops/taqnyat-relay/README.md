# Taqnyat SMS relay

Production (Vercel) has no fixed outgoing IP, and Taqnyat sends only from IPs marked
«مصرح به» in its portal (Security settings). This relay runs on a host with a FIXED
IP; the site posts each SMS here, the relay forwards it to Taqnyat.

`index.php` is Taqnyat's own middleware with four changes: a shared key, POST only,
no CORS, timeouts. It stores nothing — the token arrives with each request.

**Production uses a static-IP proxy service instead (Fixie, `TAQNYAT_PROXY_URL`)** —
nothing to host, and the call stays encrypted end to end. This relay is the fallback
for when you have your own fixed-IP PHP host.

## Set up

1. A host with a fixed public IP that runs PHP 7.4+ with the curl extension (a small
   VPS or PHP hosting), served over **HTTPS**.
2. Put `index.php` in a folder of its own, e.g. `https://sms.example.sa/relay/`.
3. Make a long random key (`openssl rand -hex 32`) and give it to the relay:
   the `TAQNYAT_RELAY_KEY` environment variable, or a file `relay-key.php` one folder
   ABOVE the web root containing only `<?php return '<the key>';`
4. In the Taqnyat portal → الإعدادات الأمنية, add the host's IP and set it to «مصرح به».
5. In Vercel → Settings → Environment Variables (Production):
   - `TAQNYAT_BEARER_TOKEN` — the key from Taqnyat → المطورين → التطبيقات
   - `TAQNYAT_SENDER` — the approved sender name, exactly as in «الأسماء»
   - `TAQNYAT_RELAY_URL` — the relay's https address
   - `TAQNYAT_RELAY_KEY` — the same key as step 3

   then redeploy. With `TAQNYAT_RELAY_URL` set but its key missing or short, the
   site treats Taqnyat as not configured rather than calling Taqnyat directly.

## Check it

`curl -X POST https://<relay>/ -H 'X-Relay-Key: wrong' -d '{}'` must answer 401;
a GET must answer 405. Then send yourself a code from the supplier phone login.
