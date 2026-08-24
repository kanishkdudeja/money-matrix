import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";

import { AppShell } from "../components/layout/app-shell";
import { LoadingState } from "../components/ui/page";

const AccountsPage = lazy(() => import("../features/accounts/accounts-page").then((module) => ({ default: module.AccountsPage })));
const BucketsPage = lazy(() => import("../features/buckets/buckets-page").then((module) => ({ default: module.BucketsPage })));
const CategoriesPage = lazy(() => import("../features/categories/categories-page").then((module) => ({ default: module.CategoriesPage })));
const DashboardPage = lazy(() => import("../features/dashboard/dashboard-page").then((module) => ({ default: module.DashboardPage })));
const ImportsPage = lazy(() => import("../features/imports/imports-page").then((module) => ({ default: module.ImportsPage })));
const ImportBatchPage = lazy(() => import("../features/imports/import-batch-page").then((module) => ({ default: module.ImportBatchPage })));
const ImportUploadPage = lazy(() => import("../features/imports/import-upload-page").then((module) => ({ default: module.ImportUploadPage })));
const ReconciliationsPage = lazy(() => import("../features/reconciliations/reconciliations-page").then((module) => ({ default: module.ReconciliationsPage })));
const RulesPage = lazy(() => import("../features/rules/rules-page").then((module) => ({ default: module.RulesPage })));
const TransactionDetailPage = lazy(() => import("../features/transactions/transaction-detail-page").then((module) => ({ default: module.TransactionDetailPage })));
const TransactionEditorPage = lazy(() => import("../features/transactions/transaction-editor-page").then((module) => ({ default: module.TransactionEditorPage })));
const TransactionsPage = lazy(() => import("../features/transactions/transactions-page").then((module) => ({ default: module.TransactionsPage })));
const NotFoundPage = lazy(() => import("../features/not-found-page").then((module) => ({ default: module.NotFoundPage })));
const ParserProfilesPage = lazy(() => import("../features/parser-profiles/parser-profiles-page").then((module) => ({ default: module.ParserProfilesPage })));

export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Suspense fallback={<LoadingState label="Loading workspace…" />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/new" element={<TransactionEditorPage />} />
            <Route path="/transactions/:id" element={<TransactionDetailPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/buckets" element={<BucketsPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/imports" element={<ImportsPage />} />
            <Route path="/imports/new" element={<ImportUploadPage />} />
            <Route path="/imports/:id" element={<ImportBatchPage />} />
            <Route path="/reconciliations" element={<ReconciliationsPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/parser-profiles" element={<ParserProfilesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AppShell>
    </BrowserRouter>
  );
}
