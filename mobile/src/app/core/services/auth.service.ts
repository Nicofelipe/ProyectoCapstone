// src/app/core/services/auth.service.ts
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import ApiService from './api.service'; // 👈 misma carpeta

export interface MeUser {
  id: number;
  email: string;
  nombres: string;
  nombre_usuario: string;
  verificado: boolean;
  imagen_perfil?: string | null;
  apellido_paterno?: string;
  apellido_materno?: string;
  calificacion?: number | string | null;
  rut?: string;
  telefono?: string;
  direccion?: string;
  numeracion?: string;
  direccion_completa?: string;
  es_admin?: boolean;
  avatar_url?: string | null;
}
export type User = MeUser;

export interface LoginResponse {
  access: string;
  user: MeUser;
}

export interface UserRating {
  id: number;
  intercambio_id: number | null;
  tipo: 'recibida' | 'enviada' | string;
  estrellas: number | string;
  comentario: string;
  fecha: string | null;
  libro_titulo: string;
  contraparte_nombre: string;
}

export interface SummaryUserFromApi {
  id_usuario: number;
  email: string;
  nombres: string;
  apellido_paterno?: string;
  apellido_materno?: string;
  nombre_usuario: string;
  imagen_perfil?: string | null;
  verificado: boolean;
  rut?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  numeracion?: string | null;
  direccion_completa?: string | null;
}

export interface Summary {
  user: SummaryUserFromApi;
  metrics: { libros: number; intercambios: number; calificacion: number };
  history: { id: number; titulo: string; estado: string; fecha?: string }[];
}

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user$ = new BehaviorSubject<MeUser | null>(null);
  user$ = this._user$.asObservable();

  // Cache en memoria del token para que el interceptor lo lea sin await
  private tokenCache: string | null = null;

  constructor(private api: ApiService, private router: Router) {
    // Intenta restaurar aun si no configuraste APP_INITIALIZER
    this.restore();
  }

  // Getters cómodos
  get user(): MeUser | null {
    return this._user$.value;
  }
  get accessTokenSync(): string | null {
    return this.tokenCache;
  }

  // Permite usarlo en APP_INITIALIZER
  async restoreSession(): Promise<void> {
    await this.restore();
  }

  private async restore(): Promise<void> {
    const [{ value: token }, { value: userJson }] = await Promise.all([
      Preferences.get({ key: TOKEN_KEY }),
      Preferences.get({ key: USER_KEY }),
    ]);

    this.tokenCache = token ?? null;

    if (token && userJson) {
      try {
        this._user$.next(JSON.parse(userJson) as MeUser);
      } catch {
        this._user$.next(null);
      }
    } else {
      this._user$.next(null);
    }
  }

  // ====== Auth básico ======

  async login(email: string, contrasena: string): Promise<LoginResponse> {
    const resp = await firstValueFrom(
      this.api.post<LoginResponse>('/api/auth/login/', { email, contrasena })
    );
    this.tokenCache = resp.access;
    await Preferences.set({ key: TOKEN_KEY, value: resp.access });
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(resp.user) });
    this._user$.next(resp.user);
    return resp;
  }

  async logout(): Promise<void> {
    await Preferences.remove({ key: TOKEN_KEY });
    await Preferences.remove({ key: USER_KEY });
    this.tokenCache = null;
    this._user$.next(null);
  }

  // Cierre de sesión global (invalida tokens en servidor)
  async logoutAll(): Promise<void> {
    try {
      await firstValueFrom(this.api.post('/api/auth/logout-all/', {}));
    } catch {
      // Si ya expiró o 401/403, igual continuamos
    } finally {
      await this.logout();
    }
  }

  // Útil para interceptores ante 401/invalidación
  async forceLogout(reason?: string): Promise<void> {
    await this.logout();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    // Opcional: mostrar toast con reason
  }

  async isLoggedIn(): Promise<boolean> {
    return !!(await Preferences.get({ key: TOKEN_KEY })).value;
  }

  async setUserLocal(u: MeUser): Promise<void> {
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(u) });
    this._user$.next(u);
  }

  // ====== Flujos de registro/recuperación ======

  async registerFormData(fd: FormData) {
    return await firstValueFrom(
      this.api.post<{ message: string; id: number }>('/api/auth/register/', fd)
    );
  }

  async requestPasswordReset(email: string) {
    return await firstValueFrom(
      this.api.post<{ message: string }>('/api/auth/forgot/', { email })
    );
  }

  async resetPassword(token: string, password: string, password2: string) {
    return await firstValueFrom(
      this.api.post<{ message: string }>('/api/auth/reset/', { token, password, password2 })
    );
  }

  async changePassword(current: string, newPass: string) {
    return await firstValueFrom(
      this.api.post<{ message: string }>('/api/auth/change-password/', {
        current,
        new: newPass,
      })
    );
  }

  // ====== Perfil / Usuario ======

  async getUserSummary(id: number): Promise<Summary> {
    return await firstValueFrom(this.api.get<Summary>(`/api/users/${id}/summary/`));
  }

  async getUserProfile(id: number) {
    return await firstValueFrom(this.api.get<any>(`/api/users/${id}/profile/`));
  }

  async getUserBooks(id: number) {
    return await firstValueFrom(this.api.get<any[]>(`/api/users/${id}/books/`));
  }

  async getUserIntercambios(id: number) {
    return await firstValueFrom(this.api.get<any[]>(`/api/users/${id}/intercambios/`));
  }

  async getUserRatings(id: number): Promise<UserRating[]> {
    return await firstValueFrom(
      this.api.get<UserRating[]>(`/api/users/${id}/ratings/`)
    );
  }

  async updateMyProfile(id: number, data: Record<string, any>): Promise<Partial<MeUser>> {
    const updated = await firstValueFrom(
      this.api.patch<any>(`/api/users/${id}/`, data)
    );

    const normalized: Partial<MeUser> = {
      id: updated.id_usuario ?? this.user?.id,
      email: updated.email ?? this.user?.email,
      nombres: updated.nombres ?? this.user?.nombres ?? '',
      apellido_paterno: updated.apellido_paterno ?? this.user?.apellido_paterno,
      apellido_materno: updated.apellido_materno ?? this.user?.apellido_materno,
      nombre_usuario: updated.nombre_usuario ?? this.user?.nombre_usuario,
      imagen_perfil: (updated.imagen_perfil ?? this.user?.imagen_perfil ?? null) || null,
      // 👇 conservamos/actualizamos avatar_url si viniera del backend
      avatar_url: updated.avatar_url ?? this.user?.avatar_url ?? null,
      verificado: typeof updated.verificado === 'boolean'
        ? updated.verificado
        : !!this.user?.verificado,
      rut: updated.rut ?? this.user?.rut,
      telefono: updated.telefono ?? this.user?.telefono,
      direccion: updated.direccion ?? this.user?.direccion,
      numeracion: updated.numeracion ?? this.user?.numeracion,
      direccion_completa:
        updated.direccion_completa ??
        `${updated.direccion ?? this.user?.direccion ?? ''} ${updated.numeracion ?? this.user?.numeracion ?? ''}`.trim(),
      // 👇 importante: NO perder el flag de admin
      es_admin: typeof updated.es_admin === 'boolean'
        ? updated.es_admin
        : this.user?.es_admin ?? false,
    };

    const merged: MeUser = { ...(this.user as MeUser), ...normalized };
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(merged) });
    this._user$.next(merged);
    return normalized;
  }

  async updateAvatar(id: number, file: File) {
    const fd = new FormData();
    fd.append('imagen_perfil', file);

    const updated = await firstValueFrom(
      this.api.patch<any>(`/api/users/${id}/avatar/`, fd)
    );

    // Evita cache del <img> si el storage reusa nombre
    const rel = String(updated.imagen_perfil || '').replace(/^\//, '');
    const merged = { ...(this.user as any), imagen_perfil: rel };
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(merged) });
    this._user$.next(merged);
    return updated;
  }
}
