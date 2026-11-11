'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { DemoBanner } from '@/components/demo-banner';

const sample = [
  ['नाम', 'mobile', 'plan', 'ends'],
  ['Asha Verma', '98765 43210', 'Premium', '14-11-2026'],
  ['Rohit Singh', '09123456780', 'Basic', '20-11-2026'],
  ['Neha Gupta', '+91 91234 5678', 'Basic', '09-11-2026'],
  ['Imran Khan', '8765432109', 'Premium', '02-12-2026'],
];
const fields = ['Name', 'Phone', 'Tag', 'Renewal date', 'Ignore this column'];
const guess = ['Name', 'Phone', 'Tag', 'Renewal date'];
const sources = ['Website form', 'In shop', 'WhatsApp chat', 'Order/invoice', 'Imported list', 'Other'];

export default function ImportPage() {
  const [step, setStep] = useState(1);
  const [map, setMap] = useState<string[]>(guess);
  const [agree, setAgree] = useState(false);
  const [source, setSource] = useState(sources[0]!);

  return (
    <div>
      <PageHeader title="Import customers" subtitle="Upload a CSV or Excel file. We will match the columns for you." back={{ href: '/customers', label: 'Customers' }} />
      <DemoBanner />
      <ol className="mb-4 flex gap-2 text-xs font-semibold" aria-label="Steps">
        {['Upload', 'Match columns', 'Check', 'Done'].map((s, i) => (
          <li key={s} className={`flex-1 rounded-full px-2 py-2 text-center ${step === i + 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{i + 1}. {s}</li>
        ))}
      </ol>

      {step === 1 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <FileSpreadsheet className="size-10 text-primary" />
          <p className="font-semibold">Choose your customer file</p>
          <p className="text-sm text-muted-foreground">Hindi or English column names both work. We remove duplicates by phone number.</p>
          <Button onClick={() => setStep(2)}>Use the sample file</Button>
        </Card>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-4">
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {sample[0]!.map((h, i) => (
                    <th key={h} className="min-w-36 p-3">
                      <span className="mb-1 block text-xs text-muted-foreground">Column: {h}</span>
                      <Select aria-label={`What is ${h}?`} value={map[i]} onChange={(e) => setMap(map.map((m, j) => (j === i ? e.target.value : m)))}>
                        {fields.map((f) => <option key={f}>{f}</option>)}
                      </Select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.slice(1).map((r) => (
                  <tr key={r[0]} className="border-b border-border last:border-0">
                    {r.map((cell, i) => <td key={i} className="p-3">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Button onClick={() => setStep(3)}>Continue</Button>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-primary" />4 customers are ready to import</p>
            <p className="flex items-center gap-2 text-sm"><AlertTriangle className="size-4 text-warning" />1 phone number looks short and will be skipped: <span className="font-mono">+91 91234 5678</span></p>
            <p className="text-xs text-muted-foreground">Numbers like 09123456780, 98765 43210 and +91… are all cleaned into one format.</p>
          </Card>
          <Card className="flex flex-col gap-3">
            <p className="font-semibold">Did these customers agree to get WhatsApp messages from you?</p>
            <Field label="Where did they agree?"><Select value={source} onChange={(e) => setSource(e.target.value)}>{sources.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 size-5" />
              Yes. These customers agreed to receive WhatsApp messages from my business.
            </label>
          </Card>
          <Button disabled={!agree} onClick={() => setStep(4)}>Import customers</Button>
        </div>
      ) : null}

      {step === 4 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 className="size-10 text-primary" />
          <p className="text-lg font-semibold">Import finished</p>
          <div className="flex gap-2"><Badge tone="green">3 added</Badge><Badge tone="blue">0 updated</Badge><Badge tone="amber">1 skipped</Badge></div>
          <Button variant="outline">Download the list of skipped rows</Button>
          <p className="text-xs text-muted-foreground">Permission recorded: {source}, today.</p>
        </Card>
      ) : null}
    </div>
  );
}
