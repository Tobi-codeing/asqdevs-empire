"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ImagePlus,
  LogOut,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { StoredProperty } from "@/lib/data/store";
import type { StoredLead } from "@/lib/leads/store";

const KINDS = ["Apartment", "Villa", "Studio", "Penthouse", "Builder Floor"];
const FURNISHINGS = ["Unfurnished", "Semi-furnished", "Furnished"];
const STATUSES = ["active", "inactive", "sold"];

type Draft = {
  id?: string;
  name: string;
  location: string;
  city: string;
  kind: string;
  bhk: string;
  price: string;
  status: string;
  furnishing: string;
  availability: string;
  amenities: string;
  description: string;
  summary: string;
  images: string[];
};

const emptyDraft = (): Draft => ({
  name: "",
  location: "",
  city: "",
  kind: "Apartment",
  bhk: "2",
  price: "",
  status: "active",
  furnishing: "Semi-furnished",
  availability: "Ready to move",
  amenities: "",
  description: "",
  summary: "",
  images: [],
});

const draftFrom = (property: StoredProperty): Draft => ({
  id: property.id,
  name: property.name,
  location: property.location,
  city: property.city,
  kind: property.kind,
  bhk: String(property.bhk),
  price: property.priceLabel || String(property.price),
  status: property.status,
  furnishing: property.furnishing,
  availability: property.availability,
  amenities: property.amenities.join(", "),
  description: property.description,
  summary: property.summary,
  images: property.gallery.map((image) => image.src),
});

type ConsoleData = {
  unauthorized?: true;
  properties: StoredProperty[];
  leads: StoredLead[];
};

/** One read of everything the console shows. No React state — safe to reuse. */
async function loadConsole(): Promise<ConsoleData> {
  const propsRes = await fetch("/api/admin/properties", { cache: "no-store" });
  if (propsRes.status === 401) {
    return { unauthorized: true, properties: [], leads: [] };
  }
  const propsData = (await propsRes.json().catch(() => ({}))) as {
    properties?: StoredProperty[];
  };
  const leadsRes = await fetch("/api/admin/leads", { cache: "no-store" });
  const leadsData = (leadsRes.ok ? await leadsRes.json().catch(() => ({})) : {}) as {
    leads?: StoredLead[];
  };
  return {
    properties: propsData.properties ?? [],
    leads: leadsData.leads ?? [],
  };
}

const statusTone: Record<string, string> = {
  active: "border-[#25d366]/40 text-[#25d366]",
  inactive: "border-[#f5f3f0]/25 text-[#f5f3f0]/50",
  sold: "border-[#e08d6b]/40 text-[#e08d6b]",
};

export default function AdminConsole({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<"inventory" | "leads">("inventory");
  const [properties, setProperties] = useState<StoredProperty[]>([]);
  const [leads, setLeads] = useState<StoredLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StoredProperty | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [notice, setNotice] = useState<string>();

  const apply = useCallback(
    (data: ConsoleData) => {
      if (data.unauthorized) {
        onLogout();
        return;
      }
      setProperties(data.properties);
      setLeads(data.leads);
    },
    [onLogout],
  );

  useEffect(() => {
    let alive = true;
    loadConsole()
      .then((data) => {
        if (alive) apply(data);
      })
      .catch(() => {
        if (alive) setError("Couldn't load the console. Please retry.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [apply]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return properties;
    return properties.filter((property) =>
      [property.name, property.location, property.city, `${property.bhk} bhk`]
        .join(" ")
        .toLowerCase()
        .includes(value),
    );
  }, [properties, query]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !draft) return;
    setUploading(true);
    setError(undefined);
    try {
      const form = new FormData();
      Array.from(files)
        .slice(0, 5)
        .forEach((file) => form.append("files", file));
      const response = await fetch("/api/admin/upload", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as {
        urls?: string[];
        detail?: string;
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.urls)) {
        setError(data.detail ?? "Those images couldn't be uploaded.");
        return;
      }
      setDraft((current) =>
        current
          ? { ...current, images: [...current.images, ...data.urls!].slice(0, 5) }
          : current,
      );
    } catch {
      setError("Those images couldn't be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const body = {
        name: draft.name,
        location: draft.location,
        city: draft.city || draft.location,
        kind: draft.kind,
        bhk: draft.bhk,
        price: draft.price,
        status: draft.status,
        furnishing: draft.furnishing,
        availability: draft.availability,
        amenities: draft.amenities,
        description: draft.description,
        summary: draft.summary,
        images: draft.images,
      };
      const response = await fetch(
        draft.id ? `/api/admin/properties/${draft.id}` : "/api/admin/properties",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(validateMessage(data.error));
        return;
      }
      setDraft(null);
      setNotice(
        draft.id
          ? "Property updated — live for WhatsApp, phone and the site."
          : "Property added — now in the shared inventory.",
      );
      apply(await loadConsole());
    } catch {
      setError("Couldn't save that property. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    const id = removeTarget.id;
    setRemoveTarget(null);
    try {
      const response = await fetch(`/api/admin/properties/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError("Couldn't remove that property. Please retry.");
        return;
      }
      setNotice("Property removed from the active inventory.");
      apply(await loadConsole());
    } catch {
      setError("Couldn't remove that property. Please retry.");
    }
  };

  return (
    <div className="shell py-28 lg:py-32">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow mb-3 flex items-center gap-3 text-[#c6ad78]">
            <span aria-hidden className="inline-block h-px w-10 bg-[#c6ad78]/60" />
            ASQDEVS · Admin
          </p>
          <h1 className="type-hero">Property Console</h1>
          <p className="type-meta mt-4 max-w-2xl text-[#f5f3f0]/55">
            One inventory. Properties you add or remove here are seen at once by
            the WhatsApp assistant, the AI receptionist and the property pages.
          </p>
        </div>
        <button
          onClick={onLogout}
          className="type-meta flex items-center gap-2 border border-[#2a2a2a] px-4 py-2.5 text-[#f5f3f0]/60 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3 border-b border-[#1f1f1f]">
        {(["inventory", "leads"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors ${
              tab === value
                ? "border-[#c6ad78] text-[#c6ad78]"
                : "border-transparent text-[#f5f3f0]/50 hover:text-[#f5f3f0]"
            }`}
          >
            {value === "inventory" ? (
              <Building2 className="h-4 w-4" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            {value === "inventory" ? "Inventory" : "Leads"}
            <span className="tabular-nums text-xs text-[#f5f3f0]/40">
              {value === "inventory" ? properties.length : leads.length}
            </span>
          </button>
        ))}
      </div>

      {notice && (
        <p className="type-meta mb-6 border border-[#25d366]/30 bg-[#25d366]/5 px-4 py-3 text-[#25d366]">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="type-meta mb-6 border border-[#e08d6b]/30 bg-[#e08d6b]/5 px-4 py-3 text-[#e08d6b]">
          {error}
        </p>
      )}

      {tab === "inventory" ? (
        <>
          <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#f5f3f0]/35" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search property"
                className="w-full border border-[#2a2a2a] bg-[#0c0c0c] py-3 pl-11 pr-4 text-[#f5f3f0] outline-none transition-colors focus:border-[#c6ad78]"
              />
            </div>
            <button
              onClick={() => {
                setDraft(emptyDraft());
                setNotice(undefined);
              }}
              className="flex items-center gap-2 bg-[#c6ad78] px-5 py-3 text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f]"
            >
              <Plus className="h-4 w-4" />
              Add Property
            </button>
          </div>

          {loading ? (
            <p className="type-meta text-[#f5f3f0]/40">Loading inventory…</p>
          ) : filtered.length ? (
            <ul className="grid gap-4">
              {filtered.map((property) => (
                <li
                  key={property.id}
                  className="flex flex-col gap-5 border border-[#1f1f1f] bg-[#0c0c0c] p-4 sm:flex-row sm:items-center sm:p-5"
                >
                  <div className="h-24 w-full shrink-0 overflow-hidden border border-[#1f1f1f] bg-[#141414] sm:h-20 sm:w-28">
                    {property.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={property.image}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[#f5f3f0]/25">
                        <Building2 className="h-6 w-6" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="type-title truncate">{property.name}</p>
                      <span
                        className={`border px-2.5 py-1 text-xs ${
                          statusTone[property.status] ?? statusTone.inactive
                        }`}
                      >
                        {property.status}
                      </span>
                      {property.adminAdded && (
                        <span className="text-xs text-[#c6ad78]">admin</span>
                      )}
                    </div>
                    <p className="type-meta mt-2 text-[#f5f3f0]/50">
                      {property.bhk} BHK {property.kind} · {property.location}
                      {property.city && property.city !== property.location
                        ? `, ${property.city}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-6 sm:flex-col sm:items-end">
                    <span className="text-lg font-medium text-[#c6ad78]">
                      {property.priceLabel}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setDraft(draftFrom(property));
                          setNotice(undefined);
                        }}
                        aria-label={`Edit ${property.name}`}
                        className="flex h-10 w-10 items-center justify-center border border-[#2a2a2a] text-[#f5f3f0]/60 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setRemoveTarget(property)}
                        aria-label={`Remove ${property.name}`}
                        className="flex h-10 w-10 items-center justify-center border border-[#2a2a2a] text-[#f5f3f0]/60 transition-colors hover:border-[#e08d6b] hover:text-[#e08d6b]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-meta text-[#f5f3f0]/40">
              No properties match that search.
            </p>
          )}
        </>
      ) : (
        <LeadList leads={leads} loading={loading} />
      )}

      {draft && (
        <PropertyEditor
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          uploading={uploading}
          onUpload={uploadFiles}
          onSave={() => setConfirmSave(true)}
          onClose={() => setDraft(null)}
        />
      )}

      {confirmSave && draft && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmSave(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-md border border-[#1f1f1f] bg-[#0c0c0c] p-7"
          >
            <h2 className="type-title mb-3">
              {draft.id ? "Save these changes?" : "Add this property?"}
            </h2>
            <p className="type-body mb-7 text-[#f5f3f0]/60">
              {draft.id
                ? `Update ${draft.name || "this property"}? The change is live for WhatsApp, the phone assistant and the property page at once.`
                : `${draft.name || "This property"} will join the shared inventory and the WhatsApp and phone assistants can recommend it immediately.`}
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setConfirmSave(false)}
                className="border border-[#2a2a2a] px-5 py-3 text-sm text-[#f5f3f0]/70 transition-colors hover:border-[#f5f3f0]/50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmSave(false);
                  void save();
                }}
                className="bg-[#c6ad78] px-5 py-3 text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f]"
              >
                Yes, {draft.id ? "save" : "add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRemoveTarget(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-md border border-[#1f1f1f] bg-[#0c0c0c] p-7"
          >
            <h2 className="type-title mb-3">Remove this property?</h2>
            <p className="type-body mb-7 text-[#f5f3f0]/60">
              Remove {removeTarget.name} from the active inventory? WhatsApp and
              the phone assistant will stop recommending it and its detail page
              will become unavailable.
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setRemoveTarget(null)}
                className="border border-[#2a2a2a] px-5 py-3 text-sm text-[#f5f3f0]/70 transition-colors hover:border-[#f5f3f0]/50"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemove}
                className="bg-[#e08d6b] px-5 py-3 text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-[#cf7a56]"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function validateMessage(error?: string): string {
  switch (error) {
    case "name_required":
      return "A property needs a name.";
    case "location_required":
      return "A property needs a location.";
    case "valid_bhk_required":
      return "Enter a valid BHK (1–20).";
    case "valid_price_required":
      return "Enter a valid price, e.g. 90L or 1.05Cr.";
    case "valid_kind_required":
      return "Choose a property type.";
    default:
      return "Couldn't save that property. Check the fields and retry.";
  }
}

function PropertyEditor({
  draft,
  setDraft,
  saving,
  uploading,
  onUpload,
  onSave,
  onClose,
}: {
  draft: Draft;
  setDraft: (updater: (current: Draft | null) => Draft | null) => void;
  saving: boolean;
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  const move = (index: number, delta: number) => {
    const next = [...draft.images];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set({ images: next });
  };

  const field =
    "w-full border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-3 text-[#f5f3f0] outline-none transition-colors focus:border-[#c6ad78]";
  const label = "eyebrow mb-2 block text-[#f5f3f0]/40";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-0 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="demo-scroll w-full max-w-3xl border border-[#1f1f1f] bg-[#0c0c0c] p-6 sm:my-6 sm:p-9"
      >
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-2 text-[#c6ad78]">
              {draft.id ? "Edit property" : "Add property"}
            </p>
            <h2 className="type-title">
              {draft.id ? draft.name || "Untitled" : "New listing"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#2a2a2a] text-[#f5f3f0]/50 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="p-name">
              Property name
            </label>
            <input
              id="p-name"
              className={field}
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="Gurgaon Heights"
            />
          </div>
          <div>
            <label className={label} htmlFor="p-location">
              Location
            </label>
            <input
              id="p-location"
              className={field}
              value={draft.location}
              onChange={(event) => set({ location: event.target.value })}
              placeholder="Gurugram"
            />
          </div>
          <div>
            <label className={label} htmlFor="p-city">
              City
            </label>
            <input
              id="p-city"
              className={field}
              value={draft.city}
              onChange={(event) => set({ city: event.target.value })}
              placeholder="Gurugram"
            />
          </div>
          <div>
            <label className={label} htmlFor="p-type">
              Type
            </label>
            <select
              id="p-type"
              className={field}
              value={draft.kind}
              onChange={(event) => set({ kind: event.target.value })}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="p-bhk">
              BHK
            </label>
            <input
              id="p-bhk"
              className={field}
              inputMode="numeric"
              value={draft.bhk}
              onChange={(event) => set({ bhk: event.target.value })}
              placeholder="3"
            />
          </div>
          <div>
            <label className={label} htmlFor="p-price">
              Price
            </label>
            <input
              id="p-price"
              className={field}
              value={draft.price}
              onChange={(event) => set({ price: event.target.value })}
              placeholder="1.05Cr"
            />
          </div>
          <div>
            <label className={label} htmlFor="p-status">
              Status
            </label>
            <select
              id="p-status"
              className={field}
              value={draft.status}
              onChange={(event) => set({ status: event.target.value })}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="p-furnishing">
              Furnishing
            </label>
            <select
              id="p-furnishing"
              className={field}
              value={draft.furnishing}
              onChange={(event) => set({ furnishing: event.target.value })}
            >
              {FURNISHINGS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="p-availability">
              Availability
            </label>
            <input
              id="p-availability"
              className={field}
              value={draft.availability}
              onChange={(event) => set({ availability: event.target.value })}
              placeholder="Ready to move"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="p-amenities">
              Amenities (comma separated)
            </label>
            <input
              id="p-amenities"
              className={field}
              value={draft.amenities}
              onChange={(event) => set({ amenities: event.target.value })}
              placeholder="Covered parking, Lift, 24x7 security"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="p-summary">
              Short summary
            </label>
            <input
              id="p-summary"
              className={field}
              value={draft.summary}
              onChange={(event) => set({ summary: event.target.value })}
              placeholder="A spacious 3 BHK in Gurugram close to the metro."
            />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="p-description">
              Description
            </label>
            <textarea
              id="p-description"
              rows={4}
              className={field}
              value={draft.description}
              onChange={(event) => set({ description: event.target.value })}
              placeholder="Describe the property the way an advisor would."
            />
          </div>
        </div>

        {/* Images */}
        <div className="mt-8 border-t border-[#1f1f1f] pt-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow text-[#f5f3f0]/40">
                Images ({draft.images.length}/5)
              </p>
              <p className="type-meta mt-1 text-[#f5f3f0]/35">
                The first image is the main photo. Add 3–5.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 border border-[#2a2a2a] px-4 py-2.5 text-sm text-[#f5f3f0]/70 transition-colors hover:border-[#c6ad78] hover:text-[#c6ad78]">
              <ImagePlus className="h-4 w-4" />
              {uploading ? "Uploading…" : "Add images"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={uploading || draft.images.length >= 5}
                onChange={(event) => {
                  void onUpload(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          {draft.images.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {draft.images.map((src, index) => (
                <div
                  key={src}
                  className="group relative overflow-hidden border border-[#1f1f1f]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Property image ${index + 1}`}
                    className="aspect-[4/3] w-full object-cover"
                  />
                  {index === 0 && (
                    <span className="absolute left-2 top-2 flex items-center gap-1 bg-[#c6ad78] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#0a0a0a]">
                      <Star className="h-3 w-3" />
                      Main
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex gap-1">
                      <button
                        onClick={() => move(index, -1)}
                        aria-label="Move image earlier"
                        className="flex h-8 w-8 items-center justify-center text-[#f5f3f0] hover:text-[#c6ad78]"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => move(index, 1)}
                        aria-label="Move image later"
                        className="flex h-8 w-8 items-center justify-center text-[#f5f3f0] hover:text-[#c6ad78]"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      onClick={() =>
                        set({ images: draft.images.filter((_, i) => i !== index) })
                      }
                      aria-label="Remove image"
                      className="flex h-8 w-8 items-center justify-center text-[#f5f3f0] hover:text-[#e08d6b]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="type-meta text-[#f5f3f0]/35">
              No images yet — the listing shows a placeholder until you add some.
            </p>
          )}
        </div>

        <div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-[#1f1f1f] pt-7">
          <button
            onClick={onClose}
            className="border border-[#2a2a2a] px-6 py-3 text-sm text-[#f5f3f0]/70 transition-colors hover:border-[#f5f3f0]/50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || uploading}
            className="bg-[#c6ad78] px-7 py-3 text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-[#aa925f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save property"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadList({ leads, loading }: { leads: StoredLead[]; loading: boolean }) {
  if (loading) {
    return <p className="type-meta text-[#f5f3f0]/40">Loading leads…</p>;
  }
  if (!leads.length) {
    return (
      <p className="type-meta text-[#f5f3f0]/40">
        No leads yet. Completed WhatsApp conversations and phone calls appear
        here.
      </p>
    );
  }

  return (
    <ul className="grid gap-4">
      {leads.map((lead) => (
        <li key={lead.id} className="border border-[#1f1f1f] bg-[#0c0c0c] p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="border border-[#c6ad78]/40 px-2.5 py-1 text-xs text-[#c6ad78]">
              {lead.source}
            </span>
            <span className="type-title">
              {lead.name || "New enquiry"}
              {lead.phone ? ` · ${lead.phone}` : ""}
            </span>
            <span className="type-meta text-[#f5f3f0]/50">
              {lead.temperature} · {lead.score}/100 · {lead.status}
            </span>
            <span className="type-meta ml-auto text-[#f5f3f0]/35">
              {new Date(lead.receivedAt).toLocaleString("en-GB")}
            </span>
          </div>

          <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Phone", lead.phone],
              ["Intent", lead.intent],
              ["Location", lead.preferredLocations.join(" or ") || lead.location],
              ["Requirement", lead.requirement],
              ["Budget", lead.budget],
              ["Timeline", lead.timeline],
              ["Preferences", lead.preferences.join(", ")],
              ["Appointment", lead.siteVisit],
              ["Next action", lead.nextAction],
            ].map(([key, value]) => (
              <div key={key}>
                <dt className="eyebrow mb-1.5 text-[#f5f3f0]/35">{key}</dt>
                <dd className={`type-meta ${value ? "text-[#f5f3f0]/85" : "text-[#f5f3f0]/30"}`}>
                  {value || "Not provided"}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 border-t border-[#1f1f1f] pt-5">
            <p className="eyebrow mb-2 text-[#f5f3f0]/35">AI summary</p>
            <p className="type-body text-[#f5f3f0]/75">{lead.summary}</p>
          </div>

          {lead.matches.length > 0 && (
            <div className="mt-5 border-t border-[#1f1f1f] pt-5">
              <p className="eyebrow mb-3 text-[#f5f3f0]/35">
                Matched properties ({lead.matches.length})
              </p>
              <ul className="flex flex-wrap gap-2">
                {lead.matches.map((match) => (
                  <li
                    key={`${match.name}-${match.url}`}
                    className="border border-[#2a2a2a] px-3 py-2"
                  >
                    <p className="type-meta text-[#f5f3f0]/80">
                      {match.name} — {match.bhk} — {match.price}
                    </p>
                    {match.url && (
                      <a
                        href={match.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="type-meta break-all text-[#c6ad78] underline-offset-2 hover:underline"
                      >
                        {match.url}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
