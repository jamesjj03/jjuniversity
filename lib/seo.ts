import type { Metadata } from "next";
import { absoluteUrl, coverUrl, metadataDescription, type PublishedBook } from "@/lib/publishing";

export const SITE_NAME = "JJ University";
export const DEFAULT_DESCRIPTION = "Read free short books on science, history, religion, psychology, power, money, and everything in between.";
export const DEFAULT_OG_IMAGE = "/branding/jju-logo.png";

type SeoOptions = {
  title: string;
  description?: string;
  path: string;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article" | "book";
  noIndex?: boolean;
};

export function pageMetadata({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  image = DEFAULT_OG_IMAGE,
  imageAlt = SITE_NAME,
  type = "website",
  noIndex = false,
}: SeoOptions): Metadata {
  const cleanDescription = metadataDescription(description, DEFAULT_DESCRIPTION);
  const url = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);

  return {
    title,
    description: cleanDescription,
    alternates: {
      canonical: path,
    },
    robots: noIndex ? { index: false, follow: true } : undefined,
    openGraph: {
      title,
      description: cleanDescription,
      url,
      siteName: SITE_NAME,
      type,
      images: [{ url: imageUrl, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: cleanDescription,
      images: [imageUrl],
    },
  };
}

export function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    logo: absoluteUrl(DEFAULT_OG_IMAGE),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: DEFAULT_DESCRIPTION,
    publisher: organizationJsonLd(),
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function bookJsonLd(book: PublishedBook, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Book",
    name: book.title,
    headline: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
    author: {
      "@type": "Person",
      name: book.creator || "James Johnson",
    },
    url: absoluteUrl(path),
    mainEntityOfPage: absoluteUrl(path),
    image: absoluteUrl(coverUrl(book)),
    description: metadataDescription(book.description),
    inLanguage: "en",
    isAccessibleForFree: true,
    publisher: organizationJsonLd(),
    keywords: book.tags.join(", "),
  };
}
