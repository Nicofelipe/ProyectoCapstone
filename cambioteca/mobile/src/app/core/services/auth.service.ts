// src/app/core/services/auth.service.ts
import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import ApiService from '../services/api.service';

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
}
export type User = MeUser;

export interface LoginResponse { access: string; user: MeUser; }

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

  constructor(private api: ApiService) { this.restore(); }

  get user(): MeUser | null { return this._user$.value; }

  async restoreSession() { await this.restore(); }


  private async restore() {
    const [{ value: token }, { value: userJson }] = await Promise.all([
      Preferences.get({ key: TOKEN_KEY }),
      Preferences.get({ key: USER_KEY }),
    ]);
    if (token && userJson) {
      try { this._user$.next(JSON.parse(userJson) as MeUser); }
      catch { this._user$.next(null); }
    } else {
      this._user$.next(null);
    }
  }

  async login(email: string, contrasena: string): Promise<LoginResponse> {
    const resp = await firstValueFrom(
      this.api.post<LoginResponse>('/api/auth/login/', { email, contrasena })
    );
    await Preferences.set({ key: TOKEN_KEY, value: resp.access });
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(resp.user) });
    this._user$.next(resp.user);
    return resp;
  }

  async registerFormData(fd: FormData) {
    return await firstValueFrom(this.api.post<{ message: string; id: number }>('/api/auth/register/', fd));
  }

  async requestPasswordReset(email: string) {
    return await firstValueFrom(this.api.post<{ message: string }>('/api/auth/forgot/', { email }));
  }

  async resetPassword(token: string, password: string, password2: string) {
    return await firstValueFrom(this.api.post<{ message: string }>('/api/auth/reset/', { token, password, password2 }));
  }

  async logout() {
    await Preferences.remove({ key: TOKEN_KEY });
    await Preferences.remove({ key: USER_KEY });
    this._user$.next(null);
  }

  async isLoggedIn() { return !!(await Preferences.get({ key: TOKEN_KEY })).value; }

  async setUserLocal(u: MeUser) {
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(u) });
    this._user$.next(u);
  }

  async getUserSummary(id: number): Promise<Summary> {
    return await firstValueFrom(this.api.get<Summary>(`/api/users/${id}/summary/`));
  }


  async updateMyProfile(id: number, data: Record<string, any>): Promise<Partial<MeUser>> {
    const updated = await firstValueFrom(this.api.patch<any>(`/api/users/${id}/`, data));

    const normalized: Partial<MeUser> = {
      id: updated.id_usuario ?? this.user?.id,
      email: updated.email ?? this.user?.email,
      nombres: updated.nombres ?? this.user?.nombres ?? '',
      apellido_paterno: updated.apellido_paterno ?? this.user?.apellido_paterno,
      apellido_materno: updated.apellido_materno ?? this.user?.apellido_materno,
      nombre_usuario: updated.nombre_usuario ?? this.user?.nombre_usuario,
      imagen_perfil: updated.imagen_perfil ?? this.user?.imagen_perfil ?? null,
      verificado: updated.verificado ?? !!this.user?.verificado,
      rut: updated.rut ?? this.user?.rut,
      telefono: updated.telefono ?? this.user?.telefono,
      direccion: updated.direccion ?? this.user?.direccion,
      numeracion: updated.numeracion ?? this.user?.numeracion,
      direccion_completa: updated.direccion_completa
        ?? `${updated.direccion ?? this.user?.direccion ?? ''} ${updated.numeracion ?? this.user?.numeracion ?? ''}`.trim(),
    };

    const merged = { ...(this.user as any), ...normalized };
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
    // Evita cache del mismo path en <img> si el storage reusa nombre
    const rel = String(updated.imagen_perfil || '').replace(/^\//, '');
    const merged = { ...(this.user as any), imagen_perfil: rel };
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(merged) });
    this._user$.next(merged);
    return updated;
  }

  async getUserProfile(id: number) {
    return await firstValueFrom(this.api.get<any>(`/api/users/${id}/profile/`));
  }



}
