'use client';

import type { Property } from '@/lib/data/properties';

export default function PropertyCard({
  property,
  onView,
  compact = false,
}: {
  property: Property;
  onView?: (property: Property) => void;
  compact?: boolean;
}) {
  const monogram = property.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');

  return (
    <div className="border border-[#2f2f2f] bg-[#141414] p-4">
      <div className="flex items-start gap-4">
        <div
          aria-hidden
          className="flex h-14 w-14 flex-shrink-0 items-center justify-center border border-[#2f2f2f] bg-[#0b0b0b] text-sm font-medium tracking-wide text-[#c6ad78]/70"
        >
          {monogram}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-base font-medium">{property.name}</p>
            <p className="flex-shrink-0 text-base text-[#c6ad78]">{property.priceLabel}</p>
          </div>
          <p className="type-meta mt-1 text-[#f5f3f0]/50">
            {property.bhk} BHK {property.kind} · {property.location}
          </p>
          <p className="type-meta mt-0.5 text-[#f5f3f0]/35">
            {property.furnishing} · {property.availability}
          </p>
        </div>
      </div>

      {!compact && (
        <p className="type-meta mt-3 leading-relaxed text-[#f5f3f0]/55">{property.summary}</p>
      )}

      {onView && (
        <button
          onClick={() => onView(property)}
          className="type-meta mt-3.5 w-full border border-[#2f2f2f] py-2.5 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
        >
          View property
        </button>
      )}
    </div>
  );
}
