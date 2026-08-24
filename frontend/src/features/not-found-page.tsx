import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import { Panel } from "../components/ui/panel";

export function NotFoundPage() {
  return (
    <Panel className="mx-auto max-w-xl p-10 text-center">
      <p className="font-display text-7xl text-primary">404</p>
      <h1 className="mt-4 text-2xl font-bold">This page isn’t in the matrix</h1>
      <p className="mt-2 text-sm leading-6 text-ink-muted">The address may be old, or the page has not been built yet.</p>
      <Link to="/" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary-strong">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to overview
      </Link>
    </Panel>
  );
}
