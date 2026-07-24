import { useEffect, useState } from 'react';
import { Banknote, CreditCard, QrCode, Wallet } from 'lucide-react';
import { PluginPaymentMethodsResponseSchema } from '@flo-plugin-api';
import type { PaymentMethodDescriptor } from '@flo-plugin-api';
import api from './api';

export type PaymentMethod = PaymentMethodDescriptor & { icon: typeof Banknote };

export function primitiveToIcon(primitive?: PaymentMethodDescriptor['primitive']) {
  return primitive === 'cash' ? Banknote : primitive === 'card' ? CreditCard : primitive === 'qr' ? QrCode : Wallet;
}

export function usePaymentMethods(): PaymentMethod[] {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  useEffect(() => {
    api.get('/plugins/payment-methods').then(({ data }) => {
      const parsed = PluginPaymentMethodsResponseSchema.parse(data);
      setMethods(parsed.methods.map((method) => ({
        ...method,
        icon: primitiveToIcon(method.primitive),
      })));
    }).catch(() => {});
  }, []);
  return methods;
}
