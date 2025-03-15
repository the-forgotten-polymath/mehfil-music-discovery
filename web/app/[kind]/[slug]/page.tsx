import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { CollectionView } from "@/components/collection-view";
import { FACET_BY_KIND, KIND_BY_FACET, KIND_LABEL, resolveSlug, slugify } from "@/lib/routes";

type RawCatalogue = { facets: Record<string, string[]> };

// Read once and reused by both generateStaticParams and generateMetadata,
// which would otherwise each parse the same multi-thousand-entry JSON file
// for every one of the hundreds of collection routes built.
let cachedCatalogue: RawCatalogue | null = null;
function loadCatalogue(): RawCatalogue {
  if (!cachedCatalogue) {
    cachedCatalogue = JSON.parse(
      readFileSync(join(process.cwd(), "public", "catalogue.json"), "utf-8")
    ) as RawCatalogue;
  }
  return cachedCatalogue;
}

/**
 * Server shell for the collection routes.
 *
 * Exists purely so `generateStaticParams` can prerender every collection.
 * Without it these routes render per request, which Turbopack's dev server
 * cannot do for this dependency graph — it throws "require is not defined"
 * and every station, artist and film 500s locally.
 *
 * Prerendering is also the honest fit: the pages are client-rendered from a
 * cached catalogue, so a server render produces nothing a static shell does
 * not already give.
 */
export function generateStaticParams() {
  // The exported catalogue is the source of truth for what exists.
  const catalogue = loadCatalogue();

  const params: { kind: string; slug: string }[] = [];
  const seen = new Set<string>();

  for (const [facet, kind] of Object.entries(KIND_BY_FACET)) {
    for (const label of catalogue.facets[facet] ?? []) {
      const slug = slugify(label);
      // Slugs are lossy, so two labels can collapse to one route. The view
      // resolves to the first match either way; a duplicate param would just
      // fail the build.
      const key = `${kind}/${slug}`;
      if (!slug || seen.has(key)) continue;
      seen.add(key);
      params.push({ kind, slug });
    }
  }
  return params;
}

/**
 * Per-collection title and description.
 *
 * The client view resolves the same slug for its own render, but metadata is
 * read by crawlers that never run the client bundle, so the label has to be
 * resolved again here rather than borrowed from CollectionView's state. An
 * unresolvable kind or slug returns nothing rather than throwing: the page
 * itself calls notFound() for that case, and metadata for a 404 should just
 * fall back to the root default rather than fail the render.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}): Promise<Metadata> {
  const { kind, slug } = await params;
  const facet = FACET_BY_KIND[kind];
  if (!facet) return {};

  const catalogue = loadCatalogue();
  const labels = catalogue.facets[facet] ?? [];
  const index = resolveSlug(labels, slug);
  if (index < 0) return {};

  const label = labels[index];
  const kindLabel = KIND_LABEL[kind] ?? "Collection";
  return {
    title: label,
    description: `${kindLabel} · every ${label} song in the Mehfil catalogue, ready to play or shuffle.`,
  };
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind, slug } = await params;
  return <CollectionView kind={kind} slug={slug} />;
}
