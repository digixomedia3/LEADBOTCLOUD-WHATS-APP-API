'use client';

import { Printer } from 'lucide-react';

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"><Printer className="size-4" />Print or save as PDF</button>;
}
