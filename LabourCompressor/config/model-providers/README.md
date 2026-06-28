## Model Provider Local Config

Use this folder for local multimodal model credentials.

Files:
- `providers.template.json`: full structure reference
- `providers.local.json`: paste real local credentials here

Rules:
- Keep `providers.local.json` local-only.
- Fill only the providers you plan to use now.
- For `api-key` mode, paste `apiKey`.
- For `oauth` mode, paste `clientId`, `redirectUri`, and optionally `authorizeUrl` and `scope`.
- Current Gemini video integration in this project uses `api-key` mode only.
- Web UI displays curated video model choices and maps them internally to provider/model ids.

Current curated video model choices:
- `Qwen3.7Plus` → `qwen3.7-plus`
- `Qwen3.6Flash` → `qwen3.6-flash`
- `Gemini 3.5 Flash` → `gemini-3.5-flash`

Current supported providers:
- `openai`
- `google`
- `anthropic`
- `qwen`
- `zhipu`
- `deepseek`
- `moonshot`
- `baidu`
- `tencent-hunyuan`
- `minimax`

Validation examples:

```bash
node apps/cli/main.ts validate-model-config \
  --provider qwen \
  --auth-mode api-key \
  --model-name qwen3.7-plus \
  --api-key 'paste-your-key'
```

```bash
node apps/cli/main.ts build-oauth-link \
  --provider google \
  --authorize-url 'https://accounts.google.com/o/oauth2/v2/auth' \
  --client-id 'paste-client-id' \
  --redirect-uri 'http://127.0.0.1:8787/callback' \
  --state 'local-test' \
  --scope 'openid,email,profile'
```
