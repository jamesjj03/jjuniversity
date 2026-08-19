"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./SiteV2.module.css";

export default function SiteV2Cover({
  src,
  fallbackSrc = "/branding/jju-logo.png",
  alt,
  priority = false,
  sizes = "(max-width: 560px) 74vw, (max-width: 980px) 40vw, 280px",
}: {
  src: string;
  fallbackSrc?: string;
  alt: string;
  priority?: boolean;
  sizes?: string;
}) {
  const [imageSrc, setImageSrc] = useState(src || fallbackSrc);

  return (
    <Image
      className={styles.coverImage}
      src={imageSrc}
      alt={alt}
      fill
      unoptimized={imageSrc.endsWith(".svg") || imageSrc.startsWith("/covers/")}
      loading={priority ? "eager" : "lazy"}
      sizes={sizes}
      onError={() => {
        if (imageSrc !== fallbackSrc) {
          setImageSrc(fallbackSrc);
        } else if (imageSrc !== "/file.svg") {
          setImageSrc("/file.svg");
        }
      }}
    />
  );
}
