// @vitest-environment node
/*
 * Legal names in generated documents: always in the document's own language (formatLegalName),
 * never in the interface language.
 */
import { describe, expect, it } from 'vitest';
import type { CertificateView, ContractView, EndorsementView } from '@/shared/types/dto';
import type { DocLang } from '@/shared/config/legalForms';
import { setLocale } from '@/i18n';
import { certificateDocument, contractDocument, endorsementDocument } from './builders';
import { renderStubDocument } from './render';
import { escapeHtml } from './html';

const NAME = 'Toshkent Agrologistika';

const contract = {
  number: 'DMS-D-2026-000123',
  createdAt: '2026-09-01T09:00:00+05:00',
  version: 1,
  params: {
    startDate: '2027-01-01',
    endDate: '2027-12-31',
    activationRule: 'on_start_date',
    paymentFrequency: 'quarterly',
    clientSignatory: { name: 'Sobirov Akmal Ravshanovich', position: 'Director', basis: 'Charter' },
    program: 'standard',
    premiumEmployee: 1_000,
    premiumFamily: 500,
    total: 1_500,
    employees: 1,
    familyMembers: 1,
    paymentSchedule: [],
  },
  client: { name: NAME, legalForm: 'llc', inn: '301234567' },
  migSignatory: null,
  clauseOverrides: [],
  signing: {},
  insuredRows: [],
} as unknown as ContractView;

const endorsement = {
  number: 'DS-1/DMS-D-2026-000123',
  contractNumber: 'DMS-D-2026-000123',
  kind: 'changes',
  createdAt: '2026-09-10T09:00:00+05:00',
  clientName: NAME,
  clientLegalForm: 'llc',
  clientSignatoryName: 'Sobirov Akmal Ravshanovich',
  migSignatory: null,
  requests: [],
  lines: [],
  total: 0,
  clauseOverrides: [],
  signing: {},
} as unknown as EndorsementView;

const EXPECTED: Record<DocLang, { client: string; mig: string }> = {
  ru: { client: `ООО «${NAME}»`, mig: 'АО «Mosaic Insurance Group»' },
  uz: { client: `«${NAME}» MChJ`, mig: '«Mosaic Insurance Group» AJ' },
  en: { client: `${NAME} LLC`, mig: 'Mosaic Insurance Group JSC' },
};

describe('legal names in documents', () => {
  for (const lang of ['ru', 'uz', 'en'] as const) {
    it(`contract and endorsement in ${lang} print the parties with the ${lang} legal form`, () => {
      const c = contractDocument(contract, { lang });
      expect(c.values['client.name']).toBe(EXPECTED[lang].client);
      expect(c.values['mig.name']).toBe(EXPECTED[lang].mig);
      const e = endorsementDocument(endorsement, { lang });
      expect(e.values['client.name']).toBe(EXPECTED[lang].client);
      expect(e.values['mig.name']).toBe(EXPECTED[lang].mig);
    });
  }

  it('defaults to the Russian document whatever the interface language is', () => {
    setLocale('en');
    try {
      expect(contractDocument(contract).values['client.name']).toBe(`ООО «${NAME}»`);
      expect(endorsementDocument(endorsement).values['client.name']).toBe(`ООО «${NAME}»`);
    } finally {
      setLocale('ru');
    }
  });

  it('the rendered contract contains the full legal name of the client', () => {
    const html = renderStubDocument(contractDocument(contract)).pagesHtml.join('\n');
    expect(html).toContain(escapeHtml(`ООО «${NAME}»`));
    expect(html).not.toContain('llc «');
  });

  it('the certificate prints the client and the assistance company with their forms, and «MIG» as is', () => {
    const cert: CertificateView = {
      insuredId: '00000000-0000-4000-8000-000000000001',
      fullName: 'Sobirov Akmal Ravshanovich',
      certificateNumber: 'SERT-2026-000001-0001',
      insuredFrom: '2027-01-01',
      policyNumber: 'DMS-2026-000001',
      policyEndDate: '2027-12-31',
      program: 'standard',
      clientName: NAME,
      clientLegalForm: 'llc',
      contractNumber: 'DMS-D-2026-000123',
      assistanceName: 'Med Assist Servis',
      assistanceLegalForm: 'jv_llc',
      assistancePhone: '+998 71 200 00 00',
    };
    const v = certificateDocument(cert).values;
    expect(v['client.name']).toBe(`ООО «${NAME}»`);
    expect(v['assistance.name']).toBe('СП ООО «Med Assist Servis»');
    const mig = certificateDocument({ ...cert, assistanceName: 'MIG', assistanceLegalForm: undefined }).values;
    expect(mig['assistance.name']).toBe('MIG');
  });
});
