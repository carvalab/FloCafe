'use client';

/**
 * PrinterStatus — toolbar button that shows printer connection state and
 * exposes connect / disconnect actions.
 *
 * Place it in the POS page header or sidebar header alongside other toolbar
 * icons.  Example:
 *
 *   <PrinterStatus currency={currency} />
 *
 * The `navigator.usb.requestDevice` picker is only opened on an explicit user
 * click, satisfying the browser's "transient user activation" requirement.
 */

import {
  Printer,
  PrinterCheck,
  PrinterX,
  Loader2,
  Unplug,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePrinterStore, usePrinterStatusSync } from '@/hooks/usePrinter';
import type { PrinterStatus } from '@/lib/printer/PrinterService';
import toast from 'react-hot-toast';

const STATUS_CONFIG: Record<
  PrinterStatus,
  { label: string; color: string; Icon: React.ElementType }
> = {
  disconnected: {
    label: 'No Printer',
    color: 'text-gray-400',
    Icon: Printer,
  },
  connecting: {
    label: 'Connecting…',
    color: 'text-amber-500',
    Icon: Loader2,
  },
  connected: {
    label: 'Printer Ready',
    color: 'text-green-600',
    Icon: PrinterCheck,
  },
  error: {
    label: 'Printer Error',
    color: 'text-red-500',
    Icon: PrinterX,
  },
};

export default function PrinterStatus() {
  usePrinterStatusSync();

  const {
    status, deviceInfo, lastError,
    connect, disconnect, clearError,
    printMethod, hardwarePrinter,
  } = usePrinterStore();

  const effectiveStatus: PrinterStatus = hardwarePrinter ? 'connected' : status;
  const cfg = STATUS_CONFIG[effectiveStatus];
  const Icon = cfg.Icon;

  const handleConnect = async () => {
    clearError();
    await connect();
    if (usePrinterStore.getState().status === 'connected') {
      toast.success('Printer connected');
    } else if (usePrinterStore.getState().lastError) {
      toast.error(usePrinterStore.getState().lastError!);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    toast('Printer disconnected');
  };

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`flex items-center gap-1.5 ${cfg.color} border-current/30`}
        >
          <Icon
            size={16}
            className={isConnecting ? 'animate-spin' : undefined}
          />
          <span className="hidden sm:inline text-xs font-medium truncate max-w-[140px]">
            {hardwarePrinter ? hardwarePrinter.name : cfg.label}
          </span>
          <ChevronDown size={12} className="text-gray-400" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-gray-500">
          Receipt Printer
        </DropdownMenuLabel>

        {hardwarePrinter && (
          <div className="px-2 py-1.5 text-xs text-gray-500 border-b border-gray-100">
            <p className="font-medium text-gray-700 truncate flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {hardwarePrinter.name}
            </p>
            <p className="capitalize">
              {hardwarePrinter.connection_type}
              {hardwarePrinter.connection_type === 'network' && hardwarePrinter.ip_address
                ? ` · ${hardwarePrinter.ip_address}${hardwarePrinter.port ? ':' + hardwarePrinter.port : ''}`
                : ''}
              {hardwarePrinter.paper_width ? ` · ${hardwarePrinter.paper_width}` : ''}
            </p>
          </div>
        )}

        {isConnected && deviceInfo && (
          <div className="px-2 py-1.5 text-xs text-gray-500 border-b border-gray-100">
            <p className="font-medium text-gray-700 truncate">
              {deviceInfo.productName ?? 'Unknown device'}
            </p>
            <p>{deviceInfo.manufacturerName ?? `VID:${deviceInfo.vendorId.toString(16).toUpperCase()}`}</p>
          </div>
        )}

        {lastError && (
          <div className="px-2 py-1.5 text-xs text-red-600 bg-red-50 rounded mx-1 my-1">
            {lastError}
          </div>
        )}

        <DropdownMenuSeparator />

        {printMethod === 'escpos' && (
          <>
            {!isConnected && !isConnecting && (
              <DropdownMenuItem
                onClick={handleConnect}
                disabled={isConnecting}
                className="text-sm cursor-pointer"
              >
                <Printer size={14} className="mr-2" />
                {isConnecting ? 'Connecting…' : 'Connect USB Printer'}
              </DropdownMenuItem>
            )}

            {isConnected && (
              <DropdownMenuItem
                onClick={handleDisconnect}
                className="text-sm cursor-pointer text-red-600 focus:text-red-600"
              >
                <Unplug size={14} className="mr-2" />
                Disconnect
              </DropdownMenuItem>
            )}
          </>
        )}

        {printMethod === 'browser' && (
          <div className="px-2 py-1.5 text-xs text-gray-500">
            Browser print mode — change in Settings
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
