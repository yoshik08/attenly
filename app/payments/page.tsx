'use client';

import { useMemo, useState } from 'react';
import { Printer } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Sheet } from '@/components/overlay';
import { cn } from '@/components/cn';
import { api } from '@/lib/api';
import type { FeeOrder, FeeReceipt } from '@/lib/erp/parsers';

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;

/** The ERP writes "success"; anything else is a payment that did not complete. */
function statusOf(status: string): { label: string; className: string } {
  const s = status.toLowerCase();
  if (s === 'success' || s === 'successful' || s === 'paid') {
    return { label: 'Paid', className: 'bg-[#0d1a14] text-cruise' };
  }
  if (s === 'pending' || s === 'initiated' || s === 'in progress') {
    return { label: 'Pending', className: 'bg-[#1a1508] text-thin' };
  }
  if (!s) return { label: 'Unknown', className: 'bg-[#121826] text-dropout-text' };
  return { label: status, className: 'bg-[#2a1210] text-red' };
}

export default function PaymentsPage() {
  return (
    <DataGate title="Payments">
      <Payments />
    </DataGate>
  );
}

function Payments() {
  const { snapshot, activeAccount } = useStore();
  const orders = useMemo(() => snapshot?.feeOrders ?? [], [snapshot]);
  const [open, setOpen] = useState<FeeOrder | null>(null);
  const [state, setState] = useState<{ loading: boolean; receipt: FeeReceipt | null; error: string | null }>({
    loading: false,
    receipt: null,
    error: null,
  });

  const paid = orders.filter((o) => statusOf(o.status).label === 'Paid');
  const total = paid.reduce((n, o) => n + o.amount, 0);

  const openReceipt = async (order: FeeOrder) => {
    setOpen(order);
    setState({ loading: true, receipt: null, error: null });
    try {
      const q = new URLSearchParams({ order: order.orderNo });
      if (activeAccount?.universityId) q.set('account', activeAccount.universityId);
      const res = await fetch(api(`/api/erp/fee-receipt?${q.toString()}`));
      const d = (await res.json().catch(() => ({}))) as { receipt?: FeeReceipt; error?: string };
      if (!res.ok || !d.receipt) {
        setState({ loading: false, receipt: null, error: d.error ?? 'Attenly could not read that receipt.' });
        return;
      }
      setState({ loading: false, receipt: d.receipt, error: null });
    } catch {
      setState({ loading: false, receipt: null, error: 'You look offline. Try again.' });
    }
  };

  if (orders.length === 0) {
    return (
      <section className="page-in py-8">
        <h1 className="title-l">Payments</h1>
        <p className="mt-8 text-[15px] font-semibold">No fee orders in the ERP yet.</p>
        <p className="mt-1 max-w-[58ch] text-[13px] text-dropout-text pretty">
          Payments come from the ERP&rsquo;s online fee orders and are read on every sync.
        </p>
      </section>
    );
  }

  return (
    <div className="page-in mx-auto max-w-[860px] py-6 lg:py-10">
      <h1 className="title-l">Payments</h1>
      <p className="mt-1.5 text-[13px] text-dropout-quiet tnum">
        {orders.length} fee order{orders.length === 1 ? '' : 's'} · {money(total)} paid
      </p>

      <ul className="mt-4">
        {orders.map((o) => {
          const st = statusOf(o.status);
          return (
            <li key={o.orderNo} className="seam-b py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-snug pretty">{o.subHead || o.head}</p>
                  <p className="mt-0.5 text-[12px] text-dropout-quiet tnum">{o.orderNo}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="figure text-[20px]">{money(o.amount)}</p>
                  <p className="text-[11px] text-dropout-quiet tnum">{o.orderDate}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <p className="text-[12px] text-dropout-text">
                  {[o.head, o.academicYear, o.semester, o.gateway, o.gatewayRef].filter(Boolean).join(' · ')}
                </p>
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', st.className)}>{st.label}</span>
                  <button type="button" className="btn btn-line btn-sm press" onClick={() => void openReceipt(o)}>
                    Receipt
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-[12px] text-dropout-quiet pretty">
        From the ERP&rsquo;s online fee orders. A receipt is read from the ERP when you open it.
      </p>


      <Sheet open={open !== null} onClose={() => setOpen(null)} title="Online payment receipt">
        {open && (
          <div className="print-sheet">
            {state.loading && <p className="py-6 text-[14px] text-dropout-text">Reading the receipt from the ERP…</p>}
            {state.error && (
              <p role="alert" className="py-6 text-[14px] text-red">
                {state.error}
              </p>
            )}
            {state.receipt && (
              <>
                <p className="text-[12px] text-dropout-quiet tnum">
                  {state.receipt.universityId} · {state.receipt.program}
                </p>
                <p className="mt-0.5 text-[15px] font-semibold">{state.receipt.candidate}</p>
                <div className="seam-t mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-3">
                  <p className="text-[13px] font-medium tnum">{state.receipt.receiptNo}</p>
                  <p className="text-[13px] text-dropout-text tnum">{state.receipt.date}</p>
                </div>
                <table className="mt-4 w-full text-[13px]">
                  <thead>
                    <tr className="seam-b text-left text-[11px] text-dropout-quiet">
                      <th className="pb-2 font-medium">Account head</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.receipt.lines.map((l, i) => (
                      <tr key={`${l.head}-${i}`} className="seam-b">
                        <td className="py-2 pr-3">{l.head}</td>
                        <td className="py-2 text-right tnum">{money(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="pt-3 text-[13px] font-semibold">Total</td>
                      <td className="pt-3 text-right">
                        <span className="figure text-[20px]">{money(state.receipt.total)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
                {state.receipt.inWords && <p className="mt-3 text-[12px] text-dropout-text">{state.receipt.inWords}</p>}
                <p className="mt-3 text-[11px] text-dropout-quiet pretty">
                  This is a computer-generated receipt. No signature is required.
                  {state.receipt.generatedAt ? ` Generated on ${state.receipt.generatedAt}.` : ''}
                </p>
                <button type="button" className="btn btn-mark btn-sm press mt-4" onClick={() => window.print()}>
                  <Printer size={15} aria-hidden /> Print
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

