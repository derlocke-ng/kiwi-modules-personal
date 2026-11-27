# kiwi-companion

The program behind the `companion` module: a Discord companion for one person. How to set it
up and what it does: [docs/companion.md](../docs/companion.md).

```bash
npm ci && npm test                 # the tests, no network needed
DATA_DIR=/tmp/companion AI_URL=https://ai.papaya.home AI_KEY_FILE=key npm run console   # talk to it in a terminal
podman build -t kiwi-companion -f Containerfile .
```

`bench/` holds the measurements behind the choices (chat model, hearing, speaking, the whole
voice chain).
