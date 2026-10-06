/* Portfolio transfer files: templates, parsing, row checks per file, the reference order, reconciliation. */
import { describe, expect, it } from 'vitest';
import type { MigrationStep } from '@/shared/types/migration';
import { MIGRATION_COLUMNS, MIGRATION_STEPS, contractPremiumCheck, emptyDbRefs, insuredPremium, loadedTotals, migrationTemplateCsv, parseMigrationCsv, pinflMatchesBirthDate, reconcile, stepAvailable, validateBatch, type RawRow } from './migration';

const DATE = '2026-10-01';
const rowsOf = (step: MigrationStep, csv: string): RawRow[] => {
  const p = parseMigrationCsv(step, csv);
  if ('error' in p) throw new Error(p.error);
  return p.rows;
};
const templates = Object.fromEntries(MIGRATION_STEPS.map((s) => [s, rowsOf(s, migrationTemplateCsv(s))])) as Record<MigrationStep, RawRow[]>;
const keys = (issues: { field: string; message: string; level: string }[]) => issues.map((i) => `${i.level}:${i.field}:${i.message.split('|')[0]}`);

describe('templates', () => {
  it('have the header and one example row; together they form a valid batch', () => {
    for (const s of MIGRATION_STEPS) {
      const lines = migrationTemplateCsv(s).trim().split('\r\n');
      expect(lines[0]).toBe(MIGRATION_COLUMNS[s].join(','));
      expect(lines).toHaveLength(2);
    }
    const res = validateBatch({ migrationDate: DATE, files: templates }, emptyDbRefs());
    for (const s of MIGRATION_STEPS) expect(res[s]!.errorRows, s).toBe(0);
    expect(res.limits!.valid[0]!.ref.insured).toEqual({ batch: 2 });
  });

  it('read back cells guarded against CSV injection and refuse files without required columns', () => {
    const csv = "pinfl,oldCertificate,category,usedAmount\r\n,'-C-1,outpatient,100\r\n";
    expect(rowsOf('limits', csv)[0]!.oldCertificate).toBe('-C-1');
    expect(parseMigrationCsv('clients', 'name,stir\nAcme,123\n')).toEqual({ error: expect.stringContaining('migration.v.missingColumns') });
    expect(parseMigrationCsv('limits', 'pinfl,oldCertificate,category,usedAmount\n')).toEqual({ error: 'migration.v.emptyFile' });
  });
});

describe('row checks by file', () => {
  const run = (step: MigrationStep, patch: Record<string, string>, files: Partial<Record<MigrationStep, RawRow[]>> = {}) => {
    const all = { ...templates, ...files, [step]: [{ ...templates[step][0]!, ...patch }] };
    const upto = MIGRATION_STEPS.slice(0, MIGRATION_STEPS.indexOf(step) + 1);
    return validateBatch({ migrationDate: DATE, files: Object.fromEntries(upto.map((s) => [s, all[s]])) }, emptyDbRefs())[step]!;
  };

  it('clients: Latin names, STIR, bank details, HR contact', () => {
    const r = run('clients', { name: 'ООО Ромашка', stir: '12345', account: '123', hrEmail: 'nope', legalForm: 'ooo' });
    expect(keys(r.issues)).toEqual(['error:name:migration.v.latin', 'error:legalForm:migration.v.legalForm', 'error:stir:v.innFormat', 'error:account:v.accountFormat', 'error:hrEmail:v.emailInvalid']);
    expect(r.issues.every((i) => i.row === 2)).toBe(true);
    expect(keys(run('clients', { name: 'Example Trade LLC' }).issues)).toEqual(['warning:name:migration.v.nameHasForm']);
  });

  it('contracts: term, plan, premium, client reference', () => {
    expect(keys(run('contracts', { program: 'gold', premium: '-5' }).issues)).toEqual(['error:program:migration.v.program', 'error:premium:migration.v.money']);
    expect(keys(run('contracts', { endDate: '2026-01-01' }).issues)).toEqual(['error:endDate:v.endAfterStart']);
    expect(keys(run('contracts', { clientStir: '309999999' }).issues)).toEqual(['error:clientStir:migration.v.clientNotFound']);
    expect(keys(run('contracts', { endDate: '2026-09-30' }).issues)).toEqual(['error:endDate:migration.v.contractExpired']);
  });

  it('insured: Latin full name, PINFL, phone, inclusion within the term', () => {
    expect(keys(run('insured', { fullName: 'Иванов Иван', pinfl: '123' }).issues)).toEqual(['error:fullName:migration.v.latinPerson', 'error:pinfl:v.pinflFormat']);
    expect(keys(run('insured', { inclusionDate: '2025-01-01' }).issues)).toEqual(['error:inclusionDate:migration.v.outsideTerm']);
    expect(keys(run('insured', { phone: '' }).issues)).toEqual(['warning:phone:migration.v.noPhone']);
    expect(pinflMatchesBirthDate('31405880123456', '1988-05-14')).toBe(true);
    expect(keys(run('insured', { birthDate: '1990-01-01' }).issues)).toEqual(['warning:pinfl:migration.v.pinflBirthDate']);
  });

  it('limits: a person by PINFL or certificate, the category, not above the plan limit', () => {
    expect(keys(run('limits', { usedAmount: '99000000' }).issues)).toEqual(['error:usedAmount:migration.v.overLimit']);
    expect(keys(run('limits', { usedAmount: '10500000' }).issues)).toEqual(['warning:usedAmount:migration.v.limitExhausted']);
    expect(keys(run('limits', { pinfl: '', oldCertificate: '' }).issues)).toEqual(['error:pinfl:migration.v.insuredRefRequired']);
    expect(keys(run('limits', { oldCertificate: 'C-OTHER' }).issues)).toEqual([]);
    expect(keys(run('limits', { pinfl: '', oldCertificate: 'C-OTHER' }).issues)).toEqual(['error:oldCertificate:migration.v.insuredNotFound']);
  });

  it('claims: open statuses only, service date, reserve', () => {
    expect(keys(run('claims', { status: 'paid' }).issues)).toEqual(['error:status:migration.v.openStatus']);
    expect(keys(run('claims', { serviceDate: '2026-10-05', reserve: '900000' }).issues)).toEqual(['error:serviceDate:migration.v.serviceAfterMigration', 'warning:reserve:migration.v.reserveOverClaimed']);
  });

  it('invoices: unpaid only, due date, contract reference', () => {
    expect(keys(run('invoices', { paid: '31250000' }).issues)).toEqual(['error:paid:migration.v.invoicePaid']);
    expect(keys(run('invoices', { contractOldNumber: 'X-1' }).issues)).toEqual(['error:contractOldNumber:migration.v.contractNotFound', 'warning:dueDate:migration.v.overdue']);
  });

  it('repeats inside a file are errors with the first row', () => {
    const r = validateBatch({ migrationDate: DATE, files: { clients: [templates.clients[0]!, templates.clients[0]!] } }, emptyDbRefs()).clients!;
    expect(r.issues).toEqual([{ row: 3, field: 'stir', level: 'error', message: 'migration.v.repeatedInFile|{"row":2}' }]);
    expect(r.valid.map((v) => v.row)).toEqual([2]);
  });
});

describe('reference order', () => {
  it('a row refers to error-free rows of earlier files, then to the database', () => {
    const badClient = { ...templates.clients[0]!, mfo: '1' };
    const res = validateBatch({ migrationDate: DATE, files: { clients: [badClient], contracts: templates.contracts } }, emptyDbRefs());
    expect(keys(res.contracts!.issues)).toEqual(['error:clientStir:migration.v.clientNotFound']);
    const refs = emptyDbRefs();
    refs.clients.set('301234567', { id: 'db-client', hasActivePolicy: true });
    const viaDb = validateBatch({ migrationDate: DATE, files: { contracts: templates.contracts } }, refs).contracts!;
    expect(viaDb.valid[0]!.ref.client).toEqual({ db: 'db-client' });
    expect(keys(viaDb.issues)).toEqual(['warning:clientStir:migration.v.clientHasPolicy']);
    // The same client both in the file and in the system: the file row is an error, the contract falls back to the system.
    const both = validateBatch({ migrationDate: DATE, files: { clients: templates.clients, contracts: templates.contracts } }, refs);
    expect(keys(both.clients!.issues)).toEqual(['error:stir:migration.v.clientExists']);
    expect(both.contracts!.valid[0]!.ref.client).toEqual({ db: 'db-client' });
  });

  it('insured persons refer to transferred contracts already in force', () => {
    const refs = emptyDbRefs();
    refs.contracts.set('MIG-2026/0458', { id: 'db-contract', program: 'standard', startDate: '2026-03-01', endDate: '2027-02-28', active: true, premiumEmployee: 4_000_000, premiumFamily: 3_000_000 });
    const viaDb = validateBatch({ migrationDate: DATE, files: { insured: templates.insured } }, refs).insured!.valid[0]!.ref;
    // The premium by type comes from the contract in the system; no per-contract check for contracts outside the batch.
    expect(viaDb).toEqual({ contract: { db: 'db-contract' }, premium: 7_000_000, premiumSource: 'type' });
    refs.contracts.set('MIG-2026/0458', { id: 'db-contract', program: 'standard', startDate: '2026-03-01', endDate: '2027-02-28', active: false, premiumEmployee: 4_000_000, premiumFamily: 3_000_000 });
    expect(validateBatch({ migrationDate: DATE, files: { insured: templates.insured } }, refs).insured!.errorRows).toBe(1);
  });

  it('a step waits for every earlier step to be confirmed or skipped', () => {
    expect(stepAvailable({}, 'clients')).toBe(true);
    expect(stepAvailable({ clients: 'validated' }, 'contracts')).toBe(false);
    expect(stepAvailable({ clients: 'skipped', contracts: 'confirmed' }, 'insured')).toBe(true);
    expect(stepAvailable({ clients: 'confirmed' }, 'insured')).toBe(false);
  });
});

describe('reconciliation', () => {
  it('compares the files with what is loaded and shows the excluded rows', () => {
    const res = validateBatch({ migrationDate: DATE, files: { ...templates, claims: [templates.claims[0]!, { ...templates.claims[0]!, oldNumber: 'CL-2', status: 'paid', reserve: '400000' }] } }, emptyDbRefs());
    const planned = reconcile(res, null);
    expect(planned.find((r) => r.metric === 'reserves')).toEqual({ metric: 'reserves', money: true, file: 1_250_000, excluded: 400_000, loaded: 850_000, match: false });
    expect(planned.find((r) => r.metric === 'premium')).toMatchObject({ file: 6_300_000, loaded: 6_300_000, match: true });
    const loaded = loadedTotals({ clients: 1, contracts: [{ total: 6_300_000 }], insured: 1, limitsUsed: 1_250_000, claims: [{ reserve: 850_000 }], invoices: [{ amount: 31_250_000, paid: 0 }] });
    const after = reconcile(res, loaded);
    expect(after.filter((r) => !r.match).map((r) => r.metric)).toEqual(['claims', 'reserves']);
    expect(after.find((r) => r.metric === 'invoicesOutstanding')).toMatchObject({ file: 31_250_000, loaded: 31_250_000, match: true });
  });
});

describe('premiums of insured persons', () => {
  const contract = (patch: Record<string, string>) => [{ ...templates.contracts[0]!, ...patch }];
  const person = (n: number, patch: Record<string, string>) => ({
    ...templates.insured[0]!,
    pinfl: `3140588012345${n}`,
    phone: `+99890111223${n}`,
    oldCertificate: `C-0458-000${n}`,
    ...patch,
  });
  const run = (contracts: RawRow[], insured: RawRow[]) => validateBatch({ migrationDate: DATE, files: { clients: templates.clients, contracts, insured } }, emptyDbRefs());

  it('priority: the individual premium, else by type (employee plus family members), else none', () => {
    const byType = { premiumEmployee: 4_000_000, premiumFamily: 3_000_000 };
    expect(insuredPremium({ premium: 5_500_000, familyMembers: 2 }, byType)).toEqual({ premium: 5_500_000, source: 'individual' });
    expect(insuredPremium({ premium: undefined, familyMembers: 2 }, byType)).toEqual({ premium: 10_000_000, source: 'type' });
    expect(insuredPremium({ premium: undefined, familyMembers: 0 }, { premiumEmployee: 4_000_000 })).toEqual({ premium: 4_000_000, source: 'type' });
    // Family members without a family premium, or no premium by type at all: no premium.
    expect(insuredPremium({ premium: undefined, familyMembers: 1 }, { premiumEmployee: 4_000_000 })).toBeNull();
    expect(insuredPremium({ premium: undefined, familyMembers: 0 }, {})).toBeNull();
    expect(insuredPremium({ premium: 2_000_000, familyMembers: 0 }, {})).toEqual({ premium: 2_000_000, source: 'individual' });
  });

  it('a contract without premiums by type is valid; each of its insured rows without an own premium is an error', () => {
    const res = run(contract({ premium_employee: '', premium_family: '', premium: '9000000' }), [person(1, { premium: '9000000' }), person(2, { premium: '' })]);
    expect(res.contracts!.errorRows).toBe(0);
    expect(res.insured!.issues.filter((i) => i.level === 'error')).toEqual([{ row: 3, field: 'premium', level: 'error', message: 'migration.v.noPremium' }]);
    expect(res.insured!.valid.map((v) => [v.row, v.ref.premium, v.ref.premiumSource])).toEqual([[2, 9_000_000, 'individual']]);
    // The row with the error is excluded: the contract's check counts the rows to be written only.
    expect(res.contractPremiums).toEqual([{ oldNumber: 'MIG-2026/0458', total: 9_000_000, insured: 1, individual: 1, insuredSum: 9_000_000, diff: 0, match: true }]);
    // Premiums by type: bad values are errors of the contract row.
    expect(keys(run(contract({ premium_employee: 'abc', premium_family: '-1' }), []).contracts!.issues)).toEqual(['error:premium_employee:migration.v.money', 'error:premium_family:migration.v.money']);
    expect(keys(run(contract({ premium_employee: '0' }), []).contracts!.issues)).toEqual(['error:premium_employee:v.min']);
    expect(keys(run(contract({}), [person(1, { premium: '0' })]).insured!.issues)).toEqual(['error:premium:v.min']);
  });

  it('per contract: the sum of insured premiums equals the total premium within ±1 сум, else a warning before applying', () => {
    // Template: employee 3 500 000 + one family member 2 800 000 = 6 300 000, the contract's total.
    expect(run(templates.contracts, templates.insured).contractPremiums).toEqual([{ oldNumber: 'MIG-2026/0458', total: 6_300_000, insured: 1, individual: 0, insuredSum: 6_300_000, diff: 0, match: true }]);
    for (const [total, match] of [['6300001', true], ['6299999', true], ['6300002', false], ['6299998', false]] as const) {
      const res = run(contract({ premium: total }), templates.insured);
      expect(res.contractPremiums![0]!.match, total).toBe(match);
      expect(res.insured!.issues.some((i) => i.message.startsWith('migration.v.premiumMismatch')), total).toBe(!match);
    }
    const off = run(contract({ premium: '7000000' }), [person(1, {}), person(2, { premium: '1000000', familyMembers: '0' })]);
    expect(off.contractPremiums![0]).toMatchObject({ insured: 2, individual: 1, insuredSum: 7_300_000, diff: 300_000, match: false });
    expect(off.insured!.issues).toEqual([{ row: 2, field: 'premium', level: 'warning', message: 'migration.v.premiumMismatch|{"contract":"MIG-2026/0458","sum":"7 300 000","total":"7 000 000"}' }]);
    // A warning does not exclude rows.
    expect(off.insured!.valid).toHaveLength(2);
  });

  it('contractPremiumCheck sums by contract and keeps the new number', () => {
    const c = contractPremiumCheck({ oldNumber: 'X-1', number: 'DMS-D-2026-000001', total: 100 }, [
      { premium: 60, source: 'type' },
      { premium: 39, source: 'individual' },
    ]);
    expect(c).toEqual({ oldNumber: 'X-1', number: 'DMS-D-2026-000001', total: 100, insured: 2, individual: 1, insuredSum: 99, diff: -1, match: true });
    expect(contractPremiumCheck({ oldNumber: 'X-2', total: 100 }, []).match).toBe(false);
  });
});
