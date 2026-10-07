import type { emptyPartner as Ru } from '../ru/emptyPartner';
import type { Translation } from '../types';

export const emptyPartner: Translation<typeof Ru> = {
  'emptyPartner.contact.mig': 'Write to MIG',
  'emptyPartner.contact.chat': 'Write to us',
  'emptyPartner.contact.subject': 'Question about the partner cabinet',

  'emptyPartner.clinic.prices.title': 'No price list yet',
  'emptyPartner.clinic.prices.why': 'MIG loads the clinic price list when the clinic joins the VHI network, or your MIS sends it through the integration API.',
  'emptyPartner.clinic.prices.next': 'Responsible: MIG {role}. If the clinic is connected but there is no price list, write to MIG.',
  'emptyPartner.clinic.acts.title': 'No reconciliation acts yet',
  'emptyPartner.clinic.acts.why': 'A reconciliation act is made for a monthly register once MIG or the assistance company has reviewed it and recorded the payment.',
  'emptyPartner.clinic.acts.next': 'First a register has to be built and submitted — the {role} does this.',
  'emptyPartner.clinic.acts.open': 'Go to registers',

  'emptyPartner.clinic.registries.why': 'The monthly register is built from visits opened after a patient check, or uploaded from CSV. No register has been created yet.',
  'emptyPartner.clinic.registries.next': 'Pick a period and build the register from visits, or upload a CSV using the template — once submitted, MIG or the assistance company reviews it. Responsible: {role}.',
  'emptyPartner.clinic.registries.build': 'Build the register from visits',
  'emptyPartner.clinic.registries.template': 'Download the CSV template',

  'emptyPartner.clinic.gp.why': 'A guarantee letter is requested from a visit when a service needs approval. There have been no requests yet.',
  'emptyPartner.clinic.gp.next': 'Check the patient, open the visit and request the letter. The patient’s assistance company or MIG decides.',
  'emptyPartner.clinic.gp.check': 'Start with a patient check',

  'emptyPartner.keys.why': 'An API key connects the {system} to the MIG API. No key has been created yet.',
  'emptyPartner.keys.next': 'The {role} creates keys; the secret is shown once — save it right away.',
  'emptyPartner.keys.create': 'Create the first key',
  'emptyPartner.webhooks.why': 'Until an address is added, MIG does not notify your system of events — it only learns of them by calling the API.',
  'emptyPartner.webhooks.next': 'The {role} adds the webhook address.',
  'emptyPartner.webhooks.create': 'Set an address',
  'emptyPartner.webhooks.deliveriesWhy': 'Deliveries appear after the first event once at least one webhook address is added.',

  'emptyPartner.users.title': 'No users yet',
  'emptyPartner.users.why': 'Staff sign in to the cabinet by invitation only.',
  'emptyPartner.users.next': 'The {role} invites: enter the email and role — the sign-in link arrives by email.',
  'emptyPartner.users.invite': 'Invite the first colleague',

  'emptyPartner.assist.lines.why': 'Invoice lines come from reviewed clinic registers and fees under the contract with MIG for the period. There are none for this period.',
  'emptyPartner.assist.lines.next': 'The MIG {role} sets up the terms of the contract with MIG; if lines are missing, write to MIG.',
  'emptyPartner.assist.cases.why': 'Cases are created from calls and chats of your clients’ insured persons, and from clinic escalations.',
  'emptyPartner.assist.cases.next': 'To open a case from a call, find the insured person and press «New case» — the {role} does this.',
  'emptyPartner.assist.cases.find': 'Find an insured person',
  'emptyPartner.assist.registries.why': 'Sub-registers arrive when clinics that served your insured persons submit their monthly register.',
  'emptyPartner.assist.registries.next': 'The {role} submits the register; the {checker} reviews it and records the payment.',
  'emptyPartner.assist.rebills.why': 'The monthly invoice to MIG is built from reviewed and paid clinic registers and contract fees.',
  'emptyPartner.assist.rebills.next': 'The {role} builds and sends the invoice.',
  'emptyPartner.assist.rebills.build': 'Build the first invoice',
  'emptyPartner.assist.gp.why': 'Clinics request guarantee letters from a patient’s visit, operators from a case. There have been no requests for your clients yet.',
  'emptyPartner.assist.gp.next': 'The {role} decides within their authority; anything above goes to MIG.',

  'emptyPartner.app.certificate.why': 'The certificate is issued with the policy after your employer signs and pays the contract.',
  'emptyPartner.app.certificate.next': 'Responsible: your company’s HR — ask them when your cover starts.',
  'emptyPartner.app.claims.why': 'Paid for a visit or medicines yourself? Take a photo of the receipt — MIG refunds it within your limit.',
  'emptyPartner.app.appointments.why': 'Book a clinic in the VHI network — the appointment appears here and the clinic confirms the time.',
  'emptyPartner.app.family.why': 'A spouse, children or parents are added to the policy on request: send it here and your company’s HR reviews it.',
  'emptyPartner.app.family.request': 'Make a request',
  'emptyPartner.app.familyRequests.why': 'Your requests for family members and their status will appear here.',
};
