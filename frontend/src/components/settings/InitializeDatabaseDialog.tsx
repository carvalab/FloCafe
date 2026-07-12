'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MasterPinPrompt } from './MasterPinPrompt';
import { AlertTriangle } from 'lucide-react';

const CONFIRM_PHRASE = 'INITIALIZE';

interface InitializeDatabaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (pin: string) => Promise<{ success: boolean; error?: string; backupPath?: string }>;
  onSuccess: (backupPath?: string) => void;
}

export function InitializeDatabaseDialog({ open, onOpenChange, onConfirm, onSuccess }: InitializeDatabaseDialogProps) {
  const [phrase, setPhrase] = useState('');
  const [showPinPrompt, setShowPinPrompt] = useState(false);

  const reset = () => {
    setPhrase('');
    setShowPinPrompt(false);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const handlePinSubmit = async (pin: string) => {
    const result = await onConfirm(pin);
    if (result.success) {
      setShowPinPrompt(false);
      onOpenChange(false);
      onSuccess(result.backupPath);
    }
    return result;
  };

  return (
    <>
      <Dialog open={open && !showPinPrompt} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle size={18} />
              Initialize Database
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-2 text-left">
              <span className="block">
                This permanently deletes every product, order, customer, and setting, and resets the database to a blank install.
                You&apos;ll go through first-run setup again afterward.
              </span>
              <span className="block font-medium text-gray-700">
                A backup is created automatically before anything is deleted.
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="initialize-confirm">
              Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> to continue
            </Label>
            <Input
              id="initialize-confirm"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={phrase !== CONFIRM_PHRASE}
              onClick={() => setShowPinPrompt(true)}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MasterPinPrompt
        open={open && showPinPrompt}
        mode="verify"
        title="Confirm Master PIN"
        description="Enter your device Master PIN to permanently initialize the database."
        onCancel={() => setShowPinPrompt(false)}
        onSubmit={handlePinSubmit}
      />
    </>
  );
}
