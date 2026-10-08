/* Next steps: tasks between roles, HR «Задачи от МИГ», notifications and the client pipeline. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskAskInput, TaskRequestHrInput } from '@mig/contracts/forms';
import { request } from '../client';
import * as L from '@mig/contracts/schemas-lifecycle';

const tk = {
  tasks: (status: string) => ['tasks', status] as const,
  mine: ['tasks', 'mine'] as const,
  about: (type: string, id: string) => ['tasks', 'about', type, id] as const,
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
      void qc.invalidateQueries({ queryKey: ['lifecycle'] });
      void qc.invalidateQueries({ queryKey: ['client'] });
    },
  });
}

export const useAskTask = () => useTaskMutation((v: TaskAskInput) => request('/tasks', { method: 'POST', body: v, schema: L.workTaskView }));
export const useRequestHr = () => useTaskMutation((v: TaskRequestHrInput) => request('/tasks/request-hr', { method: 'POST', body: v, schema: L.workTaskView }));
export const useTaskDone = () => useTaskMutation((v: { id: string; comment?: string }) => request(`/tasks/${v.id}/done`, { method: 'POST', body: { comment: v.comment ?? '' }, schema: L.workTaskView }));
export const useTakeTask = () => useTaskMutation((id: string) => request(`/tasks/${id}/take`, { method: 'POST', schema: L.workTaskView }));
export const useRejectTask = () => useTaskMutation((v: { id: string; comment: string }) => request(`/tasks/${v.id}/reject`, { method: 'POST', body: { comment: v.comment }, schema: L.workTaskView }));
export const useRemindTask = () => useTaskMutation((id: string) => request(`/tasks/${id}/remind`, { method: 'POST', schema: L.workTaskView }));

/** «Мои запросы»: what the person asked for. */
export const useMyRequests = (enabled = true) => useQuery({ queryKey: tk.mine, queryFn: () => request('/tasks/mine', { schema: L.workTasks }), enabled });

/** The open requests about an object (the plaque instead of «Попросить …»). */
export const useTasksAbout = (subjectType: string, subjectId: string, enabled = true) =>
  useQuery({ queryKey: tk.about(subjectType, subjectId), queryFn: () => request('/tasks/about', { query: { subjectType, subjectId }, schema: L.workTasks }), enabled: enabled && !!subjectId });

/** Tasks of the person: their role's (MIG) or their company's (HR). */
export const useTasks = (status: 'open' | 'done' | '' = 'open', enabled = true) =>
  useQuery({ queryKey: tk.tasks(status), queryFn: () => request('/tasks', { query: status ? { status } : {}, schema: L.workTasks }), enabled });

export const useNotifications = (enabled = true) =>
  useQuery({ queryKey: tk.notifications, queryFn: () => request('/notifications', { schema: L.userNotifications, background: true }), enabled, refetchInterval: 30_000 });

export function useReadNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tk.notifications }),
  });
}

export function useReadNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request('/notifications/read', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tk.notifications }),
  });
}

export const useClientPipeline = (clientId: string, enabled = true) =>
  useQuery({ queryKey: tk.pipeline(clientId), queryFn: () => request(`/clients/${clientId}/pipeline`, { schema: L.clientPipeline }), enabled });
