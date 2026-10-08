/* Routes of the commercial offer screen (kept tiny: imported by pages that only link to it). */
export function kpNewPath(clientId: string, policyId?: string): string {
  return `/staff/clients/${clientId}/kp/new${policyId ? `?policyId=${policyId}` : ''}`;
}

export function kpPath(kpId: string): string {
  return `/staff/kp/${kpId}`;
}
