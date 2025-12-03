// src/app/core/services/admin.service.ts
import { Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import ApiService from './api.service';

// ---- Interfaces que ya definiste en tu página ----
export interface RegionRow {
  region: string;
  total: number;
}

export interface DonationsPeriod {
  count: number;
  amount: number;
}

export interface DonationsByMonthRow {
  month: string;  // "2025-03-01" (tu backend manda ISO)
  count: number;
  amount: number;
}

export interface DonationsVariation {
  count_percent: number | null;
  amount_percent: number | null;
}

export interface DonationsStats {
  total_count: number;
  total_amount: number;
  last_30_days: DonationsPeriod;
  by_month: DonationsByMonthRow[];
  current_month: DonationsPeriod;
  previous_month: DonationsPeriod;
  variation: DonationsVariation;
}
export interface BooksStats {
  total: number;
  available: number;
  last_7_days: number;
  last_30_days: number;
  current_month: number;
  previous_month: number;
  by_day_last_30: Array<{ date: string; total: number }>;
  by_month: Array<{ month: string; total: number }>;
}

export interface ExchangesStats {
  completed_total: number;
  in_progress_total: number;
  last_7_days: number;
  by_day_last_30: Array<{ date: string; total: number }>;
  by_month: Array<{ month: string; total: number }>;
}

export interface AdminSummary {
  total_users: number;
  new_users_last_7_days: number;
  total_books: number;
  available_books: number;
  intercambios_completados: number;
  intercambios_pendientes: number;
  users_by_region: RegionRow[];
  books_stats: BooksStats;
  exchanges_stats: ExchangesStats;
  top_active_users: Array<{
    id_usuario: number;
    nombre_usuario: string;
    email: string;
    total_completed_exchanges: number;
  }>;
  top_publishers: Array<{
    id_usuario__id_usuario: number;
    id_usuario__nombre_usuario: string;
    id_usuario__email: string;
    books_count: number;
  }>;
  top_requesters: Array<{
    id_usuario_solicitante__id_usuario: number;
    id_usuario_solicitante__nombre_usuario: string;
    id_usuario_solicitante__email: string;
    solicitudes_count: number;
  }>;
  top_rated_users: Array<{
    id_usuario_calificado__id_usuario: number;
    id_usuario_calificado__nombre_usuario: string;
    id_usuario_calificado__email: string;
    promedio: number;
    total: number;
  }>;
  genres_books: Array<{ genre: string; total: number }>;
  genres_exchanges: Array<{ genre: string; total: number }>;

  // 👇 NUEVO
  donations_stats: DonationsStats;
}


// (Opcional) para gestión de usuarios admin:
export interface AdminUserRow {
  id_usuario: number;
  email: string;
  nombres?: string;
  apellido_paterno?: string;
  apellido_materno?: string;
  nombre_usuario: string;
  activo: boolean;
  verificado: boolean;
  es_admin: boolean;
  created_at?: string;
  total_libros?: number;
  total_intercambios?: number;
  rating_avg?: number | null;
  rating_count?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  constructor(private api: ApiService) { }

  // 👉 Resumen del dashboard admin
  getSummary(): Observable<AdminSummary> {
    return this.api.get<any>('/api/admin/summary/').pipe(
      map((res) => {
        const mapped: AdminSummary = {
          total_users: res.total_users,
          new_users_last_7_days: res.new_users_last_7_days ?? 0,
          total_books: res.total_books,
          available_books: res.books_stats?.available ?? res.total_books,

          intercambios_completados: res.completed_exchanges,
          intercambios_pendientes: res.in_progress_exchanges,

          users_by_region: (res.users_by_region || []).map((r: any) => ({
            region: r.region || 'Sin región',
            total: r.total ?? 0,
          })),

          books_stats: res.books_stats || {
            total: res.total_books,
            available: res.total_books,
            last_7_days: 0,
            last_30_days: 0,
            current_month: 0,
            previous_month: 0,
            by_day_last_30: [],
            by_month: [],
          },

          exchanges_stats: res.exchanges_stats || {
            completed_total: res.completed_exchanges,
            in_progress_total: res.in_progress_exchanges,
            last_7_days: 0,
            by_day_last_30: [],
            by_month: [],
          },

          top_active_users: res.top_active_users || [],
          top_publishers: res.top_publishers || [],
          top_requesters: res.top_requesters || [],
          top_rated_users: res.top_rated_users || [],

          genres_books: res.genres_books || [],
          genres_exchanges: res.genres_exchanges || [],

          // 👇 NUEVO: donaciones
          donations_stats: {
            total_count: res.donations_stats?.total_count ?? 0,
            total_amount: Number(res.donations_stats?.total_amount ?? 0),

            last_30_days: {
              count: res.donations_stats?.last_30_days?.count ?? 0,
              amount: Number(res.donations_stats?.last_30_days?.amount ?? 0),
            },

            by_month: (res.donations_stats?.by_month || []).map((row: any) => ({
              month: row.month,
              count: row.count ?? 0,
              amount: Number(row.amount ?? 0),
            })),

            current_month: {
              count: res.donations_stats?.current_month?.count ?? 0,
              amount: Number(res.donations_stats?.current_month?.amount ?? 0),
            },

            previous_month: {
              count: res.donations_stats?.previous_month?.count ?? 0,
              amount: Number(res.donations_stats?.previous_month?.amount ?? 0),
            },

            variation: {
              count_percent: res.donations_stats?.variation?.count_percent ?? null,
              amount_percent: res.donations_stats?.variation?.amount_percent ?? null,
            },
          },
        };

        return mapped;
      })
    );
  }

  // 👉 Pantalla de usuarios admin
  listUsers(params?: {
    search?: string;
    activo?: 'true' | 'false';
    verificado?: 'true' | 'false';
    es_admin?: 'true' | 'false';
    page?: number;
    page_size?: number;
  }) {
    // 👇 Aseguramos que por defecto NO traiga admins
    const finalParams: any = {
      ...(params || {}),
    };

    if (!('es_admin' in finalParams)) {
      finalParams.es_admin = 'false';
    }

    return this.api.get<AdminUserRow[]>('/api/admin/users/', {
      params: finalParams,
    });
  }

  toggleUserActive(userId: number, activo: boolean) {
    return this.api.post<{ ok?: boolean; activo: boolean; message?: string }>(
      `/api/admin/users/${userId}/toggle/`,
      { activo }
    );
  }

  deleteUser(userId: number) {
    return this.api.delete<{ ok?: boolean; message?: string }>(
      `/api/admin/users/${userId}/delete/`
    );
  }
}
