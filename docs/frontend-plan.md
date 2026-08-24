# Money Matrix Frontend Plan

This document proposes the frontend architecture, user journeys, delivery order, and quality bar for the initial Money Matrix web application. It plans against the current [OpenAPI contract](../backend/openapi/openapi.yaml) and the concepts in the [product vision](financial-model-and-product-vision.md).

## Implementation status

Phases 0 through 6 are implemented under `frontend/`. The application includes the responsive foundation, read-only financial picture, mutable catalogs, preset-driven manual transactions with advanced split rows and live coverage validation, audit-preserving reversal, CSV upload with saved or inline mappings, import discovery, row-by-row categorization review, categorization-rule management, immutable versioned parser-profile management, and the complete reconciliation lifecycle. Reconciliation drafts expose the computed balance and signed difference, can be discarded without affecting transactions, complete only when balanced, and allow only the latest eligible checkpoint to be reopened.

The refinement pass adds visible mutation results, focused validation failures, J/K import-row navigation, Ctrl/Cmd+Enter categorization saving, verified light/dark text contrast, and responsive reflow checks at a 200%-equivalent viewport. Playwright now drives a critical workflow against the real Go API and PostgreSQL.

The implemented visual system uses Tailwind CSS v4 with semantic CSS custom properties, a warm neutral canvas, emerald primary actions, amber attention states, muted red negative/error states, tabular financial figures, responsive navigation, and persistent light/dark themes. Radix Dialog and AlertDialog are used for accessible creation and confirmation flows; ordinary form controls remain native where they already provide the required behavior.

## Product outcome

The initial frontend should make the existing backend understandable and pleasant to use without exposing ledger mechanics unnecessarily. A user should be able to:

1. Create and review financial accounts, categories, and buckets.
2. Understand financial coverage and bucket allocation from one dashboard.
3. Browse, create, inspect, split, and reverse transactions.
4. Upload a CSV statement and resolve every actionable imported row.
5. Create, complete, reopen, and inspect reconciliations.
6. Create deterministic categorization rules and understand their suggestions.

The first release is a desktop-first responsive web app for one local user. It should remain usable on a phone, but dense statement review and split editing are optimized for a larger screen.

## Recommended stack

| Concern | Choice | Reason |
|---|---|---|
| Language and view layer | TypeScript and React | Strong component ecosystem and type checking for a form-heavy application |
| Build and development | Vite | Small client-only setup, fast development server, and a static production build |
| Routing | React Router in declarative mode | The app needs ordinary browser routes; TanStack Query will own the data lifecycle |
| Server state | TanStack Query | Caching, request deduplication, mutation state, invalidation, and retry behavior without a general global store |
| API contract | `openapi-typescript` and `openapi-fetch` | Generate endpoint types from the backend contract and use the native Fetch API without hand-written DTOs |
| Forms | React Hook Form | Efficient handling of dynamic posting and bucket-entry arrays |
| UI validation | Small feature-local validation functions; add Zod only where it materially simplifies a complex form | Avoid maintaining a complete second copy of the OpenAPI schema |
| Styling | Tailwind CSS with CSS custom properties for design tokens | Fast layout work while retaining an explicit visual system |
| Accessible primitives | Radix UI primitives, adopted component by component | Dialog, popover, select, tabs, and tooltip behavior without building accessibility mechanics ourselves |
| Unit/component tests | Vitest, React Testing Library, and MSW | Vite-aligned test runner, user-visible component assertions, and transport-level API mocks |
| Browser tests | Playwright | A small suite against the real Go API and PostgreSQL for critical workflows |
| Package manager | npm | Ships with Node and keeps the initial setup unsurprising |

Use currently supported stable releases when scaffolding rather than recording versions in this plan. Vite currently provides a React TypeScript template and requires a modern Node release. The exact Node version will be pinned in `.nvmrc` and `package.json` when implementation begins.

We do not need Next.js or another server-rendering layer. Money Matrix is an application behind a future authentication boundary, has no SEO requirement, and already has a Go API. A Vite static build is the smaller operational model.

## Repository layout

Place the frontend beside the backend rather than inside it:

```text
frontend/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   └── query-client.ts
│   ├── api/
│   │   ├── client.ts
│   │   ├── generated.d.ts
│   │   └── problem.ts
│   ├── components/
│   │   ├── layout/
│   │   └── ui/
│   ├── features/
│   │   ├── accounts/
│   │   ├── buckets/
│   │   ├── categories/
│   │   ├── dashboard/
│   │   ├── imports/
│   │   ├── reconciliations/
│   │   ├── rules/
│   │   └── transactions/
│   ├── lib/
│   │   ├── money.ts
│   │   ├── dates.ts
│   │   └── invariant.ts
│   ├── styles/
│   │   └── globals.css
│   └── test/
│       ├── setup.ts
│       └── server.ts
└── e2e/
```

Feature directories should contain their own route component, query/mutation hooks, form logic, and feature-specific components. Only genuinely reusable visual primitives belong in `components/ui`. Avoid a generic `utils` directory and avoid placing all API hooks in one large file.

## State ownership

Use the narrowest owner for each kind of state:

| State | Owner |
|---|---|
| Accounts, transactions, imports, buckets, categories, rules, and reconciliations | TanStack Query cache |
| Search, selected status, page, and date filters | URL query parameters |
| Draft form values and split rows | React Hook Form inside the active route/dialog |
| Temporary presentation state such as an open dialog | Local component state |
| Theme and future authenticated identity | Small React context providers |

Do not add Redux or another general application store initially. It would duplicate server state and create more synchronization paths.

Mutation hooks should invalidate the smallest useful query-key families. For example, creating or reversing a transaction invalidates transaction lists, the dashboard, accounts, and buckets. Import review additionally invalidates the affected import batch.

## Money handling

The API deliberately names monetary fields `amount` and `balance`, but their values are signed integer strings in minor currency units. The frontend must preserve that guarantee:

- Never parse API money with JavaScript `Number` for arithmetic.
- Use `bigint` for totals and comparisons inside the client.
- Display INR with `Intl.NumberFormat` after exact paise-to-rupee conversion.
- Let users type familiar decimal rupee values such as `450.00`.
- Convert display values to integer paise strings with a string parser, never floating-point multiplication.
- Keep sign rules visible beside transaction forms rather than expecting users to infer them.

The core helpers in `lib/money.ts` should be pure and heavily unit tested: `parseDisplayAmount`, `formatMoney`, `negateAmount`, `sumAmounts`, and `compareAmounts`.

## Application shell and routes

The primary shell uses a left navigation rail on desktop and a compact drawer on smaller screens.

| Route | Screen |
|---|---|
| `/` | Dashboard and outstanding work |
| `/transactions` | Paginated transaction timeline |
| `/transactions/new` | Manual transaction editor |
| `/transactions/:id` | Transaction detail, splits, provenance, and reversal |
| `/imports` | Import batch inbox and history |
| `/imports/new` | CSV upload and mapping/profile selection |
| `/imports/:id` | Batch review workspace |
| `/accounts` | Account catalog and balances |
| `/buckets` | Bucket catalog and balances |
| `/categories` | Income/expense category hierarchy |
| `/rules` | Categorization rules |
| `/reconciliations` | Reconciliation history and active checkpoint |
| `/parser-profiles` | Parser profile management |

The dashboard should emphasize:

- Assets, liabilities, and net covered money.
- Bucket total and a prominent warning if the allocation difference is non-zero.
- Unallocated balance.
- Imports needing review.
- Recently posted transactions.
- The latest reconciliation status per account when that endpoint becomes available.

## Critical interaction designs

### Transaction editor

The form should present business intent first and ledger detail second:

1. Date, description, and kind.
2. Account effects as signed posting rows.
3. Purpose splits as bucket rows with optional categories.
4. A live coverage summary showing account coverage, bucket total, and difference.

Provide common presets for income, expense, account transfer, and bucket transfer. Presets populate the right row shape but still submit the normal API command. Advanced users can add multiple postings and multiple entries, including the same bucket with different categories.

### Import review workspace

Use a two-pane desktop layout:

- Left: filterable row queue with pending, suggested, invalid, duplicate, reviewed, and skipped states.
- Right: source evidence, normalized values, linked transaction, suggestions, and editable bucket/category splits.

Keyboard actions support J/K movement through statement rows and Ctrl/Cmd+Enter saving from the active categorization form. Suggestions and skips remain explicit button actions so consequential changes are not triggered by an accidental single key. Invalid and duplicate rows remain inspectable but are visually distinct from actionable rows.

### Reconciliation

Guide the user through account, statement date, and statement balance. Show computed balance and difference before completion. Completed checkpoints are read-only except that only the latest one can be reopened. Explain conflicts in domain language rather than exposing database errors.

## API integration rules

- Generate `src/api/generated.d.ts` directly from `backend/openapi/openapi.yaml`.
- Fail CI if regeneration changes committed output.
- Use one configured `openapi-fetch` client with `VITE_API_BASE_URL`.
- Convert non-success responses into a typed `Problem` error at the API boundary.
- Feature hooks expose domain-oriented operations; React components should not call the raw client directly.
- Use query keys built from small factories such as `transactionKeys.list(filters)`.
- Keep API money as strings until an explicit formatting or exact-arithmetic boundary.
- Do not duplicate backend financial invariants as authoritative frontend rules. Mirror enough validation for immediate feedback, then display backend `Problem` details if the command is rejected.

During development, Vite should proxy `/api` and `/health` to `http://localhost:8080`. Production should serve the static frontend and Go API through one origin where practical, eliminating routine CORS configuration.

## Backend contract gaps to address incrementally

The current API is sufficient for the first vertical slice. These additions will materially improve later screens and should be implemented only when their frontend phase reaches them:

1. Transaction list filters for account, date range, kind, status, category, bucket, and text search.
2. Account-specific transaction history or the equivalent transaction filter.
3. Update operations for categories and buckets if renaming or note editing is required. Category and bucket unarchive operations were added with Phase 2 so archiving is not a one-way lifecycle.
4. Dashboard recent-transaction and per-account reconciliation summaries, or separate efficient endpoints.
5. Cursor pagination if offset pagination becomes slow with real history.
6. XLSX/PDF import endpoints after their backend adapters exist.
7. Conservative matching between imported rows and existing unmatched manual transactions. Exact high-confidence candidates may be linked automatically; nearby-date or description-only candidates should be confirmed during review. Until then, users must avoid manually entering bank activity that will later be imported or resolve the duplicate through reversal.

Avoid speculative endpoints. The frontend phase that needs a capability should add the contract, backend behavior, and UI together.

## Delivery phases

### Phase 0: foundation

- Create the Vite React TypeScript app.
- Add linting, formatting, type checking, Vitest, and the OpenAPI generation command.
- Add the application shell, design tokens, error boundary, API client, Query provider, and development proxy.
- Implement exact money parsing/formatting and typed `Problem` handling.
- Establish MSW fixtures generated from realistic backend responses.

### Phase 1: read-only financial picture

- Dashboard.
- Account, bucket, and category lists.
- Transaction timeline and detail.
- Responsive shell, loading skeletons, empty states, and retry states.

This phase proves API generation, routing, caching, money display, and the visual language without mutation complexity.

### Phase 2: catalogs and manual transactions

- Create and archive accounts, categories, and buckets.
- Manual income, expense, transfer, and opening-balance presets.
- Advanced posting and BucketEntry split editor.
- Transaction reversal confirmation and result display.

### Phase 3: statement imports

- CSV upload with inline mapping or parser-profile selection.
- Import-batch inbox and status filters.
- Row review workspace, suggestions, split editing, saving, and skipping.
- Invalid/duplicate evidence views and batch completion state.

### Phase 4: reconciliation

- Reconciliation list and account workflow.
- In-progress completion, balance mismatch handling, latest-checkpoint reopen, and status explanations.
- Protection messaging when a transaction would change a reconciled period.

### Phase 5: automation and polish

- Categorization-rule list, creation, validation, and deletion.
- Parser-profile management.
- Transaction filtering/search after the backend contract is added.
- Keyboard shortcuts, clear mutation/validation feedback, contrast checks, responsive refinement, and performance profiling.

### Phase 6: real browser workflows

Run Playwright against a dedicated PostgreSQL database and the real Go API for a small set of high-value journeys:

1. Create an account and opening balance, then verify dashboard and Unallocated.
2. Create a categorized expense split across BucketEntries, then reverse it.
3. Upload CSV, accept/edit a suggestion, skip another row, and complete the batch.
4. Create, complete, reopen, and recomplete a reconciliation.
5. Verify archived-target and reconciled-period errors are understandable in the UI.

## Testing boundaries

| Test level | Primary responsibility |
|---|---|
| Unit | Money/date conversion, split totals, rule-condition forms, query-key factories |
| Component/integration | Forms, error states, optimistic/pending UI, and accessibility using Testing Library plus MSW |
| End-to-end | A few complete user workflows across the browser, Go API, and PostgreSQL |

Prefer assertions on roles, labels, visible text, and user outcomes. Avoid snapshots of large component trees and avoid tests coupled to CSS classes or internal hook calls.

## Definition of done for the initial frontend

- Every currently implemented backend workflow has a usable screen or is explicitly marked deferred.
- No hand-written copies of OpenAPI response models exist.
- All money conversion is exact and centralized.
- Every route has loading, empty, error, and success behavior.
- Keyboard navigation and screen-reader labels cover core forms and dialogs.
- Component tests cover important failures, not only happy paths.
- The critical Playwright journeys pass against a freshly migrated test database.
- `make frontend-check` performs OpenAPI generation drift checks, type checking, linting, unit/component tests, and a production build.
- Root `make check` includes both backend and frontend checks.

## Deliberate deferrals

- Authentication and multi-user ownership until the hosted product boundary is designed.
- Server-side rendering and React Server Components.
- Offline mutation queues.
- A global client-state framework.
- Charts that do not answer a concrete financial question.
- PDF/XLSX UI paths before the backend supports those formats.
- Plans and recurring-rule screens before their APIs exist.

## Official references

- [React application setup](https://react.dev/learn/creating-a-react-app)
- [Vite getting started](https://vite.dev/guide/)
- [React Router modes](https://reactrouter.com/start/modes)
- [TanStack Query installation](https://tanstack.com/query/latest/docs/framework/react/installation)
- [OpenAPI TypeScript and openapi-fetch](https://openapi-ts.dev/openapi-fetch/)
- [Vitest](https://vitest.dev/guide/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Mock Service Worker](https://mswjs.io/)
- [Playwright testing guidance](https://playwright.dev/docs/writing-tests)
