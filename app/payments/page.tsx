'use client';

import { useMemo, useRef, useState } from 'react';
import { CircleNotch, Printer, Receipt } from '@phosphor-icons/react';
import { useStore } from '@/components/store';
import { DataGate } from '@/components/states';
import { Sheet } from '@/components/overlay';
import { Empty, Footnote, PageHeader } from '@/components/page';
import { api } from '@/lib/api';
import type { FeeOrder, FeeReceipt } from '@/lib/erp/parsers';
import type { LedgerRow } from '@/lib/erp/records-parse';
import { useRecord } from '@/components/records';
import { localPost } from '@/components/local';
import { Notice } from '@/components/page';
import { RecordLine, fmtDate } from '@/components/record-ui';
import { cn } from '@/components/cn';

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)}`;

/** The ERP writes "success"; anything else is a payment that did not complete. */
function statusOf(status: string): { label: string; tone: 'safe' | 'condonation' | 'detained' | 'none' } {
  const s = status.toLowerCase();
  if (s === 'success' || s === 'successful' || s === 'paid') return { label: 'Paid', tone: 'safe' };
  if (s === 'pending' || s === 'initiated' || s === 'in progress') return { label: 'Pending', tone: 'condonation' };
  if (!s) return { label: 'Unknown', tone: 'none' };
  // The ERP writes these in lower case ("fail", "aborted").
  if (s === 'fail' || s === 'failed' || s === 'failure') return { label: 'Failed', tone: 'detained' };
  if (s === 'aborted' || s === 'abort' || s === 'cancelled' || s === 'canceled') return { label: s.startsWith('abort') ? 'Aborted' : 'Cancelled', tone: 'detained' };
  return { label: status.charAt(0).toUpperCase() + status.slice(1), tone: 'detained' };
}

export default function PaymentsPage() {
  return (
    <DataGate title="Payments">
      <Payments />
    </DataGate>
  );
}

function Payments() {
  const { snapshot, activeAccount, local } = useStore();
  const orders = useMemo(() => snapshot?.feeOrders ?? [], [snapshot]);
  const fees = useRecord('fees');
  const ledger = fees.data?.ledger ?? [];
  const dues = fees.data?.dues ?? [];
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
      if (local && !order.receiptHref) {
        setState({ loading: false, receipt: null, error: 'The ERP has no receipt for that order yet.' });
        return;
      }
      const q = new URLSearchParams({ order: order.orderNo });
      if (activeAccount?.universityId) q.set('account', activeAccount.universityId);
      // Without Google there is no stored snapshot to look the order up in: this device names the receipt.
      const res = local
        ? await localPost('/api/local/fee-receipt', { href: order.receiptHref })
        : await fetch(api(`/api/erp/fee-receipt?${q.toString()}`));
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

  const owed = dues.reduce((n, d) => n + d.amount, 0);

  return (
    <div className="page-in max-w-[900px]">
      <PageHeader
        title="Payments"
        sub={
          <RecordLine fetchedAt={fees.fetchedAt} loading={fees.loading} onRefresh={fees.refresh}>
            <span className="tnum">
              {orders.length} online order{orders.length === 1 ? '' : 's'}
            </span>
          </RecordLine>
        }
      />

      {owed > 0 && (
        <Notice className="mt-6" title={`${money(owed)} due on the ERP`}>
          {dues.map((d) => `${d.label} ${money(d.amount)}`).join(' · ')}
        </Notice>
      )}

      {ledger.length > 0 && <FeeLedger ledger={ledger} />}

      {orders.length === 0 ? (
        <Empty icon={Receipt} title="No online fee orders in the ERP yet.">
          Online payments come from the ERP&rsquo;s fee orders and are read on every sync.
        </Empty>
      ) : (
      <>
      <h2 className="h2 mt-12">Online payments</h2>

      <div data-tone="safe" className="card glow mt-4 p-5 lg:p-7" style={{ '--gs': '420px', '--gx': '-160px', '--gy': '-220px' } as React.CSSProperties}>
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

      </>
      )}

      <Footnote>
        Semester fees come from the ERP&rsquo;s fee structure, read when you open this screen. Online payments come from its fee
        orders, read on every sync; a receipt is read when you open it.
      </Footnote>

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

const semName = (s: string) => (s === '1' ? 'Odd' : s === '2' ? 'Even' : /^\d+$/.test(s) ? `Term ${s}` : s);

/** What each semester asked, what was paid, and what is left (the ERP's "My SEM Fee Structure"). */
function FeeLedger({ ledger }: { ledger: LedgerRow[] }) {
  const rows = [...ledger].sort((a, b) => b.academicYear.localeCompare(a.academicYear) || b.semester.localeCompare(a.semester));
  return (
    <section aria-label="Semester fees" className="mt-7">
      <h2 className="h2 mb-4">Semester fees</h2>
      <ul className="grid items-start gap-2.5 md:grid-cols-2">
        {rows.map((r, i) => {
          const due = r.due ?? 0;
          const tone = due > 0 ? 'condonation' : due < 0 ? 'none' : 'safe';
          const label = due > 0 ? `${money(due)} due` : due < 0 ? `${money(-due)} extra paid` : 'Settled';
          return (
            <li key={`${r.academicYear}-${r.semester}`} className="card rise p-4 sm:p-5" style={{ '--i': i } as React.CSSProperties}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">
                    Year {r.studyYear} · {semName(r.semester)}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-fg-3 tnum">{r.academicYear}</p>
                </div>
                <span data-tone={tone} className="chip">
                  <span className="dot" aria-hidden />
                  {label}
                </span>
              </div>
              <dl className="mt-3.5 grid grid-cols-3 gap-2 text-[12px]">
                {(
                  [
                    ['Fee', r.gross],
                    ['Concession', r.concession],
                    ['Paid', r.paid],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-[12px] bg-white/[0.035] px-2.5 py-2 hair">
                    <dt className="text-fg-3">{k}</dt>
                    <dd className={cn('mt-0.5 text-[14px] font-semibold tnum', k === 'Concession' && 'text-fg-2')}>
                      {v == null ? '—' : `${k === 'Concession' && v > 0 ? '−' : ''}${money(v)}`}
                    </dd>
                  </div>
                ))}
              </dl>
              {r.receipts.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 hair-t pt-3 text-[12px] text-fg-2">
                  {r.receipts.map((x, j) => (
                    <li key={`${x.date}-${j}`} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="tnum">{fmtDate(x.date)}</span>
                        {x.receiptNo && <span className="mono ml-2 text-fg-3">{x.receiptNo}</span>}
                      </span>
                      <span className="shrink-0 font-semibold text-fg tnum">{x.amount != null ? money(x.amount) : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
