// Basemap setup: MapLibre GL rendered as a Leaflet layer, in one of two modes
// reported by the backend's /api/health (see BASEMAP_MODE in src/config.py —
// this can't be a Vite build-time env var because the frontend Docker stage
// takes no build args, so the mode has to be resolved at runtime):
//
//   "openfreemap" (default) — hosted vector tiles, no key, no request limits.
//   "pmtiles"                — a self-hosted archive served by this app at
//                               /tiles, rendered from vendored glyphs/sprites
//                               so nothing leaves this origin.
import { setWorkerUrl, addProtocol } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@maplibre/maplibre-gl-leaflet";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { Protocol } from "pmtiles";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { api } from "../api";

// Self-host the worker (same-origin URL, not a blob:) so no worker-src/blob:
// CSP directive is ever needed — default-src 'self' already covers it. See
// src/api.py CSP_HEADER for the corresponding server-side policy.
//
// Must be "?worker&url", not plain "?url": the worker file itself dynamically
// imports a sibling "maplibre-gl-shared.mjs" chunk at runtime via a relative
// import.meta.url path. Plain "?url" copies the worker file verbatim without
// that sibling, so the worker 404s on its first import and no tiles ever load.
// "?worker&url" routes it through Vite's worker build pipeline instead, which
// bundles that dependency in.
setWorkerUrl(workerUrl);

let pmtilesProtocolRegistered = false;
function ensurePmtilesProtocol() {
  if (pmtilesProtocolRegistered) return;
  addProtocol("pmtiles", new Protocol().tile);
  pmtilesProtocolRegistered = true;
}

// The MapLibre style spec requires "sprite" to be an absolute URL — a
// root-relative path throws "Invalid sprite URL ... must be absolute" at
// style-load time. Resolve against location.origin so it's correct regardless
// of what host/port the app is served from.
function assetUrl(path) {
  return new URL(path, window.location.origin).href;
}

function flavorFor(theme) {
  return theme === "hacker" ? "dark" : "light";
}

// One shared fetch of basemap config for the whole app lifetime, not one per
// <Map> mount.
let basemapInfoPromise = null;
export function getBasemapInfo() {
  if (!basemapInfoPromise) {
    basemapInfoPromise = api.health().then((h) => ({
      basemap: h.basemap || { mode: "openfreemap", url: "https://tiles.openfreemap.org/styles", attribution: null },
      mapDefault: h.map_default || { center: [0, 0], zoom: 2 },
    }));
  }
  return basemapInfoPromise;
}

// Style for the given theme + basemap config, either a URL (openfreemap) or a
// full MapLibre style object (pmtiles).
export function styleFor(theme, basemap) {
  const flavor = flavorFor(theme);

  if (basemap.mode === "pmtiles") {
    ensurePmtilesProtocol();
    return {
      version: 8,
      // Plain string concat, not assetUrl()/new URL(): the URL constructor
      // percent-encodes "{"/"}", which breaks MapLibre's literal-token check
      // for "{fontstack}"/"{range}" in the glyphs template.
      glyphs: `${window.location.origin}/basemaps-assets/fonts/{fontstack}/{range}.pbf`,
      sprite: assetUrl(`/basemaps-assets/sprites/v4/${flavor}`),
      sources: {
        protomaps: {
          type: "vector",
          url: `pmtiles://${basemap.url}`,
          attribution: basemap.attribution || "",
        },
      },
      layers: layers("protomaps", namedFlavor(flavor), { lang: "en" }),
    };
  }

  // openfreemap: MapLibre accepts a style URL directly and adds the required
  // attribution itself.
  return `${basemap.url}/${flavor === "dark" ? "dark" : "positron"}`;
}
