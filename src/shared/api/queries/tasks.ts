/* Next steps: tasks between roles, HR «Задачи от МИГ», notifications and the client pipeline. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskAskInput, TaskRequestHrInput } from '@/shared/schemas/forms';
import { request } from '../client';
import * as L from '../schemas-lifecycle';

const tk = {
  tasks: (status: string) => ['tasks', status] as const,
  notifications: ['notifications'] as const,
  pipeline: (clientId: string) => ['pipeline', clientId] as const,
};

function useTaskMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
    },
  });
}

export const useAskTask = () => useTaskMutation((v: TaskAskInput) => request('/tasks', { method: 'POST', body: v, schema: L.workTaskView }));
export const useRequestHr = () => useTaskMutation((v: TaskRequestHrInput) => request('/tasks/request-hr', { method: 'POST', body: v, schema: L.workTaskView }));
export const useTaskDone = () => useTaskMutation((id: string) => request(`/tasks/${id}/done`, { method: 'POST', schema: L.workTaskView }));

/** Tasks of the person: their role's (MIG) or their company's (HR). */
export const useTasks = (status: 'open' | 'done' | '' = 'open', enabled = true) =>
  useQuery({ queryKey: tk.tasks(status), queryFn: () => request('/tasks', { query: status ? { status } : {}, schema: L.workTasks }), enabled });

export const useNotifications = (enabled = true) =>
  useQuery({ queryKey: tk.notifications, queryFn: () => request('/notifications', { schema: L.userNotifications, background: true }), enabled, refetchInterval: 30_000 });

export function useReadNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request('/notifications/read', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tk.notifications }),
  });
}

export const useClientPipeline = (clientId: string, enabled = true) =>
  useQuery({ queryKey: tk.pipeline(clientId), queryFn: () => request(`/clients/${clientId}/pipeline`, { schema: L.clientPipeline }), enabled });
