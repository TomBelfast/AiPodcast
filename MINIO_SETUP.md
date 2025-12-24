# MinIO Configuration Guide

## Current Setup

- **API Endpoint (external)**: `minio2-api.aihub.ovh:443` (via Nginx proxy)
- **Internal Port**: `9002`
- **Web UI**: `minio2.aihub.ovh:9001`
- **Bucket**: `podcast` (public access)

## Credentials

```
Access Key: pCOXBmaClb0iC75cPPLg
Secret Key: YwGEUXhQkVXwxbXDbpXJti3GoRYNTeES3Gp4yo1x
```

## Environment Variables

Add to `.env`:

```env
MINIO_ENDPOINT=minio2-api.aihub.ovh
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=pCOXBmaClb0iC75cPPLg
MINIO_SECRET_KEY=YwGEUXhQkVXwxbXDbpXJti3GoRYNTeES3Gp4yo1x
MINIO_BUCKET_NAME=podcast
```

## Troubleshooting

If connection fails with "Access Key Id you provided does not exist":

1. **Verify credentials** in MinIO web UI: `https://minio2.aihub.ovh:9001`
   - Make sure Access Key and Secret Key are copied exactly (no extra spaces)
2. **Check Nginx configuration** - ensure it properly proxies to port 9002
   - Nginx should forward requests from `minio2-api.aihub.ovh:443` to `192.168.0.4:9002`
   - May need to configure proper headers for S3 API
3. **Test from server** - If app runs on same server as MinIO, try direct connection:
   ```env
   MINIO_ENDPOINT=192.168.0.4
   MINIO_PORT=9002
   MINIO_USE_SSL=false
   ```
4. **Check if credentials are active** - In MinIO UI, verify the access key is enabled
5. **Verify bucket exists** and has public read policy
6. **Try different endpoint** - Some Nginx configs may require different path or subdomain

## Testing

Run the test script:
```bash
node test-minio.js
```

Or use the API endpoint (when server is running):
```
GET http://localhost:3000/api/webhook/test-minio?accessKey=pCOX%20BmaCIb0iC75c%20PPLg&secretKey=YwGEUXhQk%20V%20XwxbXDbpXJti3GoRYNTeES3Gp4yo1x
```

## Notes

- Nginx proxies external `minio2-api.aihub.ovh:443` to internal `192.168.0.4:9002`
- Access keys may contain spaces - ensure they're copied exactly
- Public bucket allows direct file access via URLs

