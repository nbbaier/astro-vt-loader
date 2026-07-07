import { defineCollection } from "astro:content";
import { valTownLoader } from "astro-vt-loader";

const vals = defineCollection({
	loader: valTownLoader({
		username: "nbbaier",
		privacy: "public",
		limit: 10,
	}),
});

export const collections = { vals };
