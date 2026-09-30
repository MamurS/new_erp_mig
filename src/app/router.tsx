import { createBrowserRouter, Outlet, type RouteObject } from 'react-router-dom';
import type { ComponentType } from 'react';
import { RequireAuth, RequirePermission, RequireRole, RootRedirect } from '@/shared/auth/guards';
import { INSURED_CARD_ROLES, sectionRoles } from '@/features/staff/nav';
import { assistRoles } from '@/features/assist/nav';
import { RootLayout } from './RootLayout';
import { ForbiddenPage, NotFoundPage, RouteErrorPage } from './pages';

type Loader = () => Promise<{ default: ComponentType }>;
const lazy = (load: Loader) => async () => ({ Component: (await load()).default });

const guarded = (path: string, roles: Parameters<typeof RequireRole>[0]['roles'], children: RouteObject[]): RouteObject => ({
  path,
  element: (
    <RequireRole roles={roles}>
      <Outlet />
    </RequireRole>
  ),
  children,
});

const staffRoutes: RouteObject[] = [
  { index: true, lazy: lazy(() => import('@/features/staff/pages/DashboardPage')) },
  guarded('clients', sectionRoles('/staff/clients'), [
    { index: true, lazy: lazy(() => import('@/features/staff/pages/ClientsPage')) },
    { path: ':clientId', lazy: lazy(() => import('@/features/staff/pages/ClientCardPage')) },
    {
      path: ':clientId/kp/new',
      element: (
        <RequirePermission action="kp.create">
          <Outlet />
        </RequirePermission>
      ),
      children: [{ index: true, lazy: lazy(() => import('@/features/kp/KpPage')) }],
    },
    {
      path: ':clientId/policies/new',
      element: (
        <RequirePermission action="policies.write">
          <Outlet />
        </RequirePermission>
      ),
      children: [{ index: true, lazy: lazy(() => import('@/features/staff/policies/PolicyIssuePage')) }],
    },
  ]),
  guarded('kp/:kpId', sectionRoles('/staff/clients'), [{ index: true, lazy: lazy(() => import('@/features/kp/KpPage')) }]),
  guarded('insured/:insuredId', INSURED_CARD_ROLES, [{ index: true, lazy: lazy(() => import('@/features/staff/pages/InsuredCardPage')) }]),
  guarded('policies', sectionRoles('/staff/policies'), [
    { index: true, lazy: lazy(() => import('@/features/staff/pages/PoliciesPage')) },
    { path: ':policyId', lazy: lazy(() => import('@/features/staff/pages/PolicyCardPage')) },
  ]),
  guarded('claims', sectionRoles('/staff/claims'), [
    { index: true, lazy: lazy(() => import('@/features/staff/pages/ClaimsPage')) },
    { path: ':claimId', lazy: lazy(() => import('@/features/staff/pages/ClaimCardPage')) },
  ]),
  guarded('appointments', sectionRoles('/staff/appointments'), [{ index: true, lazy: lazy(() => import('@/features/staff/pages/AppointmentsPage')) }]),
  guarded('clinics', sectionRoles('/staff/clinics'), [
    { index: true, lazy: lazy(() => import('@/features/staff/pages/ClinicsPage')) },
    { path: ':clinicId', lazy: lazy(() => import('@/features/staff/clinics/ClinicCardPage')) },
  ]),
  guarded('guarantees', sectionRoles('/staff/guarantees'), [{ index: true, lazy: lazy(() => import('@/features/staff/clinics/GuaranteesQueuePage')) }]),
  guarded('registries', sectionRoles('/staff/registries'), [
    { index: true, lazy: lazy(() => import('@/features/staff/clinics/RegistriesPage')) },
    { path: ':registryId', lazy: lazy(() => import('@/features/staff/clinics/RegistryReviewPage')) },
  ]),
  guarded('assistance', sectionRoles('/staff/assistance'), [
    { index: true, lazy: lazy(() => import('@/features/staff/assistance/AssistancesPage')) },
    { path: ':assistanceId', lazy: lazy(() => import('@/features/staff/assistance/AssistanceCardPage')) },
  ]),
  guarded('rebills', sectionRoles('/staff/rebills'), [
    { index: true, lazy: lazy(() => import('@/features/staff/assistance/RebillsPage')) },
    { path: ':rebillId', lazy: lazy(() => import('@/features/staff/assistance/RebillReviewPage')) },
  ]),
  guarded('qa', sectionRoles('/staff/qa'), [{ index: true, lazy: lazy(() => import('@/features/staff/assistance/QaPage')) }]),
  guarded('policy-changes', sectionRoles('/staff/policy-changes'), [{ index: true, lazy: lazy(() => import('@/features/staff/policies/PolicyChangesPage')) }]),
  guarded('limit-requests', sectionRoles('/staff/limit-requests'), [{ index: true, lazy: lazy(() => import('@/features/staff/pages/LimitRequestsPage')) }]),
  guarded('reports', sectionRoles('/staff/reports'), [{ index: true, lazy: lazy(() => import('@/features/staff/pages/ReportsPage')) }]),
  guarded('audit', sectionRoles('/staff/audit'), [{ index: true, lazy: lazy(() => import('@/features/staff/pages/AuditPage')) }]),
  guarded('admin/users', sectionRoles('/staff/admin/users'), [{ index: true, lazy: lazy(() => import('@/features/staff/pages/UsersPage')) }]),
  guarded('admin/parameters', sectionRoles('/staff/admin/parameters'), [{ index: true, lazy: lazy(() => import('@/features/staff/pages/ParametersPage')) }]),
];

const hrRoutes: RouteObject[] = [
  { index: true, lazy: lazy(() => import('@/features/hr/pages/EmployeesPage')) },
  { path: 'employees/new', lazy: lazy(() => import('@/features/hr/pages/AddEmployeePage')) },
  { path: 'import', lazy: lazy(() => import('@/features/hr/pages/ImportPage')) },
  { path: 'documents', lazy: lazy(() => import('@/features/hr/pages/DocumentsPage')) },
  { path: 'kp/:kpId', lazy: lazy(() => import('@/features/kp/KpViewPage')) },
  { path: 'stats', lazy: lazy(() => import('@/features/hr/pages/StatsPage')) },
  { path: 'help', lazy: lazy(() => import('@/features/hr/pages/HelpPage')) },
];

const onlyFor = (action: Parameters<typeof RequirePermission>[0]['action'], children: RouteObject[]): RouteObject => ({
  element: (
    <RequirePermission action={action}>
      <Outlet />
    </RequirePermission>
  ),
  children,
});

const clinicRoutes: RouteObject[] = [
  { index: true, lazy: lazy(() => import('@/features/clinic/pages/HomePage')) },
  { path: 'check', lazy: lazy(() => import('@/features/clinic/pages/CheckPage')) },
  { path: 'visits/:visitId', lazy: lazy(() => import('@/features/clinic/pages/VisitPage')) },
  { path: 'appointments', lazy: lazy(() => import('@/features/clinic/pages/AppointmentsPage')) },
  { path: 'guarantees', lazy: lazy(() => import('@/features/clinic/pages/GuaranteesPage')) },
  { path: 'documents', lazy: lazy(() => import('@/features/clinic/pages/DocumentsPage')) },
  onlyFor('registries.submit', [
    { path: 'registries', lazy: lazy(() => import('@/features/clinic/pages/RegistriesPage')) },
    { path: 'registries/:registryId', lazy: lazy(() => import('@/features/clinic/pages/RegistryPage')) },
  ]),
  onlyFor('clinic.users.manage', [{ path: 'users', lazy: lazy(() => import('@/features/clinic/pages/UsersPage')) }]),
  onlyFor('clinic.integration.manage', [{ path: 'integration', lazy: lazy(() => import('@/features/clinic/integration/IntegrationPage')) }]),
];

const assistRoutes: RouteObject[] = [
  { index: true, lazy: lazy(() => import('@/features/assist/pages/DashboardPage')) },
  guarded('insured', assistRoles('/assist/insured'), [
    { index: true, lazy: lazy(() => import('@/features/assist/pages/InsuredSearchPage')) },
    { path: ':insuredId', lazy: lazy(() => import('@/features/assist/pages/InsuredCardPage')) },
  ]),
  guarded('cases', assistRoles('/assist/cases'), [
    { index: true, lazy: lazy(() => import('@/features/assist/pages/CasesPage')) },
    { path: ':caseId', lazy: lazy(() => import('@/features/assist/pages/CasePage')) },
  ]),
  guarded('appointments', assistRoles('/assist/appointments'), [{ index: true, lazy: lazy(() => import('@/features/assist/pages/AppointmentsPage')) }]),
  guarded('chat', assistRoles('/assist/chat'), [{ index: true, lazy: lazy(() => import('@/features/assist/pages/ChatPage')) }]),
  guarded('guarantees', assistRoles('/assist/guarantees'), [
    { index: true, lazy: lazy(() => import('@/features/assist/pages/GuaranteesPage')) },
    { path: ':guaranteeId', lazy: lazy(() => import('@/features/assist/pages/GuaranteePage')) },
  ]),
  guarded('registries', assistRoles('/assist/registries'), [
    { index: true, lazy: lazy(() => import('@/features/assist/pages/RegistriesPage')) },
    { path: ':registryId', lazy: lazy(() => import('@/features/assist/pages/RegistryPage')) },
  ]),
  guarded('rebills', assistRoles('/assist/rebills'), [
    { index: true, lazy: lazy(() => import('@/features/assist/pages/RebillsPage')) },
    { path: ':rebillId', lazy: lazy(() => import('@/features/assist/pages/RebillPage')) },
  ]),
  { path: 'clinics', lazy: lazy(() => import('@/features/assist/pages/ClinicsPage')) },
  guarded('users', assistRoles('/assist/users'), [{ index: true, lazy: lazy(() => import('@/features/assist/pages/UsersPage')) }]),
  guarded('integration', assistRoles('/assist/integration'), [{ index: true, lazy: lazy(() => import('@/features/assist/pages/IntegrationPage')) }]),
];

const appRoutes: RouteObject[] = [
  { index: true, lazy: lazy(() => import('@/features/insured/pages/HomePage')) },
  { path: 'card', lazy: lazy(() => import('@/features/insured/pages/CardPage')) },
  { path: 'booking', lazy: lazy(() => import('@/features/insured/pages/BookingPage')) },
  { path: 'appointments', lazy: lazy(() => import('@/features/insured/pages/AppointmentsPage')) },
  { path: 'claims', lazy: lazy(() => import('@/features/insured/pages/ClaimsPage')) },
  { path: 'claims/new', lazy: lazy(() => import('@/features/insured/pages/NewClaimPage')) },
  { path: 'claims/:claimId', lazy: lazy(() => import('@/features/insured/pages/ClaimStatusPage')) },
  { path: 'clinics', lazy: lazy(() => import('@/features/insured/pages/ClinicsPage')) },
  { path: 'chat', lazy: lazy(() => import('@/features/insured/pages/ChatPage')) },
  { path: 'profile', lazy: lazy(() => import('@/features/insured/pages/ProfilePage')) },
];

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <RootRedirect /> },
      { path: '/login', lazy: lazy(() => import('@/features/auth/LoginPage')) },
      { path: '/login/otp', lazy: lazy(() => import('@/features/auth/OtpPage')) },
      {
        path: '/app',
        lazy: lazy(() => import('@/features/insured/InsuredRoot')),
        children: [
          { path: 'login', lazy: lazy(() => import('@/features/insured/pages/PhoneLoginPage')) },
          { path: 'login/code', lazy: lazy(() => import('@/features/insured/pages/CodePage')) },
          {
            path: 'consent',
            element: (
              <RequireAuth portal="app">
                <Outlet />
              </RequireAuth>
            ),
            children: [{ index: true, lazy: lazy(() => import('@/features/insured/pages/ConsentPage')) }],
          },
          {
            element: (
              <RequireAuth portal="app">
                <Outlet />
              </RequireAuth>
            ),
            children: [{ lazy: lazy(() => import('@/features/insured/AppLayout')), children: appRoutes }],
          },
        ],
      },
      {
        path: '/staff',
        element: (
          <RequireAuth portal="staff">
            <Outlet />
          </RequireAuth>
        ),
        children: [{ lazy: lazy(() => import('@/features/staff/StaffLayout')), children: staffRoutes }],
      },
      {
        path: '/hr',
        element: (
          <RequireAuth portal="hr">
            <Outlet />
          </RequireAuth>
        ),
        children: [{ lazy: lazy(() => import('@/features/hr/HrLayout')), children: hrRoutes }],
      },
      {
        path: '/clinic',
        element: (
          <RequireAuth portal="clinic">
            <Outlet />
          </RequireAuth>
        ),
        children: [{ lazy: lazy(() => import('@/features/clinic/ClinicLayout')), children: clinicRoutes }],
      },
      {
        path: '/assist',
        element: (
          <RequireAuth portal="assist">
            <Outlet />
          </RequireAuth>
        ),
        children: [{ lazy: lazy(() => import('@/features/assist/AssistLayout')), children: assistRoutes }],
      },
      { path: '/403', element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes, { future: { v7_relativeSplatPath: true } });
}
