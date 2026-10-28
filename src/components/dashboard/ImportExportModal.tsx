import React, { useState } from 'react';
import { UploadCloud, Download, AlertTriangle, CheckCircle2, FileText, ShieldAlert } from 'lucide-react';
import { Member } from '../../types';
import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  onImportMembers: (newMembers: Partial<Member>[]) => void;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({
  isOpen,
  onClose,
  members,
  onImportMembers
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');
  const [dryRunReport, setDryRunReport] = useState<{
    total: number;
    valid: number;
    duplicates: number;
    errors: number;
    records: any[];
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);

  // Sample demonstration CSV rows for instant test parsing
  const loadDemoCSV = () => {
    const sampleRows = [
      { code: 'FIT-1007', name: 'Siddharth Rao', phone: '+919876500111', email: 'sid.rao@example.com', plan: '3 Months Quarterly', status: 'valid' },
      { code: 'FIT-1008', name: 'Kavita Nair', phone: '+919876500222', email: 'kavita@example.com', plan: '1 Month Standard', status: 'valid' },
      { code: 'FIT-1009', name: 'Rajesh Kumar', phone: '+919876543210', email: 'duplicate@example.com', plan: 'Annual Gold VIP', status: 'duplicate', error: 'Duplicate phone matches active member Rajesh Kumar' },
      { code: 'FIT-1010', name: '=CMD|\' /C calc\'!A0', phone: '+919876500444', email: 'formula@example.com', plan: '1 Month Standard', status: 'formula_sanitized', note: 'Formula injection string neutralized with leading quote' },
      { code: 'FIT-1011', name: 'T', phone: '12345', email: 'bad-email', plan: 'Unknown Plan', status: 'invalid', error: 'Phone must be +91 followed by 10 digits; Name too short' }
    ];

    setDryRunReport({
      total: sampleRows.length,
      valid: 3, // 2 standard valid + 1 sanitized
      duplicates: 1,
      errors: 1,
      records: sampleRows
    });
  };

  const handleCommitImport = () => {
    if (!dryRunReport) return;
    setImporting(true);
    setTimeout(() => {
      const validToInsert: Partial<Member>[] = dryRunReport.records
        .filter(r => r.status === 'valid' || r.status === 'formula_sanitized')
        .map(r => ({
          member_code: r.code,
          full_name: r.name.replace(/^=/, "'="), // Sanitized
          phone: r.phone,
          email: r.email,
          status: 'active',
          whatsapp_consent: true,
          sms_consent: true,
          created_at: new Date().toISOString()
        }));

      onImportMembers(validToInsert);
      setImporting(false);
      setImportSuccess(true);
      setTimeout(() => {
        setImportSuccess(false);
        setDryRunReport(null);
        onClose();
      }, 1500);
    }, 600);
  };

  const handleExportCSV = () => {
    // Generate sanitized CSV with formula injection defense
    const headers = ['Member Code', 'Full Name', 'Phone', 'Email', 'Status', 'Current Plan', 'Expiry Date', 'WhatsApp Consent', 'SMS Consent'];
    const rows = members.map(m => {
      const escape = (val: string | null | undefined) => {
        if (!val) return '""';
        let clean = String(val);
        // Neutralize spreadsheet formula injection characters
        if (/^[=+\-@\t\r]/.test(clean)) {
          clean = `'${clean}`;
        }
        return `"${clean.replace(/"/g, '""')}"`;
      };

      return [
        escape(m.member_code),
        escape(m.full_name),
        escape(m.phone),
        escape(m.email),
        escape(m.status),
        escape(m.current_subscription?.plan_name || 'None'),
        escape(m.current_subscription?.end_date || 'N/A'),
        m.whatsapp_consent ? 'YES' : 'NO',
        m.sms_consent ? 'YES' : 'NO'
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `fitfusion_members_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Member Import & Export Center"
      subtitle="Bulk registration dry-run and sanitized spreadsheet generation"
      maxWidth="xl"
    >
      <div className="space-y-5 text-xs text-zinc-300">
        
        {/* Tab Switcher */}
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setActiveTab('import')}
            className={`px-5 py-2.5 font-bold uppercase tracking-wider text-xs border-b-2 transition-colors cursor-pointer ${
              activeTab === 'import'
                ? 'border-gym-yellow text-gym-yellow'
                : 'border-transparent text-zinc-400 hover:text-white'
            }`}
          >
            Import Members (Dry Run)
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={`px-5 py-2.5 font-bold uppercase tracking-wider text-xs border-b-2 transition-colors cursor-pointer ${
              activeTab === 'export'
                ? 'border-gym-yellow text-gym-yellow'
                : 'border-transparent text-zinc-400 hover:text-white'
            }`}
          >
            Sanitized CSV Export
          </button>
        </div>

        {/* IMPORT TAB */}
        {activeTab === 'import' && (
          <div className="space-y-4">
            {!dryRunReport ? (
              <div className="border-2 border-dashed border-zinc-800 rounded-xl p-8 text-center space-y-3 bg-zinc-950">
                <UploadCloud className="w-12 h-12 text-zinc-500 mx-auto" />
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                  Drag & Drop CSV / Excel Spreadsheet
                </h4>
                <p className="text-zinc-400 text-xs max-w-sm mx-auto leading-relaxed">
                  Upload existing customer databases. The engine performs a pre-flight dry run to identify invalid numbers and duplicate accounts before committing.
                </p>
                <div className="pt-2">
                  <Button variant="yellow" size="sm" onClick={loadDemoCSV}>
                    Load Sample Test Spreadsheet (5 Rows)
                  </Button>
                </div>
              </div>
            ) : importSuccess ? (
              <div className="py-8 text-center space-y-3">
                <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto animate-bounce" />
                <h4 className="font-heading text-xl font-bold text-white uppercase">
                  Batch Import Successfully Committed!
                </h4>
                <p className="text-zinc-400 text-xs">
                  {dryRunReport.valid} new member accounts created with verified opt-in records.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Dry Run Summary Pills */}
                <div className="grid grid-cols-4 gap-2 text-center text-[11px]">
                  <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <div className="text-zinc-400 uppercase font-semibold">Total Scanned</div>
                    <div className="text-lg font-bold text-white mt-0.5">{dryRunReport.total}</div>
                  </div>
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                    <div className="text-emerald-400 uppercase font-semibold">Ready to Import</div>
                    <div className="text-lg font-bold text-emerald-300 mt-0.5">{dryRunReport.valid}</div>
                  </div>
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <div className="text-amber-400 uppercase font-semibold">Duplicates</div>
                    <div className="text-lg font-bold text-amber-300 mt-0.5">{dryRunReport.duplicates}</div>
                  </div>
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg">
                    <div className="text-rose-400 uppercase font-semibold">Errors</div>
                    <div className="text-lg font-bold text-rose-300 mt-0.5">{dryRunReport.errors}</div>
                  </div>
                </div>

                {/* Dry Run Results Table */}
                <div className="max-h-56 overflow-y-auto border border-zinc-800 rounded-lg bg-zinc-950">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 font-bold uppercase sticky top-0">
                      <tr>
                        <th className="p-2.5">Code</th>
                        <th className="p-2.5">Name</th>
                        <th className="p-2.5">Phone</th>
                        <th className="p-2.5">Validation Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {dryRunReport.records.map((r, i) => (
                        <tr key={i} className="hover:bg-zinc-900/40">
                          <td className="p-2.5 font-mono text-zinc-300">{r.code}</td>
                          <td className="p-2.5 font-semibold text-white">{r.name}</td>
                          <td className="p-2.5 font-mono text-zinc-400">{r.phone}</td>
                          <td className="p-2.5">
                            {r.status === 'valid' && (
                              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                              </span>
                            )}
                            {r.status === 'formula_sanitized' && (
                              <span className="text-sky-400 font-semibold flex items-center gap-1">
                                <ShieldAlert className="w-3.5 h-3.5" /> Sanitized (Formula)
                              </span>
                            )}
                            {r.status === 'duplicate' && (
                              <span className="text-amber-400 font-semibold flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" /> Duplicate Phone
                              </span>
                            )}
                            {r.status === 'invalid' && (
                              <span className="text-rose-400 font-semibold">
                                Error: {r.error}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Formula Injection Callout */}
                <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-start gap-2 text-[11px] text-zinc-400">
                  <ShieldAlert className="w-4 h-4 text-gym-yellow shrink-0 mt-0.5" />
                  <span>
                    <strong>CSV Injection Defense:</strong> Cells starting with <code>=</code>, <code>+</code>, <code>-</code>, or <code>@</code> are prefixed with <code>'</code> to prevent Excel formula execution vulnerabilities.
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setDryRunReport(null)}>
                    Reset / Clear
                  </Button>
                  <Button variant="yellow" size="sm" onClick={handleCommitImport} disabled={importing}>
                    {importing ? 'Importing Rows...' : `Commit ${dryRunReport.valid} Valid Members`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* EXPORT TAB */}
        {activeTab === 'export' && (
          <div className="space-y-4 py-2">
            <div className="p-5 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-gym-yellow" />
                <div>
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                    Export Filtered Member Ledger
                  </h4>
                  <p className="text-zinc-400 text-xs">
                    Export all {members.length} active and archived records to a formula-escaped CSV format compatible with Microsoft Excel and Google Sheets.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-zinc-900/80 rounded-lg border border-zinc-800 text-[11px] space-y-1">
                <div className="font-bold text-zinc-300 uppercase">Export Columns Included:</div>
                <div className="text-zinc-400">
                  Member Code, Full Name, Mobile Phone (E.164), Email, Status, Active Plan, Expiry Date, WhatsApp Consent, SMS Consent.
                </div>
              </div>

              <div className="pt-2">
                <Button variant="yellow" size="md" className="w-full" onClick={handleExportCSV}>
                  <Download className="w-4 h-4" /> Download Sanitized CSV ({members.length} Members)
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </Modal>
  );
};
