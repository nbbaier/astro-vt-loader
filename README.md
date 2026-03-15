# astro-valtown-loader

An [Astro content loader](https://docs.astro.build/en/reference/content-loader-reference/) that loads [Val Town](https://val.town) vals into content collections.

## Installation

```bash
npm install astro-valtown-loader
```

## Usage

```ts
// src/content.config.ts
import { defineCollection } from "astro:content";
import { valTownLoader } from "astro-valtown-loader";

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

| Option     | Type     | Description                                                                  |
| ---------- | -------- | ---------------------------------------------------------------------------- |
| `token`    | `string` | Val Town API token. Falls back to `VALTOWN_API_TOKEN` env var.               |
| `username` | `string` | Filter vals by username. Without it, returns the authenticated user's vals.   |
| `privacy`  | `string` | Filter by privacy level: `"public"`, `"unlisted"`, or `"private"`.           |
| `limit`    | `number` | Max number of vals to fetch. Defaults to all.                                |

## Entry Schema

Each val entry includes:

- `name` — Val name
- `createdAt` — Creation date
- `privacy` — `"public"` | `"unlisted"` | `"private"`
- `author` — `{ type, id, username }`
- `imageUrl` — Val image URL (nullable)
- `description` — Val description (nullable)
- `url` — Link to the val on Val Town
- `files` — Array of file objects with `name`, `path`, `type`, `url`, `moduleUrl`, `endpointUrl`, and `content`

## License

MIT
