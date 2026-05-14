'use client';

import PrinterStatus from './PrinterStatus';
import CustomerSearch from './CustomerSearch';

export default function PosTopbar() {
  return (
    <div className="flex items-start gap-2 border-b bg-white shrink-0 px-4 py-2">
      <div className="flex-1 min-w-0">
        <CustomerSearch variant="topbar" />
      </div>
      <div className="shrink-0 pt-0.5">
        <PrinterStatus />
      </div>
    </div>
  );
}
