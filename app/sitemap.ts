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

export const revalidate = 600;

function validDate(value: string | undefined) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [publicBooks, allSeries, categories, allTags] = await Promise.all([
    getPublicBooksLive(),
    getAllSeriesLive(),
    getCategoriesLive(),
    getAllTagsLive(),
  ]);
  const sectionRoutes = await getAllBookSectionRoutes(publicBooks);
  const staticPages = [
    "/",
    "/books",
    "/books/index",
    "/about",
    "/contact",
    "/print",
  ];

  return [
    ...staticPages.map(path => ({
      url: absoluteUrl(path),
      changeFrequency: "weekly" as const,
      priority: path === "/" ? 1 : 0.7,
    })),
    ...publicBooks.map(book => ({
      url: absoluteUrl(bookUrl(book)),
      changeFrequency: "monthly" as const,
      priority: 0.8,
      images: [absoluteUrl(coverUrl(book))],
    })),
    ...sectionRoutes.map(route => ({
      url: absoluteUrl(route.path),
      ...(validDate(route.lastModified) ? { lastModified: validDate(route.lastModified) } : {}),
      changeFrequency: "monthly" as const,
      priority: 0.62,
    })),
    ...allSeries.map(series => ({
      url: absoluteUrl(`/series/${series.slug}`),
      changeFrequency: "monthly" as const,
      priority: series.slug === "101" ? 0.9 : 0.72,
    })),
    ...categories.map(category => ({
      url: absoluteUrl(`/category/${category.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.65,
    })),
    ...allTags.map(tag => ({
      url: absoluteUrl(`/tag/${slugify(tag)}`),
      changeFrequency: "monthly" as const,
      priority: 0.52,
    })),
    ...PRINT_PRODUCTS.map(product => ({
      url: absoluteUrl(`/print/${product.slug}`),
      ...(validDate(product.generatedAt) ? { lastModified: validDate(product.generatedAt) } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
