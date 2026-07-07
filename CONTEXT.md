# Ubiquitous Language

| Term | Definition |
|------|-----------|
| Val | The primary code artifact in Val Town. Has metadata (name, privacy, author, description) and zero or more files. Identified by a unique ID. |
| File | A source file belonging to a val. Has a name, path, type, URLs (html, module, endpoint), and optionally content (the raw source text). |
| Loader | An Astro content loader: a plugin that fetches external data and populates an Astro content collection store. |
| Entry | A single item in an Astro content collection. Each val becomes one entry, keyed by its Val Town ID. |
| Filter | A user-supplied predicate that runs against val metadata before file fetching, determining which vals enter the collection. |
