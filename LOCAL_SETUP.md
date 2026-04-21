# Local Setup — Running OHIF with Your Own DICOM Studies

This guide covers running the viewer locally against a local Orthanc server so you can upload and view your own `.dcm` files.

## Architecture

```
Browser (localhost:3000)  ──►  OHIF dev server (yarn dev)
        │
        └──►  localhost:8043  ──►  Nginx CORS proxy  ──►  localhost:8042 (Orthanc + DICOMweb plugin)
```

Orthanc doesn't handle CORS preflight (`OPTIONS`) requests itself, so nginx sits in front on port `8043` to add the CORS headers. The OHIF config points at port `8043`, not `8042`.

---

## One-time setup

### 1. Start Orthanc (DICOM server)

```bash
docker run -d -p 4242:4242 -p 8042:8042 \
  -e ORTHANC__AUTHENTICATION_ENABLED=false \
  -e ORTHANC__REMOTE_ACCESS_ALLOWED=true \
  -e ORTHANC__DICOM_WEB__ENABLE=true \
  -e ORTHANC__DICOM_WEB__ROOT=/dicom-web/ \
  --name orthanc-ohif \
  orthancteam/orthanc
```

Verify: `curl http://localhost:8042/dicom-web/studies` → should return `[]`.

### 2. Start the Nginx CORS proxy

The config lives at `/tmp/nginx-orthanc.conf`. If it's missing, recreate it:

```nginx
# /tmp/nginx-orthanc.conf
server {
    listen 8043;
    server_name localhost;

    location / {
        if ($request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Origin, Accept, Content-Type, Authorization, Accept-Encoding, X-Requested-With' always;
            add_header 'Access-Control-Max-Age' 1728000 always;
            add_header 'Content-Length' 0;
            add_header 'Content-Type' 'text/plain charset=UTF-8';
            return 204;
        }
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Origin, Accept, Content-Type, Authorization, Accept-Encoding, X-Requested-With' always;
        add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range' always;

        proxy_pass http://host.docker.internal:8042/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        client_max_body_size 0;
    }
}
```

Run it:

```bash
docker run -d --name orthanc-cors-proxy -p 8043:8043 \
  -v /tmp/nginx-orthanc.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
```

Verify CORS preflight works:

```bash
curl -i -X OPTIONS -H "Origin: http://localhost:3000" \
     -H "Access-Control-Request-Method: GET" \
     http://localhost:8043/dicom-web/studies
# → HTTP/1.1 204 No Content with Access-Control-Allow-Origin: *
```

### 3. Configure OHIF

`platform/app/.env`:

```
PUBLIC_URL=/
APP_CONFIG=config/local_orthanc.js
USE_HASH_ROUTER=false
```

`platform/app/public/config/local_orthanc.js` — the three URLs must point at the nginx proxy (`:8043`), not Orthanc directly (`:8042`):

```js
wadoUriRoot: 'http://localhost:8043/dicom-web',
qidoRoot:    'http://localhost:8043/dicom-web',
wadoRoot:    'http://localhost:8043/dicom-web',
```

### 4. Run the viewer

```bash
cd platform/app
yarn dev
```

Open `http://localhost:3000`.

---

## Adding DICOM files

### Option A — Orthanc web UI (easiest)

1. Open `http://localhost:8042/app/explorer.html`
2. Click **Upload** (top right)
3. Drag `.dcm` files onto the page
4. Click **Start the upload**
5. Reload `http://localhost:3000` — your study appears in the list

### Option B — curl

```bash
curl -X POST http://localhost:8042/instances \
  --data-binary "@/path/to/your/file.dcm"
```

Upload a whole folder:

```bash
find /path/to/dicom-folder -name "*.dcm" -exec \
  curl -X POST http://localhost:8042/instances --data-binary "@{}" \;
```

### Where to get sample DICOM files

- **In this repo:** `node_modules/dicomweb-client/testData/sample.dcm`
- **Rubo Medical:** http://www.rubomedical.com/dicom_files/ (single-file samples)
- **Orthanc samples:** https://www.orthanc-server.com/static.php?page=downloads
- **TCIA (The Cancer Imaging Archive):** https://www.cancerimagingarchive.net/ (large public datasets)

---

## Daily workflow

Containers persist across reboots unless you `docker rm` them. To resume:

```bash
docker start orthanc-ohif orthanc-cors-proxy
cd platform/app && yarn dev
```

To stop everything:

```bash
docker stop orthanc-ohif orthanc-cors-proxy
# Ctrl+C the yarn dev process
```

**Note:** Orthanc data lives inside the container's filesystem. If you `docker rm orthanc-ohif`, all uploaded studies are lost. For persistent storage, add `-v orthanc-data:/var/lib/orthanc/db` to the `docker run` command.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Data Source Connection Error" in viewer | Orthanc or nginx proxy not running | `docker ps` — both `orthanc-ohif` and `orthanc-cors-proxy` should be listed. Start them if not. |
| `curl http://localhost:8042/dicom-web/studies` returns 404 | DICOMweb plugin not loaded | Make sure you used the `orthancteam/orthanc` image with `ORTHANC__DICOM_WEB__ENABLE=true` |
| `curl http://localhost:8042/dicom-web/studies` returns 401 | Auth is enabled | Recreate container with `ORTHANC__AUTHENTICATION_ENABLED=false` |
| Browser console shows CORS error | OHIF is hitting `:8042` directly instead of `:8043` | Check the three `*Root` URLs in `local_orthanc.js` point to `:8043` |
| `yarn dev` fails with "unable to locate config" | `.env` line got corrupted | `APP_CONFIG` should be just the path — no `yarn dev` appended |
| Uploaded study doesn't appear in viewer | Browser cached old state | Hard reload (Cmd+Shift+R) |
