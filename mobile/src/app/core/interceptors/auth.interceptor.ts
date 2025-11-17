// src/app/core/interceptors/auth.interceptor.ts
import {
  HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest
} from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { AuthService } from '../services/auth.service';

function originOf(u: string): string {
  try { return new URL(u, (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')).origin; }
  catch { return (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'); }
}

const API_BASE = (environment.apiUrl || '').replace(/\/+$/, '');
const API_ORIGIN = originOf(API_BASE);

// Normaliza y detecta paths públicos donde NO queremos Authorization
function isNoAuthPath(url: string): boolean {
  // Obtiene el pathname relativo a la base
  let path = url;
  try { path = new URL(url, API_BASE).pathname; } catch {}
  // Ajusta a tus rutas reales (incluí ambas variantes por si usas /books o /libros)
  return /\/api\/((books|libros)\/\d+\/images|public\/covers|generos(\/|$)|catalogo(\/|$))/i.test(path);
}

// Solo adjunta a la misma ORIGIN de la API
function isSameApiOrigin(url: string): boolean {
  try { return new URL(url, (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')).origin === API_ORIGIN; }
  catch { return false; }
}

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private loggingOut = false;

  constructor(private auth: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.auth.accessTokenSync;

    // ¿Debemos adjuntar Authorization?
    const attachAuth = !!token && isSameApiOrigin(req.url) && !isNoAuthPath(req.url);

    let clone = attachAuth ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

    // Si es FormData, no fuerces Content-Type
    if (clone.body instanceof FormData) {
      clone = clone.clone({ setHeaders: {} });
    }

    return next.handle(clone).pipe(
      catchError((err: HttpErrorResponse) => {
        // Solo forzar logout si era una request “protegida” a nuestra API con token
        if (err.status === 401 && attachAuth && !this.loggingOut) {
          this.loggingOut = true;
          Promise.resolve(this.auth.forceLogout('Sesión expirada o inválida'))
            .finally(() => { this.loggingOut = false; });
        }
        return throwError(() => err);
      })
    );
  }
}
