"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { applyCoverPalette } from "@/lib/coverPalette";

type CoverImageProps = Omit<ImageProps, "src" | "alt" | "width" | "height" | "onError" | "onLoad"> & {
  src: string;
  fallbackSrc?: string;
  alt: string;
  width?: number;
  height?: number;
  palette?: boolean;
};

export default function CoverImage({
  src,
  fallbackSrc,
  alt,
  width = 180,
  height = 270,
  sizes = "(max-width: 720px) 36vw, 180px",
  palette = false,
  ...props
}: CoverImageProps) {
  const [fallbackState, setFallbackState] = useState({ source: src, stage: 0 });
  const stage = fallbackState.source === src ? fallbackState.stage : 0;
  const currentSrc = stage === 0 ? src : stage === 1 && fallbackSrc ? fallbackSrc : "/file.svg";

  return (
    <Image
      {...props}
      src={currentSrc}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      unoptimized
      onError={() => {
        setFallbackState(current => {
          const currentStage = current.source === src ? current.stage : 0;
          if (fallbackSrc && currentStage === 0) return { source: src, stage: 1 };
          if (currentStage < 2) return { source: src, stage: 2 };
          return current;
        });
      }}
      onLoad={event => {
        if (palette) applyCoverPalette(event.currentTarget);
      }}
    />
  );
}
