"use client";

import { useState } from "react";
import Image from "next/image";

type Props = {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** 1.75 is the project spec's 16:10 default for full-bleed captures. */
  quality?: number;
};

/**
 * A real screenshot from one of the live project websites.
 *
 * These are actual captures (see scripts/capture-portfolio.mjs), so there is no
 * placeholder state: the image either renders or, if a file is ever missing, the
 * card falls back to a plain dark panel rather than a broken image box.
 */
export default function ProjectMedia({
  src,
  alt,
  className = "",
  sizes = "100vw",
  priority,
  quality = 82,
}: Props) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`relative overflow-hidden bg-[#101010] ${className}`}
    >
      {failed ? (
        <span className="sr-only">{alt}</span>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          quality={quality}
          priority={priority}
          // Portfolio imagery sits well below the fold, so it is deferred and
          // decoded off the main thread to keep first paint cheap.
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="object-cover object-top transition-transform duration-[1.2s] ease-out group-hover:scale-[1.03]"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
