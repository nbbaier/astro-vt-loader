# astro-vt-loader

An [Astro content loader](https://docs.astro.build/en/reference/content-loader-reference/) that loads [Val Town](https://val.town) vals into content collections.

## Installation

```bash
npm install astro-vt-loader
```

## Usage

Set your Val Town API token via the `VALTOWN_API_TOKEN` environment variable (in `.env` or your shell), or pass it directly via the `token` option.

```ts
// src/content.config.ts
import { defineCollection } from "astro:content";
import { valTownLoader } from "astro-vt-loader";

const vals = defineCollection({
   loader: valTownLoader({
      username: "your_username",
   }),
});

export const collections = { vals };
```

Then query vals in your Astro pages:

```astro
---
import { getCollection } from "astro:content";

const vals = await getCollection("vals");
---

{vals.map((val) => (
  <div>
    <h2>{val.data.name}</h2>
    <p>{val.data.description}</p>
    <a href={val.data.url}>View on Val Town</a>
  </div>
))}
```

## Configuration

| Option        | Type               | Description                                                                                                         |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `token`       | `string`           | Val Town API token. Falls back to `VALTOWN_API_TOKEN` env var.                                                      |
| `username`    | `string`           | Filter vals by username. Without it, returns the authenticated user's vals.                                         |
| `privacy`     | `string`           | Filter by privacy level: `"public"`, `"unlisted"`, or `"private"`.                                                  |
| `limit`       | `number`           | Max number of vals to fetch (must be ≥ 1). Defaults to all.                                                         |
| `files`       | `string`           | `"none"` (default), `"list"`, or `"content"` — how much file data to fetch; `"content"` implies the list.             |
| `filter`      | `(val) => boolean` | Keep only matching vals; runs before file fetching. Applied after `limit`, so fewer entries than `limit` may result. |
| `concurrency` | `number`           | Max concurrent file-content fetches. Defaults to `6`.                                                               |

## Entry Schema

Each val entry includes:

- `name` — Val name
- `createdAt` — Creation date
- `privacy` — `"public"` | `"unlisted"` | `"private"`
- `author` — `{ type, id, username }`
- `imageUrl` — Val image URL (nullable)
- `description` — Val description (nullable)
- `url` — Link to the val on Val Town
- `files` — Always an array; empty unless `files: "list"` or `files: "content"` is set. File objects include `name`, `path`, `type`, `url`, `moduleUrl` (nullable), `endpointUrl` (nullable), and `content` (nullable — populated only in `"content"` mode, and `null` when the file was not found)

## License

MIT
