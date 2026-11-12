'use client';

import { useMemo, useRef, useState } from 'react';
import { CircleNotch, Printer, Receipt } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Sheet } from '@/components/overlay';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { api } from '@/lib/api';
import type { FeeOrder, FeeReceipt } from '@/lib/erp/parsers';

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;

/** The ERP writes "success"; anything else is a payment that did not complete. */
function statusOf(status: string): { label: string; tone: 'safe' | 'condonation' | 'detained' | 'none' } {
  const s = status.toLowerCase();
  if (s === 'success' || s === 'successful' || s === 'paid') return { label: 'Paid', tone: 'safe' };
  if (s === 'pending' || s === 'initiated' || s === 'in progress') return { label: 'Pending', tone: 'condonation' };
  if (!s) return { label: 'Unknown', tone: 'none' };
  return { label: status, tone: 'detained' };
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
  const seq = useRef(0);

  const paid = orders.filter((o) => statusOf(o.status).label === 'Paid');
  const total = paid.reduce((n, o) => n + o.amount, 0);

  const openReceipt = async (order: FeeOrder) => {
    const mine = ++seq.current;
    setOpen(order);
    setState({ loading: true, receipt: null, error: null });
    try {
      const q = new URLSearchParams({ order: order.orderNo });
      if (activeAccount?.universityId) q.set('account', activeAccount.universityId);
      const res = await fetch(api(`/api/erp/fee-receipt?${q.toString()}`));
      const d = (await res.json().catch(() => ({}))) as { receipt?: FeeReceipt; error?: string };
      if (mine !== seq.current) return; // another receipt was opened meanwhile
      if (!res.ok || !d.receipt) {
        setState({ loading: false, receipt: null, error: d.error ?? 'Attenly could not read that receipt.' });
        return;
      }
      setState({ loading: false, receipt: d.receipt, error: null });
    } catch {
      if (mine !== seq.current) return;
      setState({ loading: false, receipt: null, error: 'You look offline. Try again.' });
    }
  };

  if (orders.length === 0) {
    return (
      <section className="page-in">
        <PageHeader title="Payments" />
        <Empty icon={Receipt} title="No fee orders in the ERP yet.">
          Payments come from the ERP&rsquo;s online fee orders and are read on every sync.
        </Empty>
      </section>
    );
  }

  return (
    <div className="page-in max-w-[900px]">
      <PageHeader title="Payments" sub={`${orders.length} fee order${orders.length === 1 ? '' : 's'} from the ERP`} />

      <div data-tone="safe" className="card glow mt-7 p-5 lg:p-7" style={{ '--gs': '420px', '--gx': '-160px', '--gy': '-220px' } as React.CSSProperties}>
        <p className="text-[13px] font-semibold text-fg-2">Paid online</p>
        <p className="figure mt-2 text-[44px] lg:text-[56px]">{money(total)}</p>
        <p className="mt-2 text-[13px] text-fg-3 tnum">
          across {paid.length} completed order{paid.length === 1 ? '' : 's'}
        </p>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {orders.map((o, i) => {
          const st = statusOf(o.status);
          return (
            <li key={o.orderNo} className="card rise p-4 sm:p-5" style={{ '--i': i } as React.CSSProperties}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-snug pretty">{o.subHead || o.head}</p>
                  <p className="mono mt-1 text-[12px] text-fg-3">{o.orderNo}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="figure text-[22px]">{money(o.amount)}</p>
                  <p className="mt-1 text-[12px] text-fg-3 tnum">{o.orderDate}</p>
                </div>
              </div>
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 hair-t pt-3.5">
                <p className="min-w-0 text-[12.5px] text-fg-2">
                  {[o.head, o.academicYear, o.semester, o.gateway, o.gatewayRef].filter(Boolean).join(' · ')}
                </p>
                <div className="flex items-center gap-2">
                  <span data-tone={st.tone} className="chip">
                    <span className="dot" aria-hidden />
                    {st.label}
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm press" onClick={() => void openReceipt(o)}>
                    Receipt
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Footnote>From the ERP&rsquo;s online fee orders. A receipt is read from the ERP when you open it.</Footnote>

      <Sheet open={open !== null} onClose={() => setOpen(null)} title="Online payment receipt" wide bare>
        {open && (
          <div>
            {state.loading && (
              <p className="flex items-center gap-2 py-8 text-[14px] text-fg-2">
                <CircleNotch size={18} className="spin" aria-hidden /> Reading the receipt from the ERP…
              </p>
            )}
            {state.error && (
              <p role="alert" className="py-8 text-[14px] text-det">
                {state.error}
              </p>
            )}
            {state.receipt && (
              <>
                {/* The receipt as paper: dark UI around it, ink on white inside, and that is also what prints. */}
                <div className="print-sheet relative mb-2 mt-12 rounded-t-[16px] lg:mt-10 bg-[#fbfbf9] px-5 pb-7 pt-5 text-[#111] shadow-[0_18px_50px_rgba(0,0,0,0.5)] sm:px-6">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/50">Online payment receipt</p>
                    <p className="mono shrink-0 text-[12px] text-black/60">{state.receipt.date}</p>
                  </div>
                  <p className="mt-2 text-[18px] font-bold leading-tight">{state.receipt.candidate}</p>
                  <p className="mono mt-1 text-[12px] text-black/60">
                    {state.receipt.universityId} · {state.receipt.program}
                  </p>
                  <p className="mono mt-3 break-all text-[12.5px] font-semibold">{state.receipt.receiptNo}</p>
                  <div className="my-4 border-t border-dashed border-black/25" />
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] text-black/50">
                        <th className="pb-2 font-semibold">Account head</th>
                        <th className="pb-2 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.receipt.lines.map((l, i) => (
                        <tr key={`${l.head}-${i}`} className="border-t border-black/10">
                          <td className="py-2 pr-3">{l.head}</td>
                          <td className="mono py-2 text-right">{money(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-black/80">
                        <td className="pt-3 text-[13px] font-bold">Total</td>
                        <td className="pt-3 text-right">
                          <span className="figure text-[24px]">{money(state.receipt.total)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  {state.receipt.inWords && <p className="mt-3 text-[12px] font-medium text-black/70">{state.receipt.inWords}</p>}
                  <p className="mt-4 text-[11px] leading-relaxed text-black/50 pretty">
                    This is a computer-generated receipt. No signature is required.
                    {state.receipt.generatedAt ? ` Generated on ${state.receipt.generatedAt}.` : ''}
                  </p>
                  {/* A torn edge */}
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-[6px] h-3"
                    style={{ background: 'radial-gradient(circle, #121214 5px, transparent 5.5px) 0 0 / 14px 12px repeat-x' }}
                  />
                </div>
                <button type="button" className="btn btn-primary press mt-5 w-full sm:w-auto" onClick={() => window.print()}>
                  <Printer size={17} aria-hidden /> Print
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
