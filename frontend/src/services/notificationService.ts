import { api } from './apiClient'
import type { AppNotification } from '@/types'

const B = '/ICMELive/api/v1/notifications'

export const notificationService = {
  async list(): Promise<{ notifications: AppNotification[]; unread: number }> {
    return (await api.get<{ notifications: AppNotification[]; unread: number }>(B)).data
  },
  async markRead(id: string) {
    return (await api.patch(`${B}/${id}/read`)).data
  },
  async markAllRead() {
    return (await api.patch(`${B}/read-all`)).data
  },
}
