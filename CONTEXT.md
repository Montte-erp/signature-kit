# SignatureKit domain context

SignatureKit supplies digital-signature runtimes. A1 / PKCS#12 is a signer backend;
PDF and XML are document formats. A remote signature request is an upstream
workflow, not a byte signature or a document format.

## Ownership

| Context | Owner | Contract |
| --- | --- | --- |
| Byte signing and signer identity | `core/signatures` | Certificate schemas, `Signatures`, typed errors |
| Certificate material | `core/certificates`, `shared/crypto` | PKCS#12 import and X.509 inspection |
| Remote signature requests | Each package under `signers/` | Provider-specific resource, credentials, lifecycle and statuses |
| Document preparation and signing | `formats/pdf`, `formats/xml` | Placement, mutation, signing and verification |
| Conformance validation | `validators/iti` | Local checks and upstream validator results |
| React integration | `formats/react` | Public headless hooks and their browser data seams |
| Site navigation and content | `apps/docs` | Localized URLs, documentation, articles and release notes |
| Signing demonstrations | `apps/docs` | User interactions that invoke format and signer capabilities |

Do not move application state into core or provider packages. Each remote signer
retains its own upstream vocabulary. Foldkit models and messages belong to the
site; package services continue to return Effect values.

## Site architecture

The Foldkit application owns navigation, preferences, search and signing-demo
interaction. Its models describe public metadata and progress. SigningSession
owns ephemeral documents and certificate material; PdfPreview owns scoped PDF.js
workers and rendered-document caching. Commands invoke those services at browser
event boundaries. PDF preparation, placement, stamping, rubrics and cryptographic
signing remain in the format and signer packages.

Content publication compiles the Markdown/MDX AST into validated content entries,
navigation and search indexes. Native Foldkit SSR and hydration share flags and a
build identity. Canonical locale URLs, metadata, feeds, social images and registry
assets belong to this publication boundary. Paraglide messages receive the locale
explicitly in server and browser rendering.

## Migration boundary

The migration includes the entire site/docs and signing demonstrations. The public
React hooks and React registry artifacts remain supported consumers. Waku still
owns the default site commands while the Foldkit replacement is completed.

Before removing that owner, preserve certificate/document import, preparation,
manual and automatic placement, stamp customization, preview, signing, downloads,
cancellation and cleanup. Preserve the automatic demonstration, content actions,
feedback and analytics as well as the publication routes. Remove the superseded
renderers, callers and configuration together when the native paths are validated.

Behavior tests exercise real packages, scoped resources and generated production
artifacts. Static gates enforce package direction and boundary contracts. A passing
focused test proves its behavior; the complete cutover also needs the repository's
build, check, test, integration and publication gates.
