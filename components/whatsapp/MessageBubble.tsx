'use client';

import { useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Check, CheckCheck, ExternalLink } from 'lucide-react';
import type { ChatMessage } from '@/lib/whatsapp/engine';
import type { Property } from '@/lib/data/properties';
import PropertyCard from '@/components/shared/PropertyCard';

/** The client snapshot never changes, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

export default function MessageBubble({
  message,
  properties,
  read,
  onQuickReply,
  onViewProperty,
  disabled,
}: {
  message: ChatMessage;
  properties?: Property[];
  /** The assistant has answered this message — WhatsApp's blue double tick. */
  read?: boolean;
  onQuickReply?: (text: string) => void;
  onViewProperty?: (property: Property) => void;
  disabled?: boolean;
}) {
  const isUser = message.side === 'user';

  /*
   * `message.at` is a wall-clock stamp produced by lib/whatsapp/engine. That
   * runs once when the server renders the page and again when the browser
   * hydrates it, and the two never agree: the home page is statically
   * prerendered, so the server value is frozen at build time while the client
   * value is whatever time it is on the visitor's clock, in the visitor's
   * timezone. Rendering it straight away made React throw a hydration mismatch
   * for every visitor not in the build's timezone.
   *
   * Holding the stamp back until after mount keeps the first client render
   * identical to the server's, then shows the visitor's own time. The span is
   * inline and right-aligned, so nothing shifts when it appears.
   *
   * `useSyncExternalStore` is the way to ask "is this the client yet?": it
   * returns the server snapshot while hydrating and the client snapshot
   * immediately after, with no effect and no extra render pass.
   */
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[88%] rounded-lg px-5 py-4 sm:max-w-[78%] ${
          isUser
            ? 'bg-[#005c4b] text-[#f5f3f0]'
            : 'border border-[#1f2f1f] bg-[#1a2c1a] text-[#f5f3f0]'
        }`}
      >
        <p className="type-body wrap-break-word whitespace-pre-line leading-relaxed">
          {message.text}
        </p>

        {properties && properties.length > 0 && (
          <div className="mt-4 space-y-3">
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} onView={onViewProperty} />
            ))}
          </div>
        )}

        {/*
          * Links the assistant actually sent. They open that property's real
          * detail page on the showcase site — the same URL recorded against the
          * lead for the admin panel.
          */}
        {message.links && message.links.length > 0 && (
          <div className="mt-4 space-y-2">
            {message.links.map((link) => (
              <a
                key={link.propertyId}
                href={link.url || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded border border-[#25d366]/30 bg-[#25d366]/5 px-4 py-3 text-left transition-colors hover:border-[#25d366] hover:bg-[#25d366]/10"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#25d366]">
                    {link.name}
                  </span>
                  <span className="type-meta block truncate text-[#f5f3f0]/45">
                    {link.bhk} BHK · {link.location} · {link.priceLabel}
                  </span>
                </span>
                <ExternalLink className="h-4 w-4 flex-shrink-0 text-[#25d366]" />
              </a>
            ))}
          </div>
        )}

        {message.quickReplies && message.quickReplies.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2.5">
            {message.quickReplies.map((reply) => (
              <button
                key={reply}
                onClick={() => onQuickReply?.(reply)}
                disabled={disabled}
                className={`type-meta rounded-full border px-4 py-2.5 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                  isUser
                    ? 'border-[#f5f3f0]/20 hover:bg-[#f5f3f0]/10'
                    : 'border-[#25d366]/30 text-[#25d366] hover:border-[#25d366] hover:bg-[#25d366]/10'
                }`}
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        <div
          className={`mt-2.5 flex items-center justify-end gap-1.5 ${
            isUser ? 'text-[#f5f3f0]/50' : 'text-[#f5f3f0]/35'
          }`}
        >
          <span className="text-[11px] tabular-nums">
            {hydrated ? message.at : ''}
          </span>
          {isUser &&
            (read ? (
              <CheckCheck
                className="h-3.5 w-3.5 text-[#53bdeb]"
                aria-label="Read"
              />
            ) : (
              <Check className="h-3.5 w-3.5" aria-label="Sent" />
            ))}
        </div>
      </div>
    </motion.div>
  );
}
