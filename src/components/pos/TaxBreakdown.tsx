'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface TaxLine {
  title: string;
  rate: number;
  amount: number;
}

interface Props {
  taxAmount: number;
  taxBreakdown: TaxLine[] | null | undefined;
  currency: string;
}

export default function TaxBreakdown({ taxAmount, taxBreakdown, currency }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasBreakdown = taxBreakdown && taxBreakdown.length > 0;

  if (!taxAmount || taxAmount <= 0) return null;

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <button
        onClick={() => hasBreakdown && setExpanded(!expanded)}
        className={`flex items-center gap-1 w-full text-left ${hasBreakdown ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
      >
        {hasBreakdown && (
          expanded
            ? <ChevronDown size={12} className="text-slate-400" />
            : <ChevronRight size={12} className="text-slate-400" />
        )}
        <span className="text-xs text-slate-300">Tax</span>
        <span className="flex-1" />
        <span className="text-xs text-slate-300">{currency}{fmt(taxAmount)}</span>
      </button>
      {expanded && hasBreakdown && (
        <div className="ml-4 mt-1 space-y-0.5">
          {taxBreakdown.map((line, i) => (
            <div key={i} className="flex justify-between text-xs text-slate-400">
              <span>{line.title} @{line.rate}%</span>
              <span>{currency}{fmt(line.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
