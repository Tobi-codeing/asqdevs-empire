/**
 * The one place the public origin of this deployment is defined.
 *
 * Every absolute URL we hand out — property detail links inside the WhatsApp
 * conversation, canonical and OpenGraph metadata — is built from here, so the
 * domain lives in exactly one file instead of being retyped per feature.
 *
 * `NEXT_PUBLIC_SITE_URL` overrides it (Vercel previews, local dev). When it is
 * unset we fall back to the production domain rather than to localhost: a
 * missing env var used to leak `http://localhost:3000/...` into links that were
 * sent to real customers.
 */
export const PRODUCTION_SITE_URL = "https://asqdevs-empire.vercel.app";

const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

/** Origin without a trailing slash, e.g. `https://asqdevs-empire.vercel.app`. */
export const SITE_URL = (configured || PRODUCTION_SITE_URL).replace(/\/+$/, "");

/** Absolute URL for a site-relative path, e.g. `/demo/properties/dwarka-heights`. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
