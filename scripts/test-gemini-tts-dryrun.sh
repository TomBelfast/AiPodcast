#!/usr/bin/env bash

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3300}"

curl -sS "${APP_URL}/api/text-to-speech" \
  -H 'Content-Type: application/json' \
  -X POST \
  -d '{
    "provider": "gemini",
    "dryRun": true,
    "inputs": [
      {
        "text": "Jo Ci godom, to może być niezły trzeci operator.",
        "voiceId": "Charon"
      },
      {
        "text": "Hej Antoni, najpierw to sprawdźmy na sucho, potem bedzie przełączanie.",
        "voiceId": "Kore"
      }
    ]
  }'
