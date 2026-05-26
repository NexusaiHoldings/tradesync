/**
 * @nexus/files-and-media — STUB workspace package.
 *
 * Spec authority: NEXUS_PORTFOLIO_RUNTIME_SPEC.md §11 capability #10.
 * Status: stub. Slots declared in manifest.yaml; no handlers / tools wired.
 * Substrate's _legos_config_generator detects __substrate_stub=true and
 * omits this lego from runtime tool registration.
 *
 * To implement: replace this barrel with real handlers (see legos/identity-and-access/
 * for the canonical pattern), flip __substrate_stub=false in package.json, and bump
 * version to 1.0.0.
 */

export const LEGO_NAME = "files-and-media" as const;
export const LEGO_VERSION = "0.0.0-stub" as const;
export const IS_STUB = true as const;
