<!-- Translation pending MIG review. Help markup (not shown): "{#anchor}" after a heading is its stable Latin anchor, never renamed; "audience: ..." comments say who may read a part (src/shared/help/audience.ts). Both are kept exactly as in USER_GUIDE.ru.md. -->

# MIG VHI System User Guide

Version 1.0 · 07.10.2026 · Translation pending MIG review

## 1. About the system {#about}

<!-- audience: all -->

The MIG VHI system brings all participants of voluntary health insurance into one web application: MIG, client companies, their employees and family members, clinics and assistance companies. Everyone works in their own portal and sees only what their role allows.

| Portal | Address | Who works there | What for |
| --- | --- | --- | --- |
| MIG portal | `/staff` | MIG staff: sales, underwriting, lawyers, claims settlement, medical experts, accounting, administrators | Clients and deals, quotes, commercial proposals, contracts, policies, claims, invoices, reports, system settings |
| Assistance portal | `/assist` | Staff of assistance companies | Call centre, doctor appointments, guarantee letters, review of clinic registers, payments to clinics, invoices to MIG |
| Clinic portal | `/clinic` | Reception and management of partner clinics | Patient check, appointments, guarantee letters, registers, connecting the clinic's own medical system |
| HR portal | `/hr` | Responsible staff of client companies | Lists of employees and family members, commercial proposals and contracts to sign, invoices, documents, statistics |
| Insured person's app | `/app` | Client employees and their family members | Policy and certificate, limits, doctor appointments, reimbursement for a receipt, the “Is it covered?” question, chat |

**How the portals are connected.** All of them share one database. An action in one portal is immediately visible in the others: an insured person books a doctor — the request appears at the clinic and at the assistance company; HR adds an employee — the employee gets access to the app and the assistance company sees them in its list; a clinic submits a register — the lines go to the payer for review.

**The main access principle.** Everyone sees only their own: an insured person — their policy and their children, HR — the employees of their company without medical data, a clinic — a patient only after checking the patient's policy, an assistance company — only the insured persons of its clients, a MIG employee — what their role needs. Viewing personal and medical data is recorded in the audit log.

**How to read this guide.** Sections 5–12 describe the business processes step by step, from a new client to payouts. Sections 13–14 cover what each role does in its portal. Sections 15–16 are for administrators. Section 17 covers what to do in typical situations. Sections 18–19 contain the security rules and the status reference. The document describes a prototype of the system with fictitious data; button names are given as in the English interface.

## 2. Getting started {#getting-started}

<!-- audience: all -->

MIG staff, HR, clinics and assistance companies sign in with an email, a password and a one-time code; insured persons sign in with a phone number and an SMS code.

### Signing in {#login}

<!-- audience: all -->

1. **Staff and partners.** Open the system address, enter your work email and password, then the 6-digit second-factor code (MFA). The code can be pasted in full from the clipboard.
   On the first sign-in the system asks you to set up the second factor: the “Set up the second factor” screen shows a QR code — scan it with an authenticator app (Google Authenticator, Microsoft Authenticator or another) or enter the key manually via “Cannot scan it?”, then enter the 6-digit code from the app. From then on the code always comes from that app.
2. **Insured persons.** Open the app, enter your phone number in the format +998 XX XXX XX XX, tap “Get code” and enter the code from the SMS. On the first sign-in you need to give consent to the processing of personal data.
3. **Adult family members** (spouse, parents) sign in with their own phone number. Children under the age limit are visible in a parent's app and do not have a separate sign-in.
4. After 5 wrong attempts within 10 minutes, sign-in is blocked for 5 minutes. The error message does not say what exactly is wrong — this protects against guessing.

### First sign-in by invitation {#invitation}

<!-- audience: staff hr clinic assist -->

A new account with an e-mail (a MIG employee, a client's HR, a clinic or assistance user) is created by an administrator — the system itself sends the e-mail “Invitation to the Mosaic Insurance Group DMS system”.

1. Open the link from the e-mail in full. The “Invitation to MIG DMS” screen shows which account it is for (the address is partly hidden) and until when it is valid.
2. Enter a new password — at least 12 characters, with letters and digits — and repeat it → “Set password”.
3. “Password set” → “Go to sign-in”: sign in with the e-mail and the new password. At the first sign-in, connect an authenticator app (the “Sign-in” section above).
4. The link works once and is valid for 3 days (the “Invitation validity” parameter). If you see “The link does not work”, the password is already set, the link is out of date or was replaced with a new one: ask the administrator to press “Send again”. The previous link then stops working.

### The portal screen {#portal-screen}

<!-- audience: all -->

- **Side panel on the left** — sections grouped by purpose: “Work”, “Sales and underwriting”, “Claims settlement”, “Partners”, “Finance”, “Reports”, “Administration”. Only the sections available to your role are visible. The number on the right shows how many tasks are waiting in the section.
- **Hide or show the panel** — the button in the top left corner or Ctrl+B (⌘+B on a Mac). When the panel is hidden, hover over the button and the panel slides out over the content; a click pins it. You can change the panel width by dragging its right edge; a double click on the edge restores the normal width. The system remembers your choice.
- **Search** — the field at the top or Ctrl+K. It finds clients by name and STIR (TIN), policies and contracts by number (including the old numbers of transferred contracts), insured persons by full name, claims by number, as well as menu sections. You can type in Cyrillic: “Ташкент” finds “Toshkent”.
- **“+ Create”** — the button at the top right or the C key. Shows what your role can create. Grey items are created automatically — a hint explains where they come from.
- **Language** — the RU / UZ / EN button at the top or the user menu at the bottom of the panel. The interface language changes; company names, full names and document numbers do not, and documents (commercial proposals, contracts) have their own choice of language.
- **User menu** — at the bottom of the panel: profile, language, “Sign out”.
- **The “MFA · VPN” indicator** at the top shows that the sign-in is protected.

### Tables and cards {#tables}

<!-- audience: all -->

- A click on a column header sorts, the buttons above the table filter. The row with the column names stays visible while scrolling.
- A click on a row opens a card on the right. The ↑ and ↓ arrows switch between records, Enter opens the full card, Esc closes it. The table stays available meanwhile.
- Side columns — the card on the right, the dashboard blocks (“Needs attention”, “Integrations”), the data and history of full cards, the document preview of the commercial proposal and contract editors — do not move when the page scrolls. A long column scrolls by itself: its header and buttons stay in place, and the heading of the current section stays under the column header until the whole section has scrolled by. On a screen narrower than 1280 pixels the card opens over the table, and the other columns move below the main content.
- The “Columns” button hides unneeded columns, “Export to CSV” downloads the table (without PINFL, phone numbers and diagnoses).

### Hints in empty sections {#empty-hints}

<!-- audience: all -->

When a list, tab or section is empty because the data has not been entered yet, the system does not say “No data” but shows the next step:

- **why it is empty** — taking the stage and status into account (for a lead: “Insured persons appear once the contract is in force”);
- **what to do and who is responsible** — the role name;
- **an action button** if you can do it yourself: it leads straight to the right place with the form open (e.g. choosing the assessment data or appendix 2 file), next to it “Download the template” if a file is expected;
- **“Ask {role}”** if another employee is responsible: the request with your comment goes to the responsible person (the manager of the deal or client, the underwriter of the quote), or, without one, to everyone with that role. It appears in the queue on the dashboard, tab “Tasks from colleagues”, and in the executor’s bell. On the object the button is replaced by the plaque “Request … sent {date} — {to}, {status}”, and the request itself is in your “My requests” tab (section “Requests to colleagues”); <!-- audience: staff hr -->
- **“Request from HR”** if the client must provide the data: the task appears in the HR cabinet under “Tasks from MIG”. If the client has no cabinet yet (a lead before the commercial proposal), a ready letter with the CSV template opens — copy the text and send it from your mailbox; <!-- audience: staff -->
- **“More in the help”** — the section of the guide about this step.

If the list is empty because of filters or search, “Nothing found” is shown as before.

### The notification bell {#notifications}

<!-- audience: all -->

The bell in the top bar is in every portal. The number on it is how many notifications you have not read yet.

- **What comes:** a new request to you (“{Author} asks: {what} — {object}”), an answer to your request (taken, done, rejected — with the executor’s comment), “The request is due tomorrow”, “The request is overdue” and the author’s reminders.
- **Missed deadlines** (they come by themselves, once per breach; again only after a new deadline): “Claim …: the review deadline has passed” and “Claim …: the appeal review is overdue” — to claims officers, “Claim …: the doctor’s opinion is overdue” — to medical experts; “Guarantee letter …: the decision is overdue” — to MIG medical experts or to the doctors of the assistance company that decides the letter; “Clinic … did not answer an appointment request in time” — to MIG operators or to the operators of the assistance company serving the person; “Case …: the SLA is breached” — to the assistance company’s operators and doctors and to MIG operators. <!-- audience: staff assist -->
- **Sales** (to the deal manager, once while nothing changes): “No activity on the deal for N days”, “No answer to offer … for N days”, “Renewal deal … opened”. <!-- audience: staff -->
- **A click on a notification** opens the object — the deal, contract, client card or the form where an action is needed — and marks that notification read.
- **“Mark all as read”** at the top of the list clears the counter.

### Requests to colleagues and “My requests” {#requests}

<!-- audience: staff -->

A request asks a colleague to take a step that you cannot: for example, the underwriter asks the manager to upload the assessment data. Requests are sent with the “Ask {role}” and “Request from HR” buttons in empty sections and in the deal checklist.

- **Who gets it.** The person responsible for the object: the manager of the deal or client, the underwriter of the quote. Without one, everyone with the role sees the request; the first to click “Take” becomes the executor, and the row disappears for the others.
- **One request at a time.** While a request is open, the object shows the plaque “Request … sent {date} — {to}, {status}” instead of the button, and the same request about the same object cannot be sent.
- **Response time** — “DMS parameters” has two, both marked “demo value”: “Internal request response time” — between MIG employees (demo: 2 working days), and “Client response time to a MIG request” — for requests to HR (demo: 5 working days). A day before the deadline and when it is overdue both the executor and the author are notified. An overdue request is red for both.
- **“Remind”.** Once the deadline has passed, the plaque and “My requests” show “Remind”: the executor gets the notification again and the request’s history gets a mark.
- **History.** Sending the request and every change of its status are written to the deal’s “Events” and the client’s “Activity”.

**Executor.** The request is in the dashboard queue, tab “Tasks from colleagues”. The row has “Take”, “Open” and “Reject” (a comment is required; the author sees it). A taken request closes by itself when the action is done (for example, the assessment data is uploaded), or by hand — “Mark as done” with a comment.

**Author.** The dashboard has the “My requests” tab: what, to whom, about which object, when it was sent, the deadline, the status (waiting, in progress, done, rejected) and the executor’s comment.

### Help {#using-help}

<!-- audience: all -->

The help opens from “Help” at the bottom of the side panel, from “?” in the top bar (right on the article about the current screen) or, in the app, from “Help” in the profile. You see only the articles available to your role.

- **One field at the top — “Find a term or ask a question”.** As you type, the results appear under the field: “Terms” and “Articles”, the match highlighted.
- **The first row of the list — “Ask: “…””.** It gives a step-by-step answer: a short answer, steps, warnings, “More” links to the subsections and “Open the section” buttons. Under the answer — “Helpful” or “Not helpful”.
- **A question is answered by itself.** If the text looks like a question — ends with “?”, starts with “how”, “where”, “what”, “who”, “why”, “when”, “can” (also the Russian and Uzbek question words) or is longer than five words — the answer appears a moment after you pause typing, as a card above the results. A short query (“STIR”, “PINFL”) only searches.
- **Keyboard:** ↑ and ↓ move through the rows, Enter on a row opens it, Enter with no row chosen asks, Esc closes the list.
- **If there is no answer**, the help says so honestly — “The help has no answer to this question” — and offers to write to the coordinator (or the support of your portal).
- **If answers are switched off by the administrator**, there is no “Ask” row; the search works.
- **“Download PDF”** — the whole help or the current article, only the sections available to your role.
- **Ctrl+K** in the MIG portal: the first row of the “Help” group is “Ask the help: “…””; it opens the help with the answer ready. <!-- audience: staff -->

### Session {#session}

<!-- audience: all -->

After inactivity the system ends the session: for MIG, clinic and assistance staff after 15 minutes (a warning appears 2 minutes before), for HR and insured persons after 30 minutes. Signing out in one tab ends the session in all tabs.

## 3. Glossary of terms and abbreviations {#glossary}

<!-- audience: all -->

The main terms and abbreviations of the system; in parentheses — how they appear in the Russian and Uzbek interface, where different.

| Term | What it means |
| --- | --- |
| **Minimum group size** | The smallest number of a company's employees for which MIG concludes a DMS contract (demo: 10). Below it a quote is approved only as an exception with a comment, and a contract without the exception is not signed. |
| **Underwriter** | A MIG employee who assesses the risk, calculates the price (the quote) and approves the financial terms of the contract. |
| **Appeal** | A challenge of a claim decision by the insured person or a clinic. It is reviewed by a claims officer. |
| **Assistance, assistance company** | A MIG partner that runs a 24/7 call centre, books doctor appointments, issues guarantee letters, reviews clinic registers, pays clinics and invoices MIG for reimbursement. Each assistance company serves the clients assigned to it. |
| **Audit, audit log** | A record of all important actions: who did or viewed what, and when. Visible to the MIG administrator. |
| **Visit** | A clinic's 24-hour “pass” to a patient's data. It opens only when the clinic has checked the patient's policy by QR code, short code or policy number with PINFL. |
| **GL — guarantee letter** | A confirmation from MIG or the assistance company to a clinic that an expensive service (MRI, hospitalisation, etc.) will be paid, with the amount and validity period. |
| **VHI — voluntary health insurance** (ДМС, ITS) | Voluntary health insurance. |
| **Contract** | The VHI contract between MIG and a client company. It consists of the main text and annexes: the plan, the member list, the payment schedule and, if needed, a rate table. |
| **Endorsement** (ДС, qoʻshimcha kelishuv) | A change to an active contract: inclusion or exclusion of people, a plan change, termination. It contains the calculation of the additional premium or refund. |
| **Insured person** | A person covered by the policy: a client employee or a member of their family. |
| **Change request** | A single change of the members or terms (for example, “include an employee from 15.10”). Change requests accumulate and are formalised by an endorsement. |
| **Limit change** | A request to increase an insured person's limit. Created by the coordinator or an underwriter, confirmed by another underwriter. |
| **AI coverage check** | A hint on whether a service or a medicine is covered. The plan rules decide; AI only recognises the wording and explains the answer. A denial is always made by a person. |
| **KPI** | Performance indicators, for example the average response time of an assistance company or the share of decisions made on time. |
| **Commercial proposal** (КП, tijorat taklifi) | An offer to the client: a letter with the calculation and the plan brochure. It is sent only for an approved quote. |
| **Quote** | The underwriter's calculation of the insurance price using the MIG rate, based on data about the client's employees. |
| **VHI coordinator** (куратор ДМС, ITS kuratori) | A MIG employee who monitors the quality of the assistance companies' work, handles complaints and escalations, and manages appointments of clients without an assistance company. |
| **Lead** | A potential client who has no contract yet. |
| **Limit** | The maximum amount the plan pays for an insured person per category (doctors and tests, dentistry, medicines, inpatient care) during the policy term. “Running low” means less than the threshold from the parameters is left (demo: 20%). |
| **MIS — medical information system** (МИС, TAT) | A clinic's medical information system — its own software, which can be connected to the system via API. |
| **ICD-10** | The International Classification of Diseases; the diagnosis code in guarantee letters and registers. |
| **MFA** | Sign-in with two factors: a password plus a one-time code. |
| **PINFL** (ПИНФЛ, JShShIR) | The personal identification number of an individual, 14 digits. It is shown masked in the system. |
| **Signatory** | A MIG employee with a power of attorney who has the right to sign contracts and endorsements on behalf of MIG. |
| **Policy** | Active insurance under a contract. It is issued automatically after the contract is signed and paid. |
| **Authority limits** | An employee's personal limit: for example, the underwriter's maximum discount or the amount of a claim decision. Above the authority limits an approval is required. |
| **Insurance plan** | A set of covers and limits: Basic, Standard, Standard+, Premium, GOLD (demo set). |
| **Register, sub-register** | The monthly list of services provided by a clinic. The system splits it into sub-registers by payer — the assistance companies and MIG. |
| **Reserve** | The amount MIG sets aside for a reported but not yet settled claim. |
| **Deal** | The client's path from a lead to an active policy, or a renewal. |
| **Certificate** | The insured person's document with a personal number, available in the app and to HR. |
| **SLA** | The time within which a task must be done (for example, the clinic's response to an appointment). Overdue items are highlighted. |
| **Policyholder** (страхователь, sugʻurta qildiruvchi) | The client company that has concluded the contract. |
| **TIN / STIR** (ИНН) | The taxpayer identification number of an organisation. |
| **Assistance invoice** (rebilling) | The monthly invoice of an assistance company to MIG: amounts paid to clinics plus the assistance company's fee. |
| **Claim** (убыток, zarar) | A request for payment of medical services: reimbursement for a receipt, a clinic invoice, a line of an assistance invoice. |
| **Loss ratio** (убыточность, zararlilik darajasi) | The ratio of payouts to premium, in per cent. Above 80% it is highlighted. |
| **Claims settlement** | Reviewing a claim and deciding: pay in full, pay in part or deny. |
| **Four eyes** | The rule that an important action is performed by one employee and confirmed by another (for example, an assistance invoice is accepted by a claims officer and paid by an accountant). |
| **Claims Officer** | A MIG claims settlement specialist. |
| **E-IMZO, e-signature** (ЭЦП, ERI) | The electronic digital signature of Uzbekistan. |
| **EDI — electronic document interchange** (ЭДО, EHA) | Electronic document exchange through an operator (for example, Didox). |
| **IBNR** | The reserve for incurred but not yet reported claims. It is calculated by an actuary outside the system. |
| **PEPM** | A fee model of an assistance company: a fixed amount per insured person per month. |
| **pro rata** | A calculation in proportion to the days remaining in the contract term. |

The full list of terms in three languages is kept in the repository glossary `docs/i18n-glossary.md`.

## 4. Roles and permissions {#roles}

<!-- audience: staff -->

The system has 16 roles in five portals. A role determines which sections are visible and which actions are available; the check is done on the server, so a direct link to someone else's section leads to the “No access” page.

### MIG staff {#roles-staff}

<!-- audience: staff -->

| Role | Main task | What it does not see or do |
| --- | --- | --- |
| Sales manager | Leads, deals, data collection, sending commercial proposals and contracts, monitoring signing and payment, preparing endorsements | Does not approve the price and does not sign for MIG (unless a signatory) |
| Underwriter | Quotes, price, financial terms of contracts and endorsements, confirming limit changes, assigning the assistance company | Does not see individual claims — only the aggregate loss ratio |
| Lawyer | Approval of contracts and endorsements with changed clauses, checking scans | Does not see claims or medical data |
| VHI coordinator | Monitoring assistance companies, complaints, escalations, appointments of clients without an assistance company | Does not make claim decisions |
| Claims officer | Registering claims, decisions with a reference to a contract clause, reserves, fraud, appeals, reviewing assistance invoices | Decisions above personal authority limits go for approval |
| Medical expert | Medical opinions, guarantee letters above the assistance company's authority, medical records for a reason, control sample | Does not decide on a claim — only gives an opinion |
| Accountant | Invoices, payments, 1C statement, manual payment matching, paying assistance and clinic invoices | Cannot pay an invoice they accepted themselves |
| MIG administrator | Users, authority limits, parameters, partners, integrations, AI, audit, portfolio transfer | No access to medical data or claim decisions |

### External participants {#roles-external}

<!-- audience: staff -->

| Role | Main task | Restrictions |
| --- | --- | --- |
| Client company HR | Employees and family members, app requests, commercial proposals and contracts to sign, invoices, statistics | Own company only; does not see employees' diagnoses, visits or claims; statistics show only groups of 10 people or more |
| Insured person | Own policy, limits, appointments, reimbursement, chat, children's data | Does not see data of adult family members without their consent |
| Clinic registrar | Patient check, appointments, guarantee letter requests | Cannot search the insured persons database; does not see limit amounts or the history of visits |
| Clinic administrator | The same, plus registers, documents, clinic users, integration | Own clinic only |
| Assistance operator | Cases, appointments, chat, search among its own insured persons | Only insured persons of its own clients as of the event date |
| Assistance doctor | Guarantee letters within the assistance company's authority, review of register lines, medical records for a reason | Above the authority — escalation to MIG |
| Assistance finance officer | Clinic sub-registers, payments to clinics, invoices to MIG | — |
| Assistance administrator | Users and integration of the assistance company | — |

### General rules {#roles-rules}

<!-- audience: staff -->

- **Employee authority limits.** Underwriters and claims officers have personal limits (discount, decision amount). An action above the limit automatically goes for approval to an employee of the same role with higher authority limits.
- **Four eyes.** You cannot confirm your own limit change request, both accept and pay an assistance invoice, or single-handedly change parameters or authority limits or apply a portfolio transfer.
- **Personal data** (PINFL, phone, date of birth) are shown masked. The full value is revealed with the “Show” button, with a reason, for 30 seconds, and is recorded in the audit log.
- **Medical records** are opened only to a medical expert (of MIG or of an assistance company), with a reason, for 15 minutes.

## 5. New client: from lead to contract {#new-client}

<!-- audience: staff hr -->

A new client goes through eight deal stages: lead → census data → quote → commercial proposal → contract → signing → payment → policy. Each document is created from the previous one, so figures are never entered twice. The progress of a deal is visible on the “Deals” board and in the steps at the top of its card.

### Stage 1. Lead {#lead}

<!-- audience: staff -->

**Who:** sales manager.

1. “+ Create” → “Client (lead)”, or “Clients” → “+ New client”.
2. Fill in: the official name **in Latin script, as in the register, without quotation marks**; the legal form (MChJ, AJ, QK MChJ, XK, YaTT…) — it is selected separately; STIR; bank details; the director and the basis of their authority; the HR contact; the approximate headcount; the current insurer.
3. In the client card, click “Create deal”.

If nothing happens with a lead for a long time (demo: 7 days), a reminder appears in the manager's queue.

**Companies only.** DMS is for employees of companies that are MIG clients and their family members. The sole proprietor form (YaTT) is not allowed by default: such a lead is not saved and the «Form» field explains why. The list of allowed forms is set by the «Allowed legal forms of the policyholder» parameter (needs a MIG decision). If the approximate headcount is below the minimum (demo: 10 employees), a warning appears under the field — the lead can be saved, but its quote will only be approved as an exception.

### Stage 2. Census data {#census}

<!-- audience: staff -->

**Who:** manager.

1. In the deal card, open the “Census data” stage and download the CSV template.
2. The client fills in for each person: sex, year of birth, type (employee, spouse, child).
3. Upload the file. The system shows the distribution by age group, the share of men and women, and the average age.

At this stage **names, PINFL and phone numbers are not needed** — if they are in the file, the system discards them and warns you.

### Stage 3. Quote {#quote}

<!-- audience: staff -->

**Who:** underwriter.

1. In the deal, open the quote calculator and choose the plan.
2. The system calculates the premium using the MIG rate: the plan's base rate × the age group coefficient, with a group size discount (all values are in “VHI parameters”).
3. If needed, add a loading or a discount — a comment is mandatory.
4. The result: premium per employee, per family member and in total.
5. If the discount or the premium is above your authority limits, the quote goes for approval to the head of underwriting. Otherwise click “Approve”.

### Stage 4. Commercial proposal {#kp}

<!-- audience: staff hr -->

<!-- audience: staff -->
**Who:** manager or underwriter. A commercial proposal can be sent **only for an approved quote**.

1. Click “Prepare proposal” in the deal, in the client card or in the dashboard queue.
2. The form is already filled in from the quote and the client data: plan, language (RU or EN), cover option, sum insured, premiums, headcount, insurance period, validity of the offer (demo: 30 days), payment terms, assistance company.
3. On the right is a preview of 17 pages: the cover, the offer letter with the calculation, 15 pages of the plan brochure. The brochure texts are approved and cannot be edited.
4. “Save draft” or “Save and send to the client”. A sent proposal appears in the client's HR portal.
5. “Download PDF” opens the print dialog — choose “Save as PDF”.

<!-- /audience -->

**The client's answer.** HR clicks “Accept” or “Reject” (with a reason) in their portal. If the client answered by letter, the manager records the decision manually. If there is no answer for more than 5 days (demo), the manager gets a reminder. To change a sent proposal, use “Create new version”.

### Stage 5. Contract {#contract}

<!-- audience: staff -->

**Who:** manager, lawyer, underwriter.

1. After the commercial proposal is accepted, the “Prepare the contract” button appears in the deal. The contract is created from the proposal.
2. In the editor on the left are the parameters: dates, plan, premiums, payment schedule (single payment, quarterly or monthly), the rule of entry into force (from the start date or after the first payment), signatories of both parties, the way the premium is calculated for people included in mid-term (by type or by age scale).
3. Annex 2 — the member list: uploaded by the manager in the import format or by HR in their portal (on a “Request from HR” task). Without appendix 2 the contract cannot be sent for approval.
4. On the right is a preview of all pages.
5. **Changing a clause.** Each clause has an “Edit wording” button. A changed clause is highlighted next to the original text, and the contract **must go to the lawyer**. The lawyer approves it or returns it with a comment. Without changes the lawyer stage is skipped.
6. If the financial terms differ from the approved quote, they are approved by the underwriter.
7. “Send to client” — the contract appears in the HR portal (without internal fields: the lawyer's comments, the quote, the version history).
8. To change a sent contract, click “New version” — the signatures are reset.

Next come signing, payment and policy issue (section 6).

### Minimum group size and allowed forms {#min-group}

<!-- audience: staff -->

Parameters of the «Clients» group in «DMS parameters» (all marked «demo value»):

- **Minimum group size** — demo: 10.
- **Family members in the minimum** — no by default: only employees count.
- **Allowed legal forms of the policyholder** — all except YaTT (sole proprietor); marked «needs a MIG decision».
- **Group fell below the minimum during the term** — «notify» by default (a task for the underwriter and the manager); no automatic termination.

Where it is checked:

1. **Lead:** a disallowed form is not saved; a headcount below the minimum gives a warning.
2. **Data for assessment:** the «Employees N of the minimum M» plaque; below the minimum it is red.
3. **Quote:** below the minimum it cannot be approved within authority — only «Submit for approval». An employee with the exception authority (demo: the head of underwriting) approves it, and only with a mandatory comment «Why the exception is made». The exception is shown in the quote: who, when and why.
4. **Contract:** before signing, the system counts the employees in appendix 2. If they are below the minimum and no exception is approved in the quote, a red plaque is shown at the top and the contract cannot be signed.

The server checks the thresholds and forms too, not only the screen.

### What the next stage needs {#stage-checklist}

<!-- audience: staff -->

At every stage the deal card has the block “What the next stage needs”: what is required, whether it is done, who is responsible and the action button (or “Ask {role}” when another employee is responsible, and “Request from HR” when the client provides the data).

- **Lead, assessment data:** the assessment data (manager).
- **Quote:** calculation and approval of the quote (underwriter).
- **Commercial proposal sent:** the client’s reply (client HR).
- **Commercial proposal accepted:** the draft contract (manager).
- **Contract:** client details (TIN, basis of authority), appendix 2, signatories of both parties; underwriter approval — only if the terms differ from the quote; lawyer approval — if clauses were changed (after sending for approval).
- **Signing:** the client’s and MIG’s signatures. **Awaiting payment:** the first installment.

While a required item is not done, the deal cannot move to the next stage: the transition button (“Calculate the quote”, “Send the commercial proposal”, “Send for approval”) is disabled and says “Missing: …” under it. The server checks the same.

### Requesting data from HR {#request-hr}

<!-- audience: staff hr -->

<!-- audience: staff -->
**Who:** manager or underwriter. “Request from HR” is in an empty appendix 2, in the assessment data, in the “Insured” tab of the client card and in the deal checklist.

1. If the client already has an HR cabinet (it opens when the commercial proposal is sent), write a comment and click “Send the request”. The response time is the “Client response time to a MIG request” parameter (demo: 5 working days); the request is in your “My requests”.
2. If there is no cabinet yet, a letter to the client opens: copy the text, open your mail and attach the CSV template. Upload the received file yourself.
3. When HR completes the task you are notified (the bell in the top bar) and the checklist item becomes done.
<!-- /audience -->

<!-- audience: hr -->
**Client HR.** The home page of the cabinet shows the block “Tasks from MIG”, e.g. “Upload the list of employees for contract … by 15.10”. “Upload the list” uploads the file right there (template — “Download the template”); other tasks are marked with “Done”. Once done the task disappears and the MIG manager is notified.
<!-- /audience -->

## 6. Signing, payment and policy issue {#signing}

<!-- audience: staff hr -->

A contract is considered signed when the signatures of **both parties** are counted — by any of the four methods, which can be combined. After payment the policy and certificates are issued automatically.

### Four signing methods {#signing-methods}

<!-- audience: staff hr -->

| Method | How MIG signs | How the client signs | When the signature is counted |
| --- | --- | --- | --- |
| E-signature (E-IMZO) | The signatory in the portal: “Sign with e-signature” → choose the key → key password | HR in the portal in the same way | Immediately after signing |
| EDI (Didox, etc.) | “Send via EDI” → choose the operator | The client signs at the EDI operator | When the “signed” event arrives from the operator |
| Paper | “Print two copies” → “Signed by MIG” → “Sent to the client” with a date | Signs the original and returns it | When a MIG employee has marked “Client original received” or checked the scan |
| Scan | Upload a scan of the signed document | HR uploads the scan in the portal (PDF, JPEG, PNG up to 20 MB) | Only after a MIG employee has clicked “Scan checked” |

Important:

- **Only an employee with signing authority** (a signatory) can sign for MIG. For others the button is unavailable. <!-- audience: staff -->
- If at least one party signed on paper or by scan, the system waits for the **original**. After 30 days without the “Original received” mark, the manager gets a reminder. This does not block the contract.
- A typical combination: the client sends a scan now and the original by courier later.
- In the prototype, e-signature and EDI are simulated. In the production system the e-signature works through the E-IMZO application on the user's computer.

### Payment {#payment}

<!-- audience: staff hr -->

1. After signing, the system itself creates invoices according to the payment schedule. They are visible to the MIG accountant and to the client's HR.
2. The accountant records the payment manually or uploads a statement from 1C (details in section 12).
3. Partial payment is allowed. An overdue instalment triggers a reminder to the manager and the accountant.

### Entry into force {#effective-date}

<!-- audience: staff hr -->

The contract becomes active according to its rule: “from the start date” or “from the start date, but not before the first instalment is paid” (the second is the default). At the same time the deal moves to the “Active” status and the client to “Active client”. The transition is made by the night job (00:05) or by the first opening of the contract after the date — once; the audit log gets “Contract took effect”.

### Issue of the policy and certificates {#policy-issue}

<!-- audience: staff hr -->

When the contract enters into force, the system automatically:

1. Creates the policy with a link to the contract and the selected assistance company.
2. Creates the insured persons from Annex 2 — each employee and each family member separately.
3. Assigns each of them a certificate number and generates the certificate.
4. Sends the insured persons SMS invitations to the app.
5. Passes the member list to the assistance company.

HR sees the policy and the list of people and can download certificates one by one or all at once for printing. The insured person sees their certificate in the app: “Profile” → “My certificate”.

**A policy is never created manually.** If you need to enter a contract that is already active in the old system, use the portfolio transfer (section 16).

## 7. Contract servicing {#servicing}

<!-- audience: staff hr insured -->

Any change to an active contract — a new employee, a dismissal, a child, a plan change — first becomes a change request and is then formalised by an endorsement with the calculation of the additional premium or refund.

### Including and excluding employees {#enrolment}

<!-- audience: staff hr -->

1. **HR** in the portal: “Employees” → “+ Add employee” (full name in Latin script, date of birth, PINFL, phone, position, start date) or “Upload from CSV” (up to 1,000 rows, with a preview of errors first). For a dismissal — the row menu → “Exclude from date…”.
2. Each HR action creates a **change request** with a date.
3. **A new employee is covered from the date of the HR request** (by default), without waiting for the endorsement to be signed. An excluded person loses cover from the exclusion date; in the app they see “Policy ended”.
4. The assistance company immediately sees the changes in its list of insured persons.

### Group below the minimum during the term {#below-min-term}

<!-- audience: staff hr -->

If HR excludes an employee and the insured group falls below the minimum, a warning «Under the contract the minimum group size is M» appears before confirmation. The exclusion is allowed: the request goes to MIG as usual, and the underwriter and the manager get the task «Group below the minimum after an exclusion» — they decide what to do with the contract terms. There is no automatic termination. If MIG sets the parameter to «Forbid such an exclusion», the request is not sent and HR sees an explanation.

### Family members {#family}

<!-- audience: staff hr insured -->

Family members are insured persons just like employees, with their own certificate, QR code, limits, claims and appointments.

- **Added by HR:** “Family” → “Add a family member” (full name in Latin script, date of birth, PINFL, relationship: spouse, child, parent, other; to which employee).
- **Requested by the employee:** in the app, “My family” → “Add” with consent. The request goes to HR into the “App requests” section. HR approves it (this creates a change request) or rejects it with a reason.
- **The child age limit** is 18 years, for students 23 years (demo values in “VHI parameters”). When a child reaches it, the underwriter gets the request “A child has reached the age limit: {client}” from “System” — with the age, the date and a link to the insured person’s card, once per child (for a student once more at the student limit); nobody is excluded automatically.
- **Privacy within the family:** an employee sees everything about their children. About an adult family member — only the fact of insurance, the certificate and the QR code, until that person turns on “Allow … to see my claims” in their own app. The permission can be withdrawn.
- **Limits** are individual for each person (the default mode) or shared by the family — a setting in “VHI parameters”.

### Endorsement {#endorsement}

<!-- audience: staff -->

**Who:** sales manager; the underwriter approves the amounts.

1. Change requests accumulate in the “Member list changes” / “Endorsements” section. By default an endorsement is prepared **once a month** for all requests (it can be set to “For each change”).
2. The system calculates each line and shows the formula:
   - **Inclusion** under a “by type” contract: premium per employee (or per family member) × remaining days ÷ days of the term.
   - **Inclusion** under a “by age scale” contract: the rate of the person's age group on the inclusion date from the contract rate table × remaining days ÷ days of the term.
   - **Exclusion:** a refund by the rule from the parameters — pro rata to the remaining days, pro rata minus the payouts for this person (the default), or no refund.
   - **Plan change:** the premium difference for the remaining term.
3. A positive total is an additional premium, a negative one is a refund.
4. If standard clauses are changed in the endorsement, the lawyer must approve it. Signing uses the same four methods as the contract (section 6). After signing, an invoice for the additional premium or a refund document is created.

### Renewal {#renewal}

<!-- audience: staff -->

1. 60 days before the policy expires (a parameter), the system creates a **renewal deal** (the “Lead” stage, one per policy) and notifies the client’s manager; the underwriter sees the renewal in the queue as “Renewal without proposal”. If a renewal proposal was sent earlier, the deal is created from it and there will be no second one.
2. The underwriter looks at the client's aggregate loss ratio (the “Loss ratio” page — aggregates only) and prepares a new quote and commercial proposal.
3. Then it is the same as for a new client: commercial proposal → contract → signing → payment → new policy.
4. If the renewal is not completed, the day after the end date the contract and the policy move to the “Expired” status (the night job; the audit log gets “Contract expired” and “Policy expired” by “System”).

### Early termination {#termination}

<!-- audience: staff -->

1. In the contract card — “Terminate”: date and reason.
2. The system generates a “termination” endorsement with a refund by the rule from the parameters.
3. After signing, the policy is closed, the insured persons lose cover, and the assistance company is notified.

## 8. Medical services {#medical}

<!-- audience: staff insured clinic assist -->

An insured person gets care in three ways: books a doctor at a partner clinic, gets an expensive service under a guarantee letter, or pays themselves and gets the money back for a receipt.

### Doctor appointment {#appointment}

<!-- audience: staff insured clinic assist -->

1. **Insured person:** “Book a doctor” → specialty → a day and a clinic with free time → “Book”. If the category limit is almost used up, a warning appears at the top. In the app you can choose who the appointment is for: yourself or a child.
2. **The clinic** sees the request in the “Appointments” section and answers: “Confirm”, “Offer another time” or “Reject” with a reason.
3. **The insured person** sees “Confirmed by the clinic” or the offered time, which they can accept.
4. If the clinic has not answered in time (demo: 2 hours), the request is escalated to the insured person's **assistance company**, and for clients without an assistance company — to the MIG coordinator.
5. You can also book by phone: the assistance operator creates an appointment from a case.

### Guarantee letter {#guarantee-letter}

<!-- audience: staff clinic assist -->

1. **The clinic** checks the patient (QR, code or policy with PINFL) — a visit opens.
2. From the visit — “Request a guarantee letter”: a service from the price list, an ICD-10 code, the cost, the doctor's comment, attachments (referral, medical report). The “Coverage check” block immediately suggests whether the service is covered.
3. The request goes to the payer:
   - the insured person's **assistance company**: if the amount is within its authority (demo: UZS 10 million), the assistance doctor decides; above it — escalates to MIG;
   - **the MIG medical expert**: decides on escalations and on letters of clients without an assistance company. Letters above the threshold (demo: UZS 20 million) require the approval of two doctors.
4. The decision: approve (amount and validity period), reject (reason) or request documents. The clinic sees it in the “Guarantee letters” section.
5. **The approved amount immediately reserves the insured person's limit**: the app and the clinic see the reduced balance.

### Reimbursement for a receipt {#receipt-refund}

<!-- audience: staff insured assist -->

1. **Insured person:** “Get money back for a receipt” → a photo of the receipt (up to 5 photos, up to 10 MB each). The system itself removes the geolocation from the photo and recognises the place, the amount, the date and the fiscal data.
2. Each receipt item gets a label: “refund”, “no refund” (for example, vitamins without a prescription, cosmetics) or “to be checked”, and the “expected reimbursement” amount is shown. “No refund” items are removed with one button.
3. Choose the category (“Medicines”, “Doctor visit”, “Tests”, “Dentistry”), check and “Send”.
4. The reimbursement is reviewed by the insured person's assistance company (if under the contract the assistance company handles reimbursements) or by a MIG claims officer.
5. The insured person sees the status in steps: “Received” → “Checking” → “Approved” → “Money on your card”, or “Denied” with a reason in plain language and a “Dispute” button.
6. The money goes to the employee's card; an adult family member can specify their own card.

### “Is it covered?” — AI check {#coverage-check}

<!-- audience: staff insured clinic assist -->

- **In the app:** the “Is it covered?” tile → write the service or the medicine in your own words (“Knee MRI”, “Aquadetrim”). The answer: “Most likely covered”, “A guarantee letter is needed — the clinic will request it”, “Not covered by your plan” or “Specialist review needed”, with the plan clause and the remaining limit. The “Ask the assistance” button opens a chat with the question.
- **At the clinic:** in the guarantee letter, and the “Check rows” button in the register before submitting.
- **For specialists:** the “AI hint” block in the claim card and the guarantee letter card; “AI pre-check” in the assistance invoice.
- **Important:** cover is determined by the plan rules. AI only recognises the wording and explains the answer. The answer in the app is preliminary; **a denial is always made by a person**. Specialists mark “Agree” or “Disagree” — this is how accuracy is measured. The administrator can turn off AI everywhere instantly.

## 9. Clinics and registers {#clinics}

<!-- audience: staff clinic assist -->

A clinic submits one register a month; the system itself splits it by payer, each payer reviews and pays its own lines, and the clinic sees the status of each line.

### Patient check — where any clinic work begins {#patient-check}

<!-- audience: staff clinic -->

A clinic **cannot search** the database of insured persons. It receives data about a person only after checking that person's policy:

1. “Check a patient” on the home page of the clinic portal.
2. One of the methods:
   - **camera** — “Scan with camera” and point it at the QR code in the patient's app;
   - **barcode scanner** at the reception — simply scan the QR code, the field is already in focus;
   - **manually** — the 8-character short code under the QR code in the app, or the policy number and PINFL.
3. The result: full name and year of birth (to compare with the ID document), the plan, the policy number and term, and for each service category — “covered”, “guarantee letter required” or “not covered”, plus the limit state: “available”, “running low”, “exhausted”. **Limit amounts and the history of visits are not shown to the clinic.**
4. A **visit for 24 hours** opens — only with it can you request a guarantee letter or include services in the register.

The QR code in the app is single-use and refreshes every 60 seconds. If the patient shows an old screenshot, the system answers “The code has expired” — ask them to refresh the card. Checks by policy and PINFL are limited (no more than 30 per hour per user; after 10 failed checks in a row — a 15-minute pause).

### Monthly register {#monthly-registry}

<!-- audience: staff clinic assist -->

**Who:** clinic administrator.

1. “Registers” → the register of the current month. It can be filled in two ways: assembled from the month's visits or uploaded as a CSV using the template (up to 5,000 rows, up to 5 MB).
2. A register line: patient, date, service code and name, ICD-10, quantity, price, amount, guarantee letter number (if the service requires one).
3. Before submitting, the system checks: the price is not higher than the price list of the contract with the payer, the guarantee letter number is given where needed, the service date is within the policy term. The “Check rows” button highlights the lines that are likely to be rejected.
4. “Send”. The system splits the register into **sub-registers** by payer: each line goes to the assistance company to which the patient's policy was assigned on the service date, and if there is no assistance company — to MIG.
5. The payer reviews the lines: “accepted” or “rejected” with a reason. An accepted line finally deducts the patient's limit and releases the guarantee letter reserve.
6. The clinic can **dispute** a rejected line with a comment; the payer answers.
7. The payment is recorded by the payer (the assistance company or the MIG accountant) with the date and the payment order number. The clinic sees “Paid by assistance company …” or “Paid by MIG”.
8. The register totals — claimed, accepted, rejected, paid. The reconciliation statement can be downloaded as CSV.

### Clinic price lists and contracts {#clinic-prices}

<!-- audience: staff clinic -->

A clinic can have a different price list for different payers (for MIG and for each assistance company). The price of a line is checked against the price list of its payer. Price lists and contracts are visible in the “Documents” section of the clinic portal.

### Connecting the clinic's system (MIS) {#clinic-mis}

<!-- audience: staff clinic -->

Clinics with their own medical system can work via API: check patients, send schedules, answer appointments, request guarantee letters and submit registers automatically. Setup is described in section 15, “Integrations”.

## 10. Assistance: servicing, invoices to MIG, quality control {#assistance}

<!-- audience: staff assist -->

An assistance company serves the insured persons of the clients assigned to it, pays clinics itself and once a month invoices MIG for reimbursement; MIG reviews the invoice, pays it and checks the quality of decisions on a sample basis.

### Assignment of clients {#assistance-assignment}

<!-- audience: staff assist -->

- Each policy is assigned to one assistance company or to none (then MIG serves the client itself).
- The assistance company is assigned by the **underwriter** — when preparing the commercial proposal or in the client/policy card, with a start date.
- When the assistance company changes, new cases from that date go to the new one, and the previous one keeps seeing its old cases **read-only** for another 12 months (for disputes and reconciliations).
- An assistance company sees only the insured persons of its clients as of the event date. In the app the insured person sees the “Your assistance 24/7” card with a “Call” button, and the chat from the app goes to the assistance operators.

### Daily work of an assistance company {#assistance-daily}

<!-- audience: staff assist -->

- **Cases (call centre):** the operator finds the insured person by search (full name, policy number or the whole phone number — a part of the number does not find anyone: phones are stored encrypted), creates a case of the required type — appointment, consultation, guarantee letter, complaint, emergency — and handles it until resolved with deadline control.
- **Appointments and escalations** from clinics that did not answer in time.
- **Guarantee letters:** the assistance doctor decides within the authority from the contract; above it — “Escalate to MIG” with their own opinion.
- **Clinic sub-registers:** reviewing lines, answering disputes, recording payments to clinics.
- Complaints of insured persons about the assistance company are also visible to the MIG coordinator.

### Assistance invoice to MIG (rebilling) {#assistance-rebill}

<!-- audience: staff assist -->

1. The **assistance finance officer** once a month prepares an invoice from the lines **paid to clinics in that month**. The system adds the fee according to the contract model and shows the formula: PEPM — an amount per insured person per month; a percentage of payouts; an amount per case.
2. After submission the system **automatically checks each line** and sets flags with an explanation: the line was not paid to the clinic; the policy was not active on the service date; the insured person was not assigned to this assistance company; the limit or the guarantee letter amount is exceeded; a duplicate (including in another assistance company's invoice); the price does not match the price list. “AI pre-check” adds the “AI disagrees” flag.
3. **A MIG claims officer** accepts or rejects lines with a reason; the assistance company can dispute a rejection.
4. **A MIG accountant** pays the accepted amount. The four-eyes rule: whoever accepted the invoice cannot pay it.
5. The lines of an accepted invoice become MIG claims and are included in the clients' loss ratio.

### Quality control {#assistance-qa}

<!-- audience: staff -->

Every month the system randomly selects 5% of the assistance company's decisions (guarantee letters and accepted register lines) into the queue of a MIG medical expert. The expert marks “Agree” or “Disagree” with a comment. The results go into the assistance company's KPI together with the response speed, the share of decisions made on time, the number of complaints and the loss ratio of the portfolio. The sample does not change decisions that are already paid, but discrepancies are visible in the assistance company card.

### Where MIG sees the assistance companies {#assistance-in-mig}

<!-- audience: staff -->

“Partners” → “Assistance companies”: a list with the number of insured persons, KPI, invoices to review and deadline breaches. The assistance company card: overview and KPI, contract (fee, authority limits), clients, users, integration, invoices, quality control, audit.

## 11. Claims settlement {#claims}

<!-- audience: staff -->

A claim decision is made by a claims officer (Claims Officer) within their authority limits, with a reference to a contract clause; a medical expert gives a medical opinion, but not a decision.

### Where claims come from {#claims-sources}

<!-- audience: staff -->

| Source | How it appears |
| --- | --- |
| Receipt from the app | The insured person submitted “Get money back for a receipt” |
| Clinic invoice | A line of a clinic register (for clients without an assistance company) |
| Assistance invoice | Lines of an accepted assistance invoice |
| Phone call, HR letter, email | The specialist registers it manually: “+ Create” → “Claim”, or “+ Claim” in the insured person's card |

When registering manually, specify the insured person (search), the event date, the category, the amount, the source and the attachments. The reserve is immediately set equal to the claimed amount.

### Workplace {#claims-workplace}

<!-- audience: staff -->

“Claims settlement” → “Claims”, tabs: “New”, “Under review”, “Awaiting doctor's opinion”, “Above my authority limits”, “Appeals”, “Assistance invoice lines”. The table shows the number, the insured person, the client, the source, the amount, the reserve, the deadline and fraud flags.

### How to make a decision {#claims-decision}

<!-- audience: staff -->

1. Open the claim. Check the attachments, the fiscal data of the receipt, the remaining limit and the “AI hint” block.
2. If needed — “Request doctor's opinion”. The medical expert writes an opinion and a recommendation.
3. The decision: **approve in full**, **approve in part** (enter the amount) or **deny**. For a partial approval and a denial, **a reference to a clause** of the contract or the plan and the text of the reason **are mandatory** — without them the decision will not be saved.
4. If the decision amount is above your personal authority limits, it goes for approval to a colleague with higher authority limits. For a denial the whole claimed amount counts: denying a large claim also requires high authority limits.
5. After the decision the system generates a letter to the insured person. In the app they see the reason in plain language and a “Dispute” button.

### Appeals {#claims-appeals}

<!-- audience: staff -->

An insured person or a clinic disputes a decision — including a decision of an assistance company. The appeal appears in the “Appeals” tab. Review the case, request a doctor's opinion if needed, and uphold or change the decision — also with a reference to a clause.

### Reserves {#claims-reserves}

<!-- audience: staff -->

- Each open claim has a reserve: on creation — the claimed amount or the amount of the approved guarantee letter; it changes with the decision; it is reset to zero on payment, denial or closure.
- Only a claims officer can change a reserve manually, with a reason. The whole history of changes is visible with the author.
- The “Reserves” report shows the reserve of reported but unsettled claims on the chosen date, by client, assistance company and category, with a CSV download. The reserve for unreported claims (IBNR) is calculated by an actuary outside the system.

### Signs of fraud {#claims-fraud}

<!-- audience: staff -->

The system sets flags but **does not deny automatically**:

- **duplicate receipt** — the fiscal number matches a receipt of any insured person, and if there is no number — the amount, the date and the point of sale; a matching photo is an additional sign;
- too many claims per month (the threshold is in the parameters);
- the service date is before the start of cover or after the exclusion;
- claims in the last days before the exclusion;
- the amount is noticeably above the price list.

A flag can be removed only with a comment — this goes into the audit log.

### Claims journal {#claims-journal}

<!-- audience: staff -->

“Reports” → claims journal: a CSV download for reporting, without PINFL and phone numbers.

## 12. Finance: invoices, payments, 1C statement {#finance}

<!-- audience: staff -->

Client invoices are created automatically according to the payment schedule of the contract and endorsements; the accountant enters payments manually or uploads them with a 1C statement, and ambiguous payments are matched in the “Manual payment matching” queue.

### Invoices {#invoices}

<!-- audience: staff -->

- **To clients:** according to the contract schedule (single payment, quarterly, monthly) and for endorsements with an additional premium. Visible to the MIG accountant and the client's HR.
- **From assistance companies to MIG:** see section 10.
- **From clinics** (for clients without an assistance company): accepted register lines, paid by the MIG accountant.

An overdue client instalment is highlighted, and the manager and the accountant get a reminder. Blocking service when a payment is overdue can be turned on with a parameter (off by default).

### Recording a payment manually {#manual-payment}

<!-- audience: staff -->

“Finance” → “Invoices and payments” → invoice → “Record payment”: date, amount, payment order number. Partial payment is allowed.

### Uploading a 1C statement {#statement-1c}

<!-- audience: staff -->

1. “Invoices and payments” → “Upload 1C statement”. Required columns: payment document number (`doc_number`), date, amount, payer's STIR, payment purpose.
2. The system **matches** a payment **itself** only if exactly one invoice fits:
   - first it looks for the invoice number in the payment purpose;
   - then — the payer's STIR plus the exact outstanding amount among unpaid invoices;
   - a payment with an invoice number for a smaller amount is counted as partial.
3. Everything else goes to the **“Manual payment matching”** queue:
   - several invoices fit;
   - the amount does not match any invoice or exceeds the balance;
   - unknown STIR;
   - **payment by a third party** (a different STIR) — not matched automatically even with the correct invoice number.
4. **Uploading the same statement again is safe:** a line with the same document number, date, amount and STIR is skipped. After the upload you see “Loaded N, skipped as duplicates M”.

### Manual payment matching {#manual-allocation}

<!-- audience: staff -->

1. “Finance” → “Manual payment matching”. Each payment has suggestions of matching invoices with the reason for the match.
2. Choose an invoice or split the payment across several invoices. An unmatched balance stays in the queue.
3. For a payment from a different STIR (for example, another company of the group paid) **a comment is mandatory** — it is saved in the payment and in the audit log.

## 13. Guides for MIG roles {#staff-roles}

<!-- audience: staff -->

Each role has its own dashboard: indicators at the top, a task queue with tabs by type and the “Needs attention” block. Start your day with the queue — it contains everything waiting for you.

### Sales manager {#role-sales}

<!-- audience: staff -->

- **Queue:** leads without activity, commercial proposals without an answer for more than 5 days, contracts being signed, originals not received, overdue instalments. A lead without activity for 7 days, a proposal without an answer and a new renewal deal also bring a notification to the bell.
- **Every day:** run deals on the “Deals” board; upload census data; send commercial proposals for approved quotes; prepare contracts from accepted proposals; monitor signing and payment; once a month prepare an endorsement from the accumulated change requests.
- **Creates:** a client (lead), a deal, a member list change.
- **Cannot:** approve the price; sign for MIG without signing authority.

### Underwriter {#role-underwriter}

<!-- audience: staff -->

- **Queue:** quotes for your approval and your drafts; renewals within the next 60 days without a commercial proposal; contracts and endorsements with financial deviations; limit change requests; clients with a loss ratio above 80%; children who have reached the age limit.
- **Every day:** calculate quotes (if the discount is above your authority limits — send for approval); approve financial terms; confirm limit changes (except your own); assign assistance companies; prepare renewal proposals based on the aggregate loss ratio.
- **Sees:** for a client's loss ratio — only aggregates (amounts, categories, months), without individual claims and names.

### Lawyer {#role-legal}

<!-- audience: staff -->

- **Queue:** contracts and endorsements with changed clauses, signature scans to check.
- **How to work:** in the contract editor, changed clauses are highlighted next to the original text. “Approve” or “Return” with a comment. Check scans for signatures and seals and mark “Scan checked”.

### VHI coordinator {#role-curator}

<!-- audience: staff -->

- **Queue:** deadline breaches by assistance companies, complaints, unanswered appointments of clients without an assistance company.
- **Every day:** monitor the KPI of assistance companies, handle complaints of insured persons, manage appointments of clients without an assistance company, reveal personal data for a reason when needed.

### Claims officer (Claims Officer) {#role-claims-officer}

<!-- audience: staff -->

- **Queue:** new claims, claims above your authority limits, appeals, fraud flags, assistance invoice lines.
- **Every day:** register claims reported by letter or phone; make decisions with a reference to a clause; request doctor's opinions; manage reserves; review flags; review assistance invoices.
- **Details:** section 11.

### Medical expert {#role-doctor-expert}

<!-- audience: staff -->

- **Queue:** guarantee letter escalations from assistance companies and letters of clients without an assistance company; requested opinions; the control sample.
- **Medical record:** “Open medical record” → reason → access for 15 minutes, with a timer. Every opening is in the audit log.
- **Guarantee letters above the threshold** require a second doctor.

### Accountant {#role-accountant}

<!-- audience: staff -->

- **Queue:** manual payment matching, assistance invoices to pay, overdue instalments, payouts.
- **Every day:** upload 1C statements, match payments, pay accepted assistance and clinic invoices, record reimbursement payouts. Details in section 12.

### MIG administrator {#role-admin}

<!-- audience: staff -->

- **Queue:** changes of parameters and authority limits to confirm, integration errors.
- **Details:** sections 15 and 16.

## 14. Guides for HR, insured persons, clinics and assistance companies {#portal-guides}

<!-- audience: all -->

This section can be given to partners and clients separately: it contains only what they see in their portals.

### Client company HR {#guide-hr}

<!-- audience: staff hr -->

- **“Employees”:** the list of insured persons, the app status (“Uses the app”, “Invited”, “Not invited”), the filters “Not in the app” and “Recently added”. Buttons “+ Add employee”, “Upload from CSV” (download the template first), “Remind everyone” — a repeated invitation to those who have not installed the app.
- **“Family”:** family members of employees, adding them, “App requests” — approve or reject with a reason.
- **Excluding an employee:** the row menu → “Exclude from date…”.
- **Commercial proposals and contracts:** open, “Accept” / “Reject” a proposal; sign the contract and endorsements with an e-signature or upload a scan.
- **“Invoices and documents”:** invoices to pay, policy documents, employee certificates (one by one or all at once).
- **“Statistics”:** how many people are insured, how many use the app, the total number of claims, budget use. Groups of fewer than 10 people are not shown.
- **Important:** you see who is insured, but **you do not see employees' diagnoses, visits and reimbursements** — this is medical confidentiality.

### Insured person (app) {#guide-insured}

<!-- audience: staff insured -->

- **Home:** the policy card, the tiles “Book a doctor”, “Get money back for a receipt”, “Clinics nearby”, “Message us”, “Is it covered?”, “My family”; the latest reimbursement; “What is left” for the limits; the “Your assistance 24/7” card.
- **The “Me / {name}” switch** at the top: everything on the screen is shown for the selected family member. For the employee the last item is “+ Add”: it opens the request for a family member right away.
- **“Card for the clinic”:** the QR code and the short code for the reception. The code refreshes every minute — show the live screen, not a screenshot.
- **Reimbursements:** sending a receipt, statuses, “Dispute” after a denial.
- **“My family”** (a tile on the home screen or “Profile”): who is insured with you and their status (on the policy / excluded), the “Add a family member” button and the “My requests” block — whom to add, the date, the status: under review by HR, approved, rejected with a reason. Family members are added only by a request through the company’s HR; when HR approves or rejects it, a notification comes to the bell on the home screen. An adult family member does not see the button — instead there is the hint “Family members can be added by the employee through whom you are insured”.
- **Profile:** certificate, language, card for payouts, consent to data processing, “Sign out”.
- **An adult family member** signs in with their own phone and can turn on “Allow {name} to see my claims” or withdraw it.

### Clinic {#guide-clinic}

<!-- audience: staff clinic -->

- **Registrar:** “Check a patient” → visit; “Appointments” — confirm, offer a time, reject; “Guarantee letters” — a request from the visit, uploading more documents on request.
- **Clinic administrator:** the same, plus “Registers” (section 9), “Documents” (contract, price list, reconciliation statements), “Users” (invite, send the invitation again, change role, deactivate — you cannot deactivate yourself), “Integration” (section 15).
- **Remember:** without a policy check, patient data are unavailable; the QR code is single-use.

### Assistance company {#guide-assistance}

<!-- audience: staff assist -->

- **Operator:** “Cases” — create from a call, find an insured person; “Appointments” — escalations from clinics; “Chats” — messages from the app.
- **Doctor:** “Guarantee letters” — a decision within the authority or an escalation to MIG; review of sub-register lines; medical records of its own insured persons for a reason.
- **Finance officer:** “Clinic registers” — review and recording payments to clinics; “MIG invoices” — prepare for the month, send, answer rejections.
- **Administrator:** “Users” (invite, send the invitation again, disable), “Integration”.
- **Remember:** you see only the insured persons of your clients as of the event date; all queues have deadlines, overdue items are highlighted.

## 15. Administration {#administration}

<!-- audience: staff clinic assist -->

<!-- audience: staff -->
The MIG administrator manages users, authority limits, parameters, partners and integrations; almost all changes take effect only after confirmation by a second administrator and are recorded in the audit log.

### MIG staff {#admin-users}

<!-- audience: staff -->

1. “+ Create” → “User” → email, full name, role → “Invite”. The employee gets an e-mail with a link, sets a password and connects an authenticator app at the first sign-in (the “First sign-in by invitation” section).
   Until the password is set, the “Status” column shows “Invitation sent” (and until when the link is valid), “Invitation queued for sending” or “Invitation expired”. The “Send again” button sends a new link — the previous one stops working.
   Below the table, the “Invitations” block lists the accounts of client HR, clinics and assistance companies that have not set a password yet. The invitation can be sent again there too.
2. “Administration” → “Users and roles”: role change (with confirmation), deactivation of a dismissed employee. You cannot remove the administrator role from yourself.
3. **Authority limits and signing authority** — in the employee's profile: the maximum discount from the rate and the quote premium without approval (underwriter), the maximum claim decision amount (claims officer), signing authority with its basis (“Power of attorney No. … of …”). A change applies only after confirmation by a **second administrator**; the employee cannot confirm it.

### VHI parameters {#admin-params}

<!-- audience: staff -->

“Administration” → “VHI parameters”. All business rules of the system in one place, each parameter with a unit, a description and an allowed range. Until a value has been changed, it is marked “demo value”. The main groups:

- **deadlines:** clinic response to an appointment, review of an assistance invoice and a sub-register, renewal window, validity of a commercial proposal, reminders for leads, proposals and originals;
- **thresholds:** “limit running low”, two doctors for a guarantee letter, control sample, claim frequency for a fraud flag;
- **rate:** base rates of plans, age group coefficients, group size discounts;
- **servicing:** endorsement frequency, refund rule on exclusion, from which date a new employee is covered, blocking when overdue;
- **family members:** limit mode, age limit for children and students;
- **security:** limits on sign-in attempts and PINFL checks, invitation validity;
- **numbering:** document number templates (Latin letters, digits, “-” and “/” only).

A change: “Propose a new value” → a second administrator or an underwriter confirms → the value takes effect, with an audit log entry “was — became, who, when”.

### AI {#admin-ai}

<!-- audience: staff -->

“Administration” → “AI”: turning on each of the four scenarios, the confidence threshold (demo: 60%), metrics of specialists' agreement with the hints, a run of reference cases. The **“Turn off AI everywhere”** button works instantly; turning it back on requires a second administrator.

### Partners {#admin-partners}

<!-- audience: staff -->

- **Clinic:** “+ Create” → “Clinic”: name in Latin script, legal form, address, specialties, contract, operating mode (portal only, API, API and portal). Then invite the first clinic administrator — after that the clinic adds its own staff itself.
- **Assistance company:** “+ Create” → “Assistance company”: name, 24/7 phone for insured persons, operating mode, contract — fee model and amount, authority for guarantee letters, whether it handles reimbursements to insured persons, invoice payment term. Invite the first assistance administrator.
- **Assignment of clients to an assistance company** is done by the underwriter (section 10).

### Integrations {#admin-integrations}

<!-- audience: staff clinic assist -->

Clinics and assistance companies with their own system connect via API. Keys are issued by **the partner itself** in the “Integration” section of its portal:

1. “API keys” → name, access scopes, optionally allowed IPs → “Create”. The secret is shown **once** — save it immediately.
2. “Webhooks” — https addresses only, choice of events, “Send a test event”, delivery log with retry.
3. “Request log”, “Documentation” with examples, “Sandbox” for testing.

<!-- audience: staff assist -->
The MIG administrator sees the partner's integration in its card (keys without secrets, errors for the last 24 hours) and **can revoke any key** — for example, if a leak is suspected.

### Audit log {#admin-audit}

<!-- audience: staff -->

“Administration” → “Audit log”: filters by action, employee, assistance company and dates. It shows all sign-ins, reveals of personal data and medical records, decisions, changes of parameters and authority limits, downloads, partner actions. Actions of background jobs (contracts taking effect, contracts and policies expiring, renewal deals) are recorded by “System”.

### Languages {#admin-languages}

<!-- audience: staff -->

The interface is available in Russian, Uzbek (Latin script) and English. Terms are kept in the glossary; translation corrections are made through the review file `docs/i18n-review.csv`.

## 16. Transfer of the active portfolio {#portfolio-migration}

<!-- audience: staff:admin -->

Active contracts from the old system are entered not through deals but through “Portfolio transfer”: six CSV files are uploaded in order, each is first checked without writing anything, the batch is applied by a second administrator, and after the upload the system shows a reconciliation with the source totals.

**Where:** “Administration” → “Portfolio transfer” (MIG administrator only).

### Preparation {#migration-prep}

<!-- audience: staff:admin -->

1. Download the CSV templates on the transfer page.
2. Export the data from the old system and arrange it according to the templates. Company names and full names — **in Latin script**, as in the register and on ID cards.
3. Prepare the totals for reconciliation: number of clients, contracts, insured persons, total premium, total reserves.

### Six steps — strictly in order {#migration-steps}

<!-- audience: staff:admin -->

| Step | File | Main content |
| --- | --- | --- |
| 1 | Clients | Name, legal form, STIR, bank details, HR contact |
| 2 | Contracts | Old MIG number, dates, plan, premium, `premium_employee` and `premium_family`, schedule, calculation method (`pricing_basis`), assistance company |
| 3 | Insured persons | A row for **each person**: full name, date of birth, PINFL, old certificate number, inclusion date, contract; for family members — `relation` and `principal_pinfl` (the employee's PINFL); if available — the individual premium `premium` |
| 4 | Used limits | As of the transfer date, by category, for each insured person |
| 5 | Open claims | Statuses and reserves |
| 6 | Unpaid invoices | Number, amount, due date |

At each step:

1. Upload the file — the system **checks all rows without writing anything** and shows a report: errors by row and field, warnings.
2. Fix the errors in the file and upload it again — or confirm the step with the “Exclude rows with errors” checkbox.
3. Go to the next step.

### Premiums of insured persons {#migration-premiums}

<!-- audience: staff:admin -->

The premium of each person is taken in this order: the individual premium from the insured persons file → by type from the contract (`premium_employee` for an employee, `premium_family` for a family member) → otherwise the “No premium” error. The sum of the premiums of the insured persons under a contract must match the contract premium to within UZS 1 — a discrepancy is highlighted already during the check.

### Applying and reconciliation {#migration-apply}

<!-- audience: staff:admin -->

1. A ready batch is **applied by a second administrator** — the author of the batch cannot do it.
2. After applying, open the **reconciliation**: clients, contracts, insured persons, premiums, reserves, limits, invoices — compared with the totals of the files, with discrepancies highlighted (for example, excluded rows with errors).
3. Transferred contracts immediately get the “Active” status — without commercial proposals or approvals. The old MIG number is kept and can be found by search; the new number is issued by the template. A scan of the signed contract can be attached later.
4. All transferred records are marked “Transferred from the previous system” with the date and the author of the batch.
5. Insured persons see in the app the remaining limit **taking into account what was used before the transfer**.

### Contracts below the minimum and disallowed forms {#migration-group-warnings}

<!-- audience: staff:admin -->

A transferred active contract below the minimum group size, or with a client of a disallowed form, is loaded as usual — it stays in force until the end of its term. The batch report shows a warning for it, and the contract and client cards carry the marks «Below the minimum group size» and «Form not allowed». The rules apply to new contracts.

### Rollback {#migration-rollback}

<!-- audience: staff:admin -->

A batch can be rolled back as a whole as long as nobody has worked with its data. If there have already been actions on the transferred data, the rollback is blocked with an explanation of what prevents it.

### One contract manually {#migration-manual}

<!-- audience: staff:admin -->

For a single contract there is manual entry — the same form as a CSV row, with the same checks and confirmation by a second administrator.

## 17. What to do if… {#troubleshooting}

<!-- audience: all -->

Typical situations and what to do; if a situation is not on the list, contact the VHI coordinator or the administrator.

| Situation | What to do |
| --- | --- |
| **An insured person cannot sign in** | Check that the phone number in their card is correct and that they are included in the policy (not excluded). If they changed their number, HR corrects the phone in the employee card. After 5 failed attempts sign-in is blocked for 5 minutes — wait. | <!-- audience: staff hr insured assist -->
| **A MIG employee cannot sign in** | Wait 5 minutes after the block. If access to the second factor is lost, the administrator resends the invitation. | <!-- audience: staff -->
| **“The code has expired” at the reception** | The code in the app is valid for 60 seconds and is single-use. Ask the patient to open the “Card for the clinic” again. If there is no phone — check by policy number and PINFL. | <!-- audience: staff clinic insured -->
| **The clinic does not answer an appointment** | After 2 hours (demo) the request automatically goes to the assistance company (or the MIG coordinator). The operator contacts the clinic or offers another one. | <!-- audience: staff clinic assist -->
| **The limit is exhausted** | The app and the clinic see “exhausted”. Further services are at the insured person's expense. As an exception — a limit change request (created by the coordinator or an underwriter, confirmed by another underwriter). | <!-- audience: staff clinic assist insured -->
| **An expensive service is needed** | The clinic requests a guarantee letter from the visit. Do not provide a service that requires a GL before it is approved — a register line without a GL number will be rejected. | <!-- audience: staff clinic assist -->
| **The insured person disagrees with a denial** | In the app — “Dispute”. The appeal goes to a claims officer. | <!-- audience: staff insured assist -->
| **The clinic disagrees with a rejected line** | In the register — “Dispute” on the line, with a comment. The payer answers. | <!-- audience: staff clinic assist -->
| **“Duplicate receipt” flag** | Compare with the match found. If these really are different purchases, remove the flag with a comment; if it is a duplicate, deny with a reference to a clause. | <!-- audience: staff -->
| **A claim above my authority limits** | Just make the decision — the system itself sends it for approval to a colleague with higher authority limits. | <!-- audience: staff -->
| **A contract clause needs to be changed** | In the editor — “Edit wording”. The contract goes to the lawyer. For a sent contract — “New version” (the signatures are reset). | <!-- audience: staff -->
| **The client sent only a scan** | Upload the scan; a MIG employee marks “Scan checked”. The contract works; the system will remind about the original after 30 days. | <!-- audience: staff hr -->
| **A payment was not matched** | Open “Manual payment matching” and choose the invoice from the suggestions. If another company paid, match it with a mandatory comment. | <!-- audience: staff -->
| **The statement was uploaded twice** | No problem: repeated lines are skipped and the amounts will not double. | <!-- audience: staff -->
| **A client employee has left** | HR: “Exclude from date…”. The premium refund is calculated in the next endorsement by the rule from the parameters. | <!-- audience: staff hr -->
| **An employee has had a child** | HR adds the child in “Family” (or the employee submits a request from the app and HR approves it). The child gets their own certificate and QR code. | <!-- audience: staff hr insured -->
| **A child has reached the age limit** | The underwriter gets a task. Decide with HR: exclude the child through an endorsement or continue the insurance under the rule for students. | <!-- audience: staff hr insured -->
| **The client changes the assistance company** | The underwriter changes the assistance company in the policy card with a date. Old cases stay with the previous assistance company read-only. | <!-- audience: staff assist -->
| **HR asks for employees' diagnoses or receipts** | Refuse: this is medical confidentiality. HR sees only the fact of insurance and anonymised statistics. | <!-- audience: staff hr -->
| **A MIG employee has left** | The administrator deactivates the account on the same day. If they were a signatory, remove the signing authority. | <!-- audience: staff -->
| **A partner's API key is suspected to have leaked** | The MIG administrator revokes the key in the partner card immediately; the partner creates a new one. Check the request log. | <!-- audience: staff clinic assist -->
| **AI gives strange answers** | Mark “Disagree” with a comment. If the problem is widespread, the administrator clicks “Turn off AI everywhere” — work continues without hints. | <!-- audience: staff assist -->
| **An integration error with a clinic or 1C** | The “Integrations” block on the administrator's dashboard shows the status and the queue. Check the partner's request log and contact the partner. | <!-- audience: staff -->
| **A sole proprietor lead is not saved** | DMS is only for companies. If MIG decides otherwise, an administrator changes the «Allowed legal forms of the policyholder» parameter (a second administrator confirms). | <!-- audience: staff -->
| **A quote cannot be approved: the group is below the minimum** | Submit it for approval. The head of underwriting can approve the exception with a comment on why it is justified. | <!-- audience: staff -->
| **A contract cannot be signed: below the minimum** | Appendix 2 has fewer employees than the minimum and no exception is approved in the quote. Upload the full list or approve the exception in the quote. | <!-- audience: staff -->
| **After an exclusion the group is below the minimum** | HR can exclude the employee; the underwriter and the manager get a task and agree with the client what to do with the contract terms. | <!-- audience: staff hr -->
| **The app says «The code did not match, or this number is not found»** | The message is deliberately the same for an unknown number and a wrong code and appears only after the code is entered — so nobody can find out by trial who is insured. Check the SMS code; if it is right, ask your company's HR to check the number in the list of insured people. | <!-- audience: staff hr insured -->
| **Nobody answers the request** | Open “My requests” on the dashboard: it shows who got the request and whether it was taken. Once the deadline has passed, click “Remind” — the executor is notified again. If there is still no answer, contact the executor or their manager directly; the response time is set by the “Internal request response time” and “Client response time to a MIG request” parameters. | <!-- audience: staff -->
| **The request came to the wrong person** | Click “Reject” in the queue row and write whom to ask — the author sees the comment and can send the request again. | <!-- audience: staff -->

## 18. Security and privacy {#security}

<!-- audience: all -->

The system stores personal and medical data, so every user is responsible for what they open and to whom they pass it on; everything important is recorded in the audit log.

### Rules for everyone {#security-rules}

<!-- audience: all -->

- Never give your password or second-factor code to anyone, even colleagues or someone “from IT”. MIG staff never ask for them.
- When leaving your computer, sign out or lock the screen. The session ends by itself after 15–30 minutes of inactivity.
- Do not take screenshots with personal data and do not forward them in messengers.
- Download to CSV only what you need for work. Downloads do not contain PINFL, phone numbers, dates of birth or diagnoses, but they are still recorded in the audit log.

### Personal data {#security-pii}

<!-- audience: all -->

- PINFL, phone, date of birth, email and card number are shown **masked**.
- To see the full value, click “Show” and enter a reason (at least 10 characters; quick options are available: “Processing claim No. …”, “Call from the insured person”, “Clinic request”). The value is visible for 30 seconds and is then hidden again. Copying is recorded too. <!-- audience: staff assist -->
- Reveal data only when the task cannot be done without them. <!-- audience: staff assist -->

### Medical confidentiality {#security-medical}

<!-- audience: all -->

- **A medical record** is opened only by a MIG medical expert or an assistance doctor — with a reason, for 15 minutes. <!-- audience: staff assist -->
- **HR** never sees employees' diagnoses, visits and reimbursements.
- **A clinic** sees a patient only after checking their policy and without the history of visits to other clinics.
- **Family members:** a parent sees the data of their children; the data of adult family members — only with their consent.
- **The underwriter** sees a client's loss ratio only in aggregates. <!-- audience: staff -->

### Partners and integrations {#security-partners}

<!-- audience: all -->

- Each partner sees only its own data: a clinic — its own clinic, an assistance company — its own insured persons as of the event date. A request for someone else's data returns “not found”.
- API key secrets are shown once. Keep them in a secure place. At the slightest suspicion of a leak the key must be revoked. <!-- audience: staff clinic assist -->

### Where data are stored {#security-storage}

<!-- audience: all -->

In the production system all data are stored on servers in Uzbekistan. Partners connected through their own systems are also obliged by contract to store the data of insured persons in Uzbekistan.

### If something went wrong {#security-incident}

<!-- audience: all -->

If you notice suspicious activity, have opened someone else's data by mistake or sent a file to the wrong recipient — **report it to the MIG administrator immediately**. The sooner, the easier it is to limit the consequences: the administrator sees the audit log and can revoke access.

## 19. Status reference {#statuses}

<!-- audience: all -->

Statuses of the main objects in the order in which they usually go.

| Object | Statuses |
| --- | --- |
| Client | Lead → Negotiation → Active → Renewal → Expired | <!-- audience: staff -->
| Deal | Lead → Census → Quote → Proposal sent → Proposal accepted → Contract: draft → With the lawyer → Sent to client → Signing → Awaiting payment → Active; or Lost (with a reason) | <!-- audience: staff -->
| Quote | Draft → Pending approval → Approved / Rejected | <!-- audience: staff -->
| Commercial proposal | Draft → Sent → Accepted / Declined; Revoked | <!-- audience: staff hr -->
| Contract | Draft → With the lawyer → Approved → Sent → Signing → Signed → Active → Terminated / Expired | <!-- audience: staff hr -->
| Endorsement | Draft → With the lawyer → Approved → Sent → Signing → Signed | <!-- audience: staff hr -->
| Change request | Pending → Included in an endorsement / Cancelled | <!-- audience: staff hr -->
| Policy | Active → Expired / Terminated | <!-- audience: all -->
| Insured person | Active → Excluded | <!-- audience: all -->
| Doctor appointment | Requested → Confirmed / Declined / Rescheduled → Completed / Cancelled | <!-- audience: staff insured clinic assist -->
| Guarantee letter | Requested → Documents needed → Approved / Rejected → Used / Expired | <!-- audience: staff clinic assist -->
| Claim (for staff) | New → Under review → Medical review → Approved / Rejected → To pay → Paid | <!-- audience: staff -->
| Reimbursement (in the app) | Received → Checking → Approved / Denied → Money on your card | <!-- audience: staff insured assist -->
| Clinic register | Draft → Submitted → Under review → Partially accepted / Accepted → Paid | <!-- audience: staff clinic assist -->
| Line of a register or an assistance invoice | Pending → Accepted / Rejected → Disputed | <!-- audience: staff clinic assist -->
| Assistance invoice to MIG | Draft → Submitted → Under review → Partially accepted / Accepted → Paid | <!-- audience: staff assist -->
| Client invoice | Unpaid → Partially paid → Paid; Overdue | <!-- audience: staff hr -->
| Limit change request | Pending → Confirmed / Rejected | <!-- audience: staff -->
| Assistance case | Open → In progress → Waiting → Resolved | <!-- audience: staff assist -->
| Transfer batch | Check → Ready to apply → Applied → Rolled back | <!-- audience: staff -->

**Colours in tables:** green — everything is fine or completed; orange — needs attention (deadline soon, limit running low, awaiting a decision); red — overdue or rejected; grey — draft or inactive.

## 20. Demo version of the prototype {#demo}

<!-- audience: demo -->

The system currently works as a prototype with fictitious data: everything you do is stored only in your browser tab and is reset when you close it. This section will be removed when the system moves to real data.

### Demo banner at the top of the screen {#demo-banner}

<!-- audience: demo -->

- **“Sign in as…”** — quick sign-in under any role, grouped by portal (MIG, Assistance, Clinic, Company HR, Insured person), with search. The sign-in is real, through the normal check.
- **“Reset data”** — return all demo data to the initial state.
- **“Simulate network failures”** — some requests will fail, so you can see how the system shows errors.

### Main demo accounts {#demo-accounts}

<!-- audience: demo -->

The password for all of them is `Demo-2026!`, the second-factor and SMS code is `000000`.

| Role | Sign-in |
| --- | --- |
| Sales manager | `sales@demo.mig.uz` |
| Underwriter / Head of underwriting (signatory) | `underwriter@demo.mig.uz` / `underwriter-head@demo.mig.uz` |
| Lawyer | `legal@demo.mig.uz` |
| VHI coordinator | `operator@demo.mig.uz` |
| Claims officer / Head | `claims@demo.mig.uz` / `claims-head@demo.mig.uz` |
| Medical expert | `doctor@demo.mig.uz` |
| Accountant | `accountant@demo.mig.uz` |
| Administrator / Second administrator | `admin@demo.mig.uz` / `admin2@demo.mig.uz` |
| Company HR | `hr@demo-client.uz` |
| Registrar / Clinic administrator | `registrar@demo-clinic.uz` / `admin@demo-clinic.uz` |
| Assistance: operator, doctor, finance officer, administrator | `asst-operator@`, `asst-doctor@`, `asst-billing@`, `asst-admin@demo-assist.uz` |
| Insured person / his spouse | phone `+998 90 000 00 01` / `+998 90 000 00 02` on the app sign-in screen |

The full current list is in “Sign in as…”.

### Tips for a demo {#demo-tips}

<!-- audience: demo -->

- Switch between roles through “Sign in as…” **in the same tab** — otherwise changes made under one role will not be visible under another.
- A convenient 15-minute scenario: the manager creates a lead → the underwriter calculates a quote with a discount above the authority limits → the head approves → commercial proposal → HR accepts → a contract with a changed clause → the lawyer approves → signing → payment → the insured person sees the certificate → the clinic checks their QR code → the assistance company decides on a guarantee letter.
- To show security: HR does not see diagnoses; a reveal of personal data immediately appears in the audit log; an underwriter cannot confirm their own request; a link to someone else's section leads to “No access”.

### What is simulated in the prototype {#demo-simulated}

<!-- audience: demo -->

E-IMZO e-signature and EDI, SMS, receipt recognition, AI answers, webhooks and the exchange with 1C work as a simulation. The templates of the contract, endorsement, certificate and letters are placeholders with the “ШАБЛОН-ЗАГЛУШКА” (TEMPLATE PLACEHOLDER) watermark until MIG provides the texts. All thresholds and deadlines are demo values that MIG will replace in “VHI parameters”.
