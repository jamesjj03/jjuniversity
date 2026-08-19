import type { MetadataRoute } from "next";
import {
  absoluteUrl,
  bookUrl,
  coverUrl,
  getAllSeriesLive,
  getAllTagsLive,
  getCategoriesLive,
  getPublicBooksLive,
  PRINT_PRODUCTS,
  slugify,
} from "@/lib/publishing";
import { getAllBookSectionRoutes } from "@/lib/bookSectionRoutes";
import siteConfig from "@/public/site.json";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const sectionRoutes = await getAllBookSectionRoutes();
  const [publicBooks, allSeries, categories, allTags] = await Promise.all([
    getPublicBooksLive(),
    getAllSeriesLive(),
    getCategoriesLive(),
    getAllTagsLive(),
  ]);
  const staticPages = [
    "/",
    "/books",
    "/about",
    "/contact",
    "/print",
  ];
  const fiberVisible = Boolean((siteConfig as { fiber?: { visible?: boolean } }).fiber?.visible);

  return [
    ...staticPages.map(path => ({
      url: absoluteUrl(path),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: path === "/" ? 1 : 0.7,
    })),
    ...(fiberVisible ? [{
      url: absoluteUrl("/fiber"),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.2,
    }] : []),
    ...publicBooks.map(book => ({
      url: absoluteUrl(bookUrl(book)),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
      images: [absoluteUrl(coverUrl(book))],
    })),
    ...sectionRoutes.map(route => ({
      url: absoluteUrl(route.path),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.62,
    })),
    ...allSeries.map(series => ({
      url: absoluteUrl(`/series/${series.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: series.slug === "101" ? 0.9 : 0.72,
    })),
    ...categories.map(category => ({
      url: absoluteUrl(`/category/${category.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.65,
    })),
    ...allTags.map(tag => ({
      url: absoluteUrl(`/tag/${slugify(tag)}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.52,
    })),
    ...PRINT_PRODUCTS.map(product => ({
      url: absoluteUrl(`/print/${product.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
