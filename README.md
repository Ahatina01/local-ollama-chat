# Local Ollama Chat

A lightweight, local-only browser chat for Ollama. It streams responses, lists installed models, and stores conversations in a local JSON file. It uses only Node.js built-ins and makes no cloud API calls.

## Run on Windows

1. Install Node.js 18 or newer and Ollama.
2. If Ollama is already available on your `PATH`, double-click `Запустить Ollama чат.bat`.
3. For a custom Ollama installation, copy `config.example.json` to `config.local.json` and set `ollamaExe` and `modelsDirectory` to your local paths. This private config is ignored by Git.
4. The launcher opens `http://127.0.0.1:4173`. If Ollama is not already running, it starts `ollama serve` with `OLLAMA_NO_CLOUD=1` and binds it to `127.0.0.1:11434`.

The app reads installed models from Ollama's `/api/tags`, forwards streaming requests to `/api/chat`, and saves chat history in `history.json` beside the app. Both `config.local.json` and `history.json` are excluded from Git.

## Development

```sh
npm test
npm start
```

The server has no external package dependencies. It listens on loopback only.

